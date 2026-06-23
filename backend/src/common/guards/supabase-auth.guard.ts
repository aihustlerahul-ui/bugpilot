import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as jwt from 'jsonwebtoken'

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException()

    const token = authHeader.replace('Bearer ', '')
    try {
      const secret = this.config.get('SUPABASE_JWT_SECRET')!
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        audience: 'authenticated',
      }) as { sub: string; email: string }
      request.user = { id: payload.sub, email: payload.email }
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
