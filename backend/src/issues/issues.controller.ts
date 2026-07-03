import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { IssuesService } from './issues.service'
import { CreateIssueDto } from './dto/create-issue.dto'
import { UploadVideoDto } from './dto/upload-video.dto'
import { AttachVideoDto } from './dto/attach-video.dto'
import { UploadThumbnailDto } from './dto/upload-thumbnail.dto'
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

  @Post('upload-video')
  uploadVideo(@CurrentUser() user: AuthUser, @Body() dto: UploadVideoDto) {
    return this.issues.uploadVideoFile(user.id, dto.project_id, dto.video)
  }

  @Post('upload-thumbnail')
  uploadThumbnail(@CurrentUser() user: AuthUser, @Body() dto: UploadThumbnailDto) {
    return this.issues.uploadThumbnailFile(user.id, dto.project_id, dto.thumbnail)
  }

  @Patch(':id/video')
  attachVideo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttachVideoDto) {
    return this.issues.attachVideo(user.id, id, dto)
  }
}
