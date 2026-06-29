import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { IssuesService } from './issues.service'
import { CreateIssueDto } from './dto/create-issue.dto'
import type { AuthUser } from '../common/interfaces/auth-user.interface'

@Controller('issues')
@UseGuards(SupabaseAuthGuard)
export class IssuesController {
  constructor(private issues: IssuesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    return this.issues.create(user.id, dto)
  }

  @Get('project/:projectId')
  findByProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.issues.findByProject(user.id, projectId)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.findOne(user.id, id)
  }

  @Post(':id/replay-token')
  createReplayToken(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.createReplayToken(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.remove(user.id, id)
  }
}
