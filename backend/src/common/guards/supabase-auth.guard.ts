import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SupabaseService } from '../../supabase/supabase.service'
import { ApiKeysService } from '../../api-keys/api-keys.service'
import { AccessService } from '../../access/access.service'
import { API_KEY_ALLOWED } from '../decorators/api-key-allowed.decorator'

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private supabase: SupabaseService,
    private apiKeys: ApiKeysService,
    private access: AccessService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException()

    const token = authHeader.replace('Bearer ', '')
    if (token.startsWith('bp_')) return this.authenticateApiKey(context, request, token)

    const { data: { user }, error } = await this.supabase.db.auth.getUser(token)
    if (error || !user) throw new UnauthorizedException()

    request.user = {
      id: user.id,
      email: user.email ?? '',
      emailVerified: !!user.email_confirmed_at,
    }
    return true
  }

  private async authenticateApiKey(context: ExecutionContext, request: any, rawKey: string): Promise<boolean> {
    const verified = await this.apiKeys.verify(rawKey)
    if (!verified) throw new UnauthorizedException()

    const allowed = this.reflector.getAllAndOverride<boolean>(API_KEY_ALLOWED, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!allowed) throw new ForbiddenException('API keys cannot be used on this endpoint')

    const { data, error } = await this.supabase.db.auth.admin.getUserById(verified.userId)
    const account = data?.user
    if (error || !account || !account.email_confirmed_at) throw new UnauthorizedException()

    const rawWorkspace = request.headers['x-workspace-id']
    const workspaceId = (Array.isArray(rawWorkspace) ? rawWorkspace[0] : rawWorkspace)?.trim()
    if (!workspaceId) throw new BadRequestException('X-Workspace-Id header is required')

    const user = { id: account.id, email: account.email ?? '', emailVerified: true }
    await this.access.assertWorkspaceAccess(user, workspaceId)

    request.user = { ...user, workspaceId, authMethod: 'api_key' }
    return true
  }
}
