import { Test } from '@nestjs/testing'
import { InviteService } from './invite.service'
import { SupabaseService } from '../supabase/supabase.service'

describe('InviteService', () => {
  let service: InviteService
  let invite: jest.Mock

  const build = async () => {
    const module = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: SupabaseService, useValue: { db: { auth: { admin: { inviteUserByEmail: invite } } } } },
      ],
    }).compile()
    service = module.get(InviteService)
  }

  beforeEach(async () => {
    process.env.PLATFORM_URL = 'https://app.example.com'
    invite = jest.fn()
    await build()
  })

  afterEach(() => {
    delete process.env.PLATFORM_URL
  })

  it('invites a new address with redirectTo the platform login', async () => {
    invite.mockResolvedValue({ data: {}, error: null })
    const result = await service.sendProjectInvite('new@acme.com', 'Proj')
    expect(invite).toHaveBeenCalledWith('new@acme.com', { redirectTo: 'https://app.example.com/login' })
    expect(result).toEqual({ sent: true })
  })

  it('defaults the platform URL to localhost', async () => {
    delete process.env.PLATFORM_URL
    invite.mockResolvedValue({ data: {}, error: null })
    await service.sendProjectInvite('new@acme.com', 'Proj')
    expect(invite).toHaveBeenCalledWith('new@acme.com', { redirectTo: 'http://localhost:3000/login' })
  })

  it('reports error for 422 with an unrelated message', async () => {
    invite.mockResolvedValue({ data: null, error: { status: 422, message: 'Signups not allowed' } })
    expect(await service.sendProjectInvite('a@acme.com', 'Proj')).toEqual({ sent: false, reason: 'error' })
  })

  it('reports already-registered for 422 with an already-registered message', async () => {
    invite.mockResolvedValue({ data: null, error: { status: 422, message: 'A user with this email address has already been registered' } })
    expect(await service.sendProjectInvite('a@acme.com', 'Proj')).toEqual({ sent: false, reason: 'already-registered' })
  })

  it('reports already-registered for email_exists code', async () => {
    invite.mockResolvedValue({ data: null, error: { code: 'email_exists', message: 'x' } })
    expect(await service.sendProjectInvite('a@acme.com', 'Proj')).toEqual({ sent: false, reason: 'already-registered' })
  })

  it('reports error when only the message mentions "already" without a 422', async () => {
    invite.mockResolvedValue({ data: null, error: { message: 'User has already been registered' } })
    expect(await service.sendProjectInvite('a@acme.com', 'Proj')).toEqual({ sent: false, reason: 'error' })
  })

  it('reports error for other Supabase errors', async () => {
    invite.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } })
    expect(await service.sendProjectInvite('a@acme.com', 'Proj')).toEqual({ sent: false, reason: 'error' })
  })

  it('never throws when the client throws', async () => {
    invite.mockRejectedValue(new Error('network'))
    await expect(service.sendProjectInvite('a@acme.com', 'Proj')).resolves.toEqual({ sent: false, reason: 'error' })
  })
})
