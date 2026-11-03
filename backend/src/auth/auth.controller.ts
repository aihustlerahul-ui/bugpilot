import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthService, AuthSession } from './auth.service'
import { AuthThrottlerGuard } from './auth-throttler.guard'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'

// Public routes: no SupabaseAuthGuard. Throttled 5 requests / 60s each.
@Controller('auth')
@UseGuards(AuthThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60000 } })
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthSession> {
    return this.auth.login(dto)
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthSession> {
    return this.auth.refresh(dto)
  }
}
