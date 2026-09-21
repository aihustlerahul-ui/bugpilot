import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import type { AuthUser } from '../common/interfaces/auth-user.interface'
import { IntegrationsService, AZURE_FIELDS, QA_SOURCE_FIELDS } from './integrations.service'
import { CreateAzureIntegrationDto } from './dto/create-azure-integration.dto'
import { CreateJiraIntegrationDto } from './dto/create-jira-integration.dto'
import { CreateLinearIntegrationDto } from './dto/create-linear-integration.dto'
import { CreateWebhookIntegrationDto } from './dto/create-webhook-integration.dto'

@UseGuards(SupabaseAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  // Azure DevOps
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

  // Jira Cloud
  @Post('jira')
  upsertJira(@CurrentUser() user: AuthUser, @Body() dto: CreateJiraIntegrationDto) {
    return this.integrations.upsertJira(user.id, dto)
  }

  @Get('jira')
  getJira(@CurrentUser() user: AuthUser) {
    return this.integrations.getJira(user.id)
  }

  @Post('jira/sync/:issueId')
  syncToJira(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.integrations.syncToJira(user.id, issueId)
  }

  // Linear
  @Post('linear')
  upsertLinear(@CurrentUser() user: AuthUser, @Body() dto: CreateLinearIntegrationDto) {
    return this.integrations.upsertLinear(user.id, dto)
  }

  @Get('linear')
  getLinear(@CurrentUser() user: AuthUser) {
    return this.integrations.getLinear(user.id)
  }

  @Post('linear/sync/:issueId')
  syncToLinear(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.integrations.syncToLinear(user.id, issueId)
  }

  // Webhooks (Slack / MS Teams)
  @Post('webhooks')
  upsertWebhook(@CurrentUser() user: AuthUser, @Body() dto: CreateWebhookIntegrationDto) {
    return this.integrations.upsertWebhook(user.id, dto)
  }

  @Get('webhooks')
  getWebhooks(@CurrentUser() user: AuthUser) {
    return this.integrations.getWebhooks(user.id)
  }
}
