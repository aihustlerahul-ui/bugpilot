import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthThrottlerGuard } from './auth-throttler.guard'

@Module({
  imports: [ThrottlerModule.forRoot([
      // per ip+email on login (see AuthThrottlerGuard.getTracker); per ip on refresh
      { name: 'default', ttl: 60000, limit: 5 },
      // ip-only cap across all emails (password spray); login only
      { name: 'ip', ttl: 60000, limit: 30, getTracker: (req) => req.ip ?? 'unknown' },
    ])],
  controllers: [AuthController],
  providers: [AuthService, AuthThrottlerGuard],
})
export class AuthModule {}
