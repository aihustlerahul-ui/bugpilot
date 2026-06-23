import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthUser } from '../interfaces/auth-user.interface'

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
)
