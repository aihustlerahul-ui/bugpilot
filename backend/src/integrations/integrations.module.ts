import { Module } from '@nestjs/common'
import { IntegrationsController } from './integrations.controller'
import { IntegrationsService } from './integrations.service'
import { EncryptionService } from './encryption.service'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { IssuesModule } from '../issues/issues.module'

@Module({
  imports: [WorkspacesModule, IssuesModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, EncryptionService],
})
export class IntegrationsModule {}
