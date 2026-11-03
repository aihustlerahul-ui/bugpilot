import { Global, Module } from '@nestjs/common'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { AccessService } from './access.service'

@Global()
@Module({
  imports: [WorkspacesModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
