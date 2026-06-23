import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { SupabaseService } from '../../supabase/supabase.service'

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException()

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await this.supabase.db.auth.getUser(token)
    if (error || !user) throw new UnauthorizedException()

    request.user = { id: user.id, email: user.email ?? '' }
    return true
  }
}
