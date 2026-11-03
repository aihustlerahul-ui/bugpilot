import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import { SupabaseAuthGuard } from './supabase-auth.guard'

function ctx(headers: Record<string, string>) {
  const request: any = { headers }
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as any,
  }
}

function build(opts: {
  user?: any
  apiKey?: { userId: string; keyId: string } | null
  account?: any
  allowed?: boolean
  workspaceError?: Error
}) {
  const getUser = jest
    .fn()
    .mockResolvedValue({ data: { user: opts.user ?? null }, error: opts.user ? null : { message: 'bad' } })
  const getUserById = jest.fn().mockResolvedValue({ data: { user: opts.account ?? null }, error: null })
  const supabase: any = { db: { auth: { getUser, admin: { getUserById } } } }
  const apiKeys: any = { verify: jest.fn().mockResolvedValue(opts.apiKey ?? null) }
  const access: any = {
    assertWorkspaceAccess: jest.fn(async () => {
      if (opts.workspaceError) throw opts.workspaceError
    }),
  }
  const reflector: any = { getAllAndOverride: jest.fn().mockReturnValue(opts.allowed ?? true) }
  return { guard: new SupabaseAuthGuard(supabase, apiKeys, access, reflector), getUser, getUserById, apiKeys, access }
}

const KEY = 'bp_live_abc123'
const confirmed = { id: 'u1', email: 'a@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

describe('SupabaseAuthGuard', () => {
  it('sets emailVerified=true only when email_confirmed_at is set', async () => {
    const a = ctx({ authorization: 'Bearer t' })
    await build({ user: confirmed }).guard.canActivate(a.context)
    expect(a.request.user).toEqual({ id: 'u1', email: 'a@x.com', emailVerified: true })

    const b = ctx({ authorization: 'Bearer t' })
    await build({ user: { id: 'u2', email: 'b@x.com', email_confirmed_at: null } }).guard.canActivate(b.context)
    expect(b.request.user).toEqual({ id: 'u2', email: 'b@x.com', emailVerified: false })
  })

  it('rejects a missing or invalid token', async () => {
    await expect(build({}).guard.canActivate(ctx({}).context)).rejects.toThrow(UnauthorizedException)
    await expect(build({}).guard.canActivate(ctx({ authorization: 'Bearer x' }).context)).rejects.toThrow(
      UnauthorizedException,
    )
  })

  describe('api keys', () => {
    const headers = { authorization: `Bearer ${KEY}`, 'x-workspace-id': 'ws-1' }

    it('bearer bp_ key resolves user and sets authMethod api_key', async () => {
      const c = ctx(headers)
      const t = build({ apiKey: { userId: 'u1', keyId: 'k1' }, account: confirmed })
      await expect(t.guard.canActivate(c.context)).resolves.toBe(true)
      expect(t.apiKeys.verify).toHaveBeenCalledWith(KEY)
      expect(t.getUser).not.toHaveBeenCalled()
      expect(t.access.assertWorkspaceAccess).toHaveBeenCalledWith(
        { id: 'u1', email: 'a@x.com', emailVerified: true },
        'ws-1',
      )
      expect(c.request.user).toEqual({
        id: 'u1',
        email: 'a@x.com',
        emailVerified: true,
        workspaceId: 'ws-1',
        authMethod: 'api_key',
      })
    })

    it('revoked/unknown key -> 401', async () => {
      const t = build({ apiKey: null, account: confirmed })
      await expect(t.guard.canActivate(ctx(headers).context)).rejects.toThrow(UnauthorizedException)
    })

    it('key without X-Workspace-Id -> 400', async () => {
      const t = build({ apiKey: { userId: 'u1', keyId: 'k1' }, account: confirmed })
      await expect(t.guard.canActivate(ctx({ authorization: `Bearer ${KEY}` }).context)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('key for a workspace the user is not in -> 403', async () => {
      const t = build({
        apiKey: { userId: 'u1', keyId: 'k1' },
        account: confirmed,
        workspaceError: new ForbiddenException(),
      })
      await expect(t.guard.canActivate(ctx(headers).context)).rejects.toThrow(ForbiddenException)
    })

    it('unconfirmed email -> 401', async () => {
      const t = build({
        apiKey: { userId: 'u1', keyId: 'k1' },
        account: { id: 'u1', email: 'a@x.com', email_confirmed_at: null },
      })
      await expect(t.guard.canActivate(ctx(headers).context)).rejects.toThrow(UnauthorizedException)
    })

    it('account lookup failure -> 401', async () => {
      const t = build({ apiKey: { userId: 'u1', keyId: 'k1' }, account: null })
      await expect(t.guard.canActivate(ctx(headers).context)).rejects.toThrow(UnauthorizedException)
    })

    it('key on route without @ApiKeyAllowed -> 403', async () => {
      const t = build({ apiKey: { userId: 'u1', keyId: 'k1' }, account: confirmed, allowed: false })
      await expect(t.guard.canActivate(ctx(headers).context)).rejects.toThrow(ForbiddenException)
      expect(t.access.assertWorkspaceAccess).not.toHaveBeenCalled()
    })
  })
})
