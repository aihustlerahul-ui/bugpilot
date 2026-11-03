import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AuthModule } from './auth.module'
import { AuthService } from './auth.service'

describe('Auth throttling', () => {
  let app: INestApplication
  const login = jest
    .fn()
    .mockRejectedValue(new UnauthorizedException('Invalid credentials'))

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AuthService)
      .useValue({ login, refresh: login })
      .compile()
    app = mod.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.setGlobalPrefix('api')
    await app.init()
  })
  afterAll(() => app.close())

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

  it('429s the 6th refresh attempt from one ip', async () => {
    const http = app.getHttpServer()
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      codes.push(
        (await request(http).post('/api/auth/refresh').send({ refresh_token: 't' }))
          .status,
      )
    }
    expect(codes[5]).toBe(429)
  })
})
