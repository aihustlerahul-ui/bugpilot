import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AuthModule } from './auth.module'
import { AuthService } from './auth.service'
import { AuthThrottlerGuard } from './auth-throttler.guard'

describe('Auth throttling', () => {
  let app: INestApplication
  const login = jest
    .fn()
    .mockRejectedValue(new UnauthorizedException('Invalid credentials'))

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AuthService)
      .useValue({ login, refresh: login })
      .compile()
    app = mod.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.setGlobalPrefix('api')
    await app.init()
  })
  afterEach(() => app.close())

  it('429s the 6th login attempt for the same email, not for another', async () => {
    const http = app.getHttpServer()
    const body = { email: 'a@b.com', password: 'p' }
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      codes.push((await request(http).post('/api/auth/login').send(body)).status)
    }
    expect(codes[5]).toBe(429)
    expect(codes.slice(0, 5)).not.toContain(429)
    const other = await request(http)
      .post('/api/auth/login')
      .send({ email: 'other@b.com', password: 'p' })
    expect(other.status).not.toBe(429)
  })

  it('shares one bucket across case/whitespace variants of an email', async () => {
    const http = app.getHttpServer()
    const variants = ['C@B.com', ' c@b.com ', 'c@B.COM', 'C@b.com', ' C@b.com', 'c@b.com']
    const codes: number[] = []
    for (const email of variants) {
      codes.push((await request(http).post('/api/auth/login').send({ email, password: 'p' })).status)
    }
    expect(codes[5]).toBe(429)
  })

  it('429s the 31st login from one ip across many emails', async () => {
    const http = app.getHttpServer()
    const codes: number[] = []
    for (let i = 0; i < 31; i++) {
      codes.push(
        (await request(http).post('/api/auth/login').send({ email: `spray${i}@b.com`, password: 'p' }))
          .status,
      )
    }
    expect(codes.slice(0, 30)).not.toContain(429)
    expect(codes[30]).toBe(429)
  })

  it('non-string email falls back to ip-only key and fails validation with 400', async () => {
    const http = app.getHttpServer()
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: ['a@b.com'], password: 'p' })
    expect(res.status).toBe(400)
  })

  it('refresh allows 30 per ip then 429s the 31st', async () => {
    const http = app.getHttpServer()
    const codes: number[] = []
    for (let i = 0; i < 31; i++) {
      codes.push(
        (await request(http).post('/api/auth/refresh').send({ refresh_token: 't' }))
          .status,
      )
    }
    expect(codes.slice(0, 30)).not.toContain(429)
    expect(codes[30]).toBe(429)
  })
})

describe('AuthThrottlerGuard tracker', () => {
  const tracker = (req: any) =>
    (AuthThrottlerGuard.prototype as any).getTracker.call({}, req)

  it('normalizes email and falls back to ip for non-string email', async () => {
    expect(await tracker({ ip: '1.1.1.1', body: { email: ' A@B.com ' } })).toBe('1.1.1.1:a@b.com')
    expect(await tracker({ ip: '1.1.1.1', body: { email: ['a@b.com'] } })).toBe('1.1.1.1')
    expect(await tracker({ ip: '1.1.1.1', body: { email: { x: 1 } } })).toBe('1.1.1.1')
    expect(await tracker({ ip: '1.1.1.1', body: {} })).toBe('1.1.1.1')
  })
})
