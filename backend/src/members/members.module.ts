import { Module } from '@nestjs/common'
import { MembersService } from './members.service'
import { MembersController } from './members.controller'
import { InviteService } from './invite.service'
import { WorkspacesModule } from '../workspaces/workspaces.module'

@Module({
  imports: [WorkspacesModule],
  providers: [MembersService, InviteService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
