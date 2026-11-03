import { Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'

const signInWithPassword = jest.fn()
const refreshSession = jest.fn()
const createClientMock = jest.fn(() => ({
  auth: { signInWithPassword, refreshSession },
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => (createClientMock as any)(...args),
}))

const PASSWORD = 'super-secret-pw'
const REFRESH = 'refresh-token-xyz'

function makeService(env: Record<string, string | undefined> = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService
  return new AuthService(config)
}

const supaSession = {
  access_token: 'at',
  refresh_token: 'rt',
  expires_at: 1900000000,
  user: { id: 'u1', email: 'a@b.com', extra: 'ignored' },
}

describe('AuthService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('login maps the supabase session to AuthSession', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: supaSession, user: supaSession.user },
      error: null,
    })
    const res = await makeService().login({ email: 'a@b.com', password: PASSWORD })
    expect(res).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 1900000000,
      user: { id: 'u1', email: 'a@b.com' },
    })
    expect(createClientMock).toHaveBeenCalledWith(
      'https://x.supabase.co',
      'anon-key',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  })

  it('wrong password and unknown email give identical errors', async () => {
    const svc = makeService()
    signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    })
    const e1 = await svc.login({ email: 'a@b.com', password: 'bad' }).catch((e) => e)
    signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'User not found', status: 400 },
    })
    const e2 = await svc.login({ email: 'no@b.com', password: 'bad' }).catch((e) => e)
    expect(e1).toBeInstanceOf(UnauthorizedException)
    expect(e2).toBeInstanceOf(UnauthorizedException)
    expect(e1.message).toBe('Invalid credentials')
    expect(e2.message).toBe(e1.message)
  })

  it('upstream throw is mapped to the same Unauthorized error', async () => {
    signInWithPassword.mockRejectedValue(new Error('network down'))
    await expect(
      makeService().login({ email: 'a@b.com', password: 'x' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'))
  })

  it('fails clearly when the anon key is missing', async () => {
    const svc = makeService({ SUPABASE_URL: 'https://x.supabase.co' })
    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      /SUPABASE_ANON_KEY/,
    )
  })

  it('refresh success returns AuthSession', async () => {
    refreshSession.mockResolvedValue({
      data: { session: supaSession, user: supaSession.user },
      error: null,
    })
    const res = await makeService().refresh({ refresh_token: REFRESH })
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: REFRESH })
    expect(res.access_token).toBe('at')
    expect(res.user).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('refresh with invalid token throws Unauthorized', async () => {
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token', status: 400 },
    })
    await expect(
      makeService().refresh({ refresh_token: 'nope' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'))
  })

  it('never logs passwords or tokens', async () => {
    const spies = [
      jest.spyOn(console, 'log'),
      jest.spyOn(console, 'error'),
      jest.spyOn(console, 'warn'),
      jest.spyOn(Logger.prototype, 'log'),
      jest.spyOn(Logger.prototype, 'error'),
      jest.spyOn(Logger.prototype, 'warn'),
      jest.spyOn(Logger.prototype, 'debug'),
    ].map((s) => s.mockImplementation(() => undefined))
    const svc = makeService()

    signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: `bad ${PASSWORD}` },
    })
    await svc.login({ email: 'a@b.com', password: PASSWORD }).catch(() => undefined)
    signInWithPassword.mockResolvedValueOnce({
      data: { session: supaSession },
      error: null,
    })
    await svc.login({ email: 'a@b.com', password: PASSWORD })
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: `bad ${REFRESH}` },
    })
    await svc.refresh({ refresh_token: REFRESH }).catch(() => undefined)
    refreshSession.mockResolvedValueOnce({
      data: { session: supaSession },
      error: null,
    })
    await svc.refresh({ refresh_token: REFRESH })

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(REFRESH)
    expect(logged).not.toContain('"at"')
    expect(logged).not.toContain('"rt"')
    jest.restoreAllMocks()
  })
})
