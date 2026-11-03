import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard';
import { ApiKeyAllowed } from '../common/decorators/api-key-allowed.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { IssuesService } from './issues.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UploadVideoDto } from './dto/upload-video.dto';
import { AttachVideoDto } from './dto/attach-video.dto';
import { UploadThumbnailDto } from './dto/upload-thumbnail.dto';
import {
  CompleteChunkUploadDto,
  InitChunkUploadDto,
  UploadChunkDto,
} from './dto/chunk-upload.dto';
import {
  PinIssueDto,
  ResolveSourceMapDto,
  RetentionCleanupDto,
} from './dto/retention.dto';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { AssignIssueDto } from './dto/assign-issue.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

@Controller('issues')
@UseGuards(SupabaseAuthGuard)
export class IssuesController {
  constructor(
    private issues: IssuesService,
    private comments: CommentsService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    return this.issues.create(user, dto);
  }

  @Get('dashboard/metrics')
  getDashboardMetrics(@CurrentUser() user: AuthUser) {
    return this.issues.getDashboardMetrics(user);
  }

  @ApiKeyAllowed()
  @Get('project/:projectId/members')
  listAssignableMembers(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.issues.listAssignableMembers(user, projectId);
  }

  @ApiKeyAllowed()
  @Get('project/:projectId')
  findByProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.issues.findByProject(user, projectId);
  }

  @Post('retention/cleanup')
  retentionCleanup(@CurrentUser() user: AuthUser, @Body() dto: RetentionCleanupDto) {
    return this.issues.runRetentionCleanup(user, dto.retention_days, dto.dry_run);
  }

  @Post('resolve-stack')
  resolveStack(@Body() dto: ResolveSourceMapDto) {
    return this.issues.resolveStack(dto.file, dto.line, dto.col, dto.stack);
  }

  @ApiKeyAllowed()
  @Get(':id/comments')
  listComments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.list(user, id);
  }

  @ApiKeyAllowed()
  @Post(':id/comments')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    const source = user.authMethod === 'api_key' ? 'mcp' : 'web';
    return this.comments.add(user, id, dto.body, source);
  }

  @ApiKeyAllowed()
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.findOne(user, id);
  }

  @ApiKeyAllowed()
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.issues.updateStatus(user, id, dto.status);
  }

  @ApiKeyAllowed()
  @Patch(':id/assignee')
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignIssueDto) {
    return this.issues.assign(user, id, dto.memberId ?? null);
  }

  @Post(':id/replay-token')
  createReplayToken(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.createReplayToken(user.id, id);
  }

  @Patch(':id/pin')
  togglePin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PinIssueDto) {
    return this.issues.togglePin(user.id, id, dto.pinned);
  }

  @Post(':id/resolve-sourcemap')
  resolveSourceMap(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.resolveIssueSourceMap(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.remove(user.id, id);
  }

  @Post('upload-video')
  uploadVideo(@CurrentUser() user: AuthUser, @Body() dto: UploadVideoDto) {
    return this.issues.uploadVideoFile(user.id, dto.project_id, dto.video);
  }

  @Post('upload-thumbnail')
  uploadThumbnail(@CurrentUser() user: AuthUser, @Body() dto: UploadThumbnailDto) {
    return this.issues.uploadThumbnailFile(user.id, dto.project_id, dto.thumbnail);
  }

  @Post('upload-chunk/init')
  initChunkUpload(@CurrentUser() user: AuthUser, @Body() dto: InitChunkUploadDto) {
    return this.issues.initChunkUpload(user.id, dto);
  }

  @Post('upload-chunk')
  uploadChunk(@CurrentUser() user: AuthUser, @Body() dto: UploadChunkDto) {
    return this.issues.uploadChunk(user.id, dto);
  }

  @Post('upload-chunk/complete')
  completeChunkUpload(@CurrentUser() user: AuthUser, @Body() dto: CompleteChunkUploadDto) {
    return this.issues.completeChunkUpload(user.id, dto);
  }

  @Patch(':id/video')
  attachVideo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttachVideoDto) {
    return this.issues.attachVideo(user.id, id, dto);
  }
}
