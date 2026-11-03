import { Module } from '@nestjs/common'
import { MembersService } from './members.service'
import { MembersController } from './members.controller'
import { InviteService } from './invite.service'
import { MembersThrottlerGuard } from './members-throttler.guard'
import { WorkspacesModule } from '../workspaces/workspaces.module'

@Module({
  imports: [WorkspacesModule],
  providers: [MembersService, InviteService, MembersThrottlerGuard],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
