import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import type { AuthUser } from '../common/interfaces/auth-user.interface'
import { ApiKeysService } from './api-keys.service'
import { CreateApiKeyDto } from './dto/create-api-key.dto'

// Management endpoints are JWT-only: an API key must not be able to mint or revoke API keys.
@Controller('api-keys')
@UseGuards(SupabaseAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(user.id, dto.name)
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(user.id)
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiKeys.revoke(user.id, id)
  }
}
