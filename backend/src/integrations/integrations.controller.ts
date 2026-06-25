import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import type { AuthUser } from '../common/interfaces/auth-user.interface'
import { IntegrationsService, AZURE_FIELDS, QA_SOURCE_FIELDS } from './integrations.service'
import { CreateAzureIntegrationDto } from './dto/create-azure-integration.dto'

@UseGuards(SupabaseAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post('azure')
  upsertAzure(@CurrentUser() user: AuthUser, @Body() dto: CreateAzureIntegrationDto) {
    return this.integrations.upsertAzure(user.id, dto)
  }

  @Get('azure')
  getAzure(@CurrentUser() user: AuthUser) {
    return this.integrations.getAzure(user.id)
  }

  @Get('azure/fields')
  getAzureFields() {
    return { azureFields: AZURE_FIELDS, qaSourceFields: QA_SOURCE_FIELDS }
  }

  @Post('azure/sync/:issueId')
  syncToAzure(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.integrations.syncToAzure(user.id, issueId)
  }
}
