import { UnauthorizedException } from '@nestjs/common'
import { SupabaseAuthGuard } from './supabase-auth.guard'

function ctx(headers: Record<string, string>) {
  const request: any = { headers }
  return {
    request,
    context: { switchToHttp: () => ({ getRequest: () => request }) } as any,
  }
}

function guardFor(user: any) {
  const getUser = jest.fn().mockResolvedValue({ data: { user }, error: user ? null : { message: 'bad' } })
  return new SupabaseAuthGuard({ db: { auth: { getUser } } } as any)
}

describe('SupabaseAuthGuard', () => {
  it('sets emailVerified=true only when email_confirmed_at is set', async () => {
    const a = ctx({ authorization: 'Bearer t' })
    await guardFor({ id: 'u1', email: 'a@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }).canActivate(a.context)
    expect(a.request.user).toEqual({ id: 'u1', email: 'a@x.com', emailVerified: true })

    const b = ctx({ authorization: 'Bearer t' })
    await guardFor({ id: 'u2', email: 'b@x.com', email_confirmed_at: null }).canActivate(b.context)
    expect(b.request.user).toEqual({ id: 'u2', email: 'b@x.com', emailVerified: false })
  })

  it('rejects a missing or invalid token', async () => {
    await expect(guardFor(null).canActivate(ctx({}).context)).rejects.toThrow(UnauthorizedException)
    await expect(guardFor(null).canActivate(ctx({ authorization: 'Bearer x' }).context)).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
