import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { MembersController } from './members.controller'
import { MembersService } from './members.service'
import { MembersThrottlerGuard } from './members-throttler.guard'
import { SupabaseService } from '../supabase/supabase.service'
import { ApiKeysService } from '../api-keys/api-keys.service'
import { AccessService } from '../access/access.service'

// Mirrors the app-wide throttler config registered (globally) by AuthModule.
const throttlerConfig = ThrottlerModule.forRoot([
  { name: 'default', ttl: 60000, limit: 5 },
  { name: 'ip', ttl: 60000, limit: 30, getTracker: (req) => req.ip ?? 'unknown' },
])

describe('Members invite throttling', () => {
  let app: INestApplication
  const members = {
    addToProject: jest.fn().mockResolvedValue({ id: 'm', invite: { sent: true } }),
    createMember: jest.fn().mockResolvedValue({ id: 'm' }),
    listWorkspaceMembers: jest.fn().mockResolvedValue([]),
  }
  // token "t-<id>" authenticates as user <id>
  const getUser = jest.fn(async (token: string) => ({
    data: { user: { id: token.replace(/^t-/, ''), email: 'x@y.com', email_confirmed_at: 'now' } },
    error: null,
  }))

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      imports: [throttlerConfig],
      controllers: [MembersController],
      providers: [
        MembersThrottlerGuard,
        { provide: MembersService, useValue: members },
        { provide: SupabaseService, useValue: { db: { auth: { getUser } } } },
        { provide: ApiKeysService, useValue: {} },
        { provide: AccessService, useValue: {} },
      ],
    }).compile()
    app = mod.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.setGlobalPrefix('api')
    await app.init()
  })
  afterEach(() => app.close())

  const body = (i: number) => ({ name: `T${i}`, email: `t${i}@x.com` })

  it('allows 20 add-to-project calls per user per hour, 429s the 21st, other users unaffected', async () => {
    const http = app.getHttpServer()
    const codes: number[] = []
    for (let i = 0; i < 21; i++) {
      codes.push(
        (await request(http).post('/api/workspaces/members/project/p1').set('Authorization', 'Bearer t-u1').send(body(i)))
          .status,
      )
    }
    expect(codes.slice(0, 20)).not.toContain(429)
    expect(codes[20]).toBe(429)
    const other = await request(http)
      .post('/api/workspaces/members/project/p1')
      .set('Authorization', 'Bearer t-u2')
      .send(body(99))
    expect(other.status).not.toBe(429)
  })

  it('throttles workspace member creation per user too', async () => {
    const http = app.getHttpServer()
    const codes: number[] = []
    for (let i = 0; i < 21; i++) {
      codes.push(
        (await request(http).post('/api/workspaces/members').set('Authorization', 'Bearer t-u3').send(body(i))).status,
      )
    }
    expect(codes.slice(0, 20)).not.toContain(429)
    expect(codes[20]).toBe(429)
  })

  it('does not throttle read routes', async () => {
    const http = app.getHttpServer()
    for (let i = 0; i < 25; i++) {
      expect((await request(http).get('/api/workspaces/members').set('Authorization', 'Bearer t-u4')).status).toBe(200)
    }
  })

  it('still requires auth before throttling', async () => {
    const res = await request(app.getHttpServer()).post('/api/workspaces/members/project/p1').send(body(1))
    expect(res.status).toBe(401)
  })
})

describe('MembersThrottlerGuard tracker', () => {
  const tracker = (req: any) => (MembersThrottlerGuard.prototype as any).getTracker.call({}, req)

  it('keys on the authenticated user id and falls back to ip', async () => {
    expect(await tracker({ ip: '1.1.1.1', user: { id: 'u1' } })).toBe('user:u1')
    expect(await tracker({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1')
    expect(await tracker({})).toBe('ip:unknown')
  })
})
