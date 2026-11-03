import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthThrottlerGuard } from './auth-throttler.guard'

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
  controllers: [AuthController],
  providers: [AuthService, AuthThrottlerGuard],
})
export class AuthModule {}
