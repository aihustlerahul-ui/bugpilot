import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { MembersService } from './members.service'
import { CreateMemberDto } from './dto/create-member.dto'
import { AddProjectMemberDto } from './dto/add-project-member.dto'
import type { AuthUser } from '../common/interfaces/auth-user.interface'

@Controller('workspaces/members')
@UseGuards(SupabaseAuthGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.members.listWorkspaceMembers(user.id)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMemberDto) {
    return this.members.createMember(user.id, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<CreateMemberDto>) {
    return this.members.updateMember(user.id, id, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.deleteMember(user.id, id)
  }

  @Get('/project/:projectId')
  listProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.members.listProjectMembers(user.id, projectId)
  }

  @Post('/project/:projectId')
  addToProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.members.addToProject(user.id, projectId, dto)
  }

  @Delete('/project/:projectId/:memberId')
  removeFromProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.members.removeFromProject(user.id, projectId, memberId)
  }
}
