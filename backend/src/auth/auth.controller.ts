import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { AuthService, AuthSession } from './auth.service'
import { AuthThrottlerGuard } from './auth-throttler.guard'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'

// Public routes: no SupabaseAuthGuard. Login: 5/60s per ip+email and 30/60s per ip.
// Refresh: 30/60s per ip.
@Controller('auth')
@UseGuards(AuthThrottlerGuard)
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 }, ip: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthSession> {
    return this.auth.login(dto)
  }

  @Post('refresh')
  @SkipThrottle({ ip: true })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthSession> {
    return this.auth.refresh(dto)
  }
}
