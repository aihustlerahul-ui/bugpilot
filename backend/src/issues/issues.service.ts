import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { AttachVideoDto } from './dto/attach-video.dto';
import {
  ChunkUploadType,
  CompleteChunkUploadDto,
  InitChunkUploadDto,
  UploadChunkDto,
} from './dto/chunk-upload.dto';
import { SourceMapService } from './source-map.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { randomUUID } from 'crypto';
import { assertOwnedStoragePath } from './storage-path';

interface ChunkSession {
  uploadId: string;
  userId: string;
  projectId: string;
  type: ChunkUploadType;
  totalChunks: number;
  totalSize?: number;
  filename?: string;
  chunks: Map<number, string>;
  createdAt: number;
}

@Injectable()
export class IssuesService {
  private readonly chunkSessions = new Map<string, ChunkSession>();

  constructor(
    private supabase: SupabaseService,
    private sourceMap: SourceMapService,
    private workspaces: WorkspacesService,
    private access: AccessService,
  ) {}

  private cleanupStaleSessions() {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, session] of this.chunkSessions.entries()) {
      if (session.createdAt < twoHoursAgo) {
        this.chunkSessions.delete(id);
      }
    }
  }

  // ── Chunked Upload Methods ────────────────────────────────────────────────
  async initChunkUpload(userId: string, dto: InitChunkUploadDto): Promise<{ uploadId: string }> {
    this.cleanupStaleSessions();
    const uploadId = randomUUID();
    this.chunkSessions.set(uploadId, {
      uploadId,
      userId,
      projectId: dto.project_id,
      type: dto.type,
      totalChunks: dto.total_chunks,
      totalSize: dto.total_size,
      filename: dto.filename,
      chunks: new Map<number, string>(),
      createdAt: Date.now(),
    });
    return { uploadId };
  }

  async uploadChunk(userId: string, dto: UploadChunkDto) {
    const session = this.chunkSessions.get(dto.upload_id);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Upload session not found or expired');
    }

    if (dto.chunk_index < 0 || dto.chunk_index >= session.totalChunks) {
      throw new BadRequestException(`Invalid chunk index ${dto.chunk_index}`);
    }

    session.chunks.set(dto.chunk_index, dto.chunk_data);

    return {
      ok: true,
      chunkIndex: dto.chunk_index,
      uploadedChunks: session.chunks.size,
      totalChunks: session.totalChunks,
    };
  }

  async completeChunkUpload(userId: string, dto: CompleteChunkUploadDto): Promise<{ storagePath: string }> {
    const session = this.chunkSessions.get(dto.upload_id);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Upload session not found or expired');
    }

    if (session.chunks.size < session.totalChunks) {
      const missing: number[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        if (!session.chunks.has(i)) missing.push(i);
      }
      throw new BadRequestException(`Missing chunks: ${missing.slice(0, 10).join(', ')} (total missing: ${missing.length})`);
    }

    // Assemble base64 string in index order and decode once
    const orderedChunks: string[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      orderedChunks.push(session.chunks.get(i)!);
    }
    const fullBase64 = orderedChunks.join('').replace(/^data:[^;]+;base64,/, '');
    const fullBuffer = Buffer.from(fullBase64, 'base64');
    const timestamp = Date.now();

    let storagePath: string | null = null;
    if (session.type === ChunkUploadType.REPLAY) {
      const path = `${userId}/${session.projectId}/${timestamp}-replay.json.gz`;
      const { error } = await this.supabase.db.storage
        .from('qa-replays')
        .upload(path, fullBuffer, { contentType: 'application/gzip', upsert: false });
      if (error) throw new Error(`Replay storage upload failed: ${error.message}`);
      storagePath = path;
    } else if (session.type === ChunkUploadType.THUMBNAIL) {
      const path = `${userId}/${session.projectId}/${timestamp}-thumb.jpg`;
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, fullBuffer, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error(`Thumbnail storage upload failed: ${error.message}`);
      storagePath = path;
    } else {
      // VIDEO or WEBCAM
      const ext = session.type === ChunkUploadType.WEBCAM ? 'webcam.webm' : 'video.webm';
      const path = `${userId}/${session.projectId}/${timestamp}-${ext}`;
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, fullBuffer, { contentType: 'video/webm', upsert: false });
      if (error) throw new Error(`Video storage upload failed: ${error.message}`);
      storagePath = path;
    }

    // Attach to issue if issue_id provided
    if (dto.issue_id && storagePath) {
      if (session.type === ChunkUploadType.REPLAY) {
        await this.supabase.db
          .from('issues')
          .update({ replay_storage_path: storagePath })
          .eq('id', dto.issue_id)
          .eq('reporter_id', userId);
      } else if (session.type === ChunkUploadType.VIDEO) {
        await this.supabase.db
          .from('issues')
          .update({ video_storage_path: storagePath })
          .eq('id', dto.issue_id)
          .eq('reporter_id', userId);
      } else if (session.type === ChunkUploadType.WEBCAM) {
        await this.supabase.db
          .from('issues')
          .update({ webcam_storage_path: storagePath })
          .eq('id', dto.issue_id)
          .eq('reporter_id', userId);
      } else if (session.type === ChunkUploadType.THUMBNAIL) {
        await this.supabase.db
          .from('issues')
          .update({ thumbnail_storage_path: storagePath })
          .eq('id', dto.issue_id)
          .eq('reporter_id', userId);
      }
    }

    this.chunkSessions.delete(dto.upload_id);
    return { storagePath };
  }

  // ── Data Retention Policy & Cleanup ───────────────────────────────────────
  /** Global cleanup touches every tenant: only ids in RETENTION_ADMIN_USER_IDS may run it. */
  private assertRetentionAdmin(user: AuthUser) {
    const allowed = (process.env.RETENTION_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!user?.id || !allowed.includes(user.id)) {
      throw new ForbiddenException('Not allowed to run retention cleanup');
    }
  }

  async runRetentionCleanup(user: AuthUser, retentionDays = 14, dryRun = false) {
    this.assertRetentionAdmin(user);
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    
    // Query issues older than retention policy
    const { data: expiredIssues, error } = await this.supabase.db
      .from('issues')
      .select('id, reporter_id, project_id, replay_storage_path, video_storage_path, webcam_storage_path, thumbnail_storage_path, metadata')
      .lt('created_at', cutoffDate);

    if (error) throw new Error(`Failed to query expired issues: ${error.message}`);
    if (!expiredIssues || expiredIssues.length === 0) {
      return {
        retentionDays,
        cutoffDate,
        dryRun,
        cleanedCount: 0,
        freedReplays: 0,
        freedVideos: 0,
      };
    }

    // Exclude pinned issues (metadata.is_pinned === true or metadata.pinned === true)
    const eligibleIssues = expiredIssues.filter(issue => {
      const meta = (issue.metadata || {}) as Record<string, unknown>;
      return !meta.is_pinned && !meta.pinned;
    });

    const replayPaths: string[] = [];
    const videoPaths: string[] = [];
    const issueIdsToUpdate: string[] = [];

    for (const issue of eligibleIssues) {
      let hasStorage = false;
      if (issue.replay_storage_path) {
        replayPaths.push(issue.replay_storage_path);
        hasStorage = true;
      }
      if (issue.video_storage_path) {
        videoPaths.push(issue.video_storage_path);
        hasStorage = true;
      }
      if (issue.webcam_storage_path) {
        videoPaths.push(issue.webcam_storage_path);
        hasStorage = true;
      }
      if (issue.thumbnail_storage_path) {
        videoPaths.push(issue.thumbnail_storage_path);
        hasStorage = true;
      }
      if (hasStorage) {
        issueIdsToUpdate.push(issue.id);
      }
    }

    if (!dryRun && issueIdsToUpdate.length > 0) {
      // 1. Remove storage artifacts from Supabase Storage
      if (replayPaths.length > 0) {
        await this.supabase.db.storage.from('qa-replays').remove(replayPaths).catch(() => null);
      }
      if (videoPaths.length > 0) {
        await this.supabase.db.storage.from('videos').remove(videoPaths).catch(() => null);
      }

      // 2. Clear storage paths in database and mark retention_cleaned_at
      for (const issue of eligibleIssues) {
        if (!issueIdsToUpdate.includes(issue.id)) continue;
        const meta = (issue.metadata || {}) as Record<string, unknown>;
        await this.supabase.db
          .from('issues')
          .update({
            replay_storage_path: null,
            video_storage_path: null,
            webcam_storage_path: null,
            thumbnail_storage_path: null,
            metadata: {
              ...meta,
              retention_cleaned_at: new Date().toISOString(),
            },
          })
          .eq('id', issue.id);
      }
    }

    return {
      retentionDays,
      cutoffDate,
      dryRun,
      cleanedCount: issueIdsToUpdate.length,
      freedReplays: replayPaths.length,
      freedVideos: videoPaths.length,
    };
  }

  async togglePin(userId: string, issueId: string, pinned: boolean) {
    const { data: issue, error: fetchErr } = await this.supabase.db
      .from('issues')
      .select('id, metadata')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single();

    if (fetchErr || !issue) throw new NotFoundException('Issue not found');

    const meta = (issue.metadata || {}) as Record<string, unknown>;
    const updatedMeta = { ...meta, is_pinned: pinned };

    const { data, error } = await this.supabase.db
      .from('issues')
      .update({ metadata: updatedMeta })
      .eq('id', issueId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // ── Source Map Resolution ─────────────────────────────────────────────────
  async resolveIssueSourceMap(userId: string, issueId: string) {
    const issue = await this.findOneForReporter(userId, issueId);
    const elementInfo = (issue.element_info || {}) as Record<string, any>;
    const reactInfo = elementInfo.react;

    if (!reactInfo || !reactInfo.source || !reactInfo.source.file) {
      return { ok: false, message: 'No React source location found in issue' };
    }

    const { file, line, col } = reactInfo.source;
    const resolved = await this.sourceMap.resolveLocation(file, line, col);

    const updatedReact = {
      ...reactInfo,
      resolvedSource: resolved,
    };

    const updatedElementInfo = {
      ...elementInfo,
      react: updatedReact,
    };

    await this.supabase.db
      .from('issues')
      .update({ element_info: updatedElementInfo })
      .eq('id', issueId);

    return { ok: true, resolved };
  }

  async resolveStack(file?: string, line?: number, col?: number, stack?: string) {
    if (stack) {
      const resolvedStack = await this.sourceMap.resolveStackTrace(stack);
      return { resolvedStack };
    }
    const resolvedLocation = await this.sourceMap.resolveLocation(file, line, col);
    return { resolvedLocation };
  }

  // ── Standard issue operations ─────────────────────────────────────────────
  private async uploadReplay(base64Gzip: string, path: string): Promise<string | null> {
    try {
      const binary = Buffer.from(base64Gzip, 'base64');
      const { error } = await this.supabase.db.storage
        .from('qa-replays')
        .upload(path, binary, { contentType: 'application/gzip', upsert: false });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  }

  private async uploadVideo(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(base64.replace(/^data:video\/\w+;base64,/, ''), 'base64');
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, buffer, { contentType: 'video/webm', upsert: false });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  }

  private async uploadThumbnail(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  }

  async uploadThumbnailFile(userId: string, projectId: string, base64: string): Promise<{ storagePath: string }> {
    const timestamp = Date.now();
    const path = `${userId}/${projectId}/${timestamp}-thumb.jpg`;
    const storagePath = await this.uploadThumbnail(base64, path);
    if (!storagePath) throw new Error('Thumbnail upload failed');
    return { storagePath };
  }

  private async uploadScreenshot(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(
        base64.replace(/^data:image\/\w+;base64,/, ''),
        'base64',
      );
      const { error } = await this.supabase.db.storage
        .from('screenshots')
        .upload(path, buffer, { contentType: 'image/png', upsert: false });
      if (error) return null;

      const { data } = await this.supabase.db.storage
        .from('screenshots')
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  async create(user: AuthUser, dto: CreateIssueDto) {
    await this.access.assertCanAccessProject(user, dto.project_id);
    assertOwnedStoragePath(dto.videoStoragePath, user.id, dto.project_id);
    const userId = user.id;
    const timestamp = Date.now();
    const basePath = `${userId}/${dto.project_id}/${timestamp}`;

    const screenshotsRaw: { label: string; data: string }[] =
      Array.isArray(dto.metadata?.screenshots)
        ? (dto.metadata!.screenshots as { label: string; data: string }[])
        : [];

    // Upload all images in parallel — no limit
    const [screenshot_url, element_screenshot_url, replayPath, ...screenshotUrls] = await Promise.all([
      dto.screenshot
        ? this.uploadScreenshot(dto.screenshot, `${basePath}-screenshot.png`)
        : Promise.resolve(null),
      dto.element_screenshot
        ? this.uploadScreenshot(dto.element_screenshot, `${basePath}-element.png`)
        : Promise.resolve(null),
      dto.replay_data
        ? this.uploadReplay(dto.replay_data, `${userId}/${dto.project_id}/${timestamp}-replay.json.gz`)
        : Promise.resolve(null),
      ...screenshotsRaw.map((img, i) =>
        img.data
          ? this.uploadScreenshot(img.data, `${basePath}-img-${i}.png`)
          : Promise.resolve(null),
      ),
    ]);

    const screenshots = screenshotsRaw.length
      ? screenshotsRaw.map((img, i) => ({ label: img.label, url: screenshotUrls[i] })).filter(e => e.url)
      : undefined;

    const metadataWithExtras = dto.metadata
      ? { ...dto.metadata, screenshots }
      : (screenshots ? { screenshots } : null);

    const { data, error } = await this.supabase.db
      .from('issues')
      .insert({
        project_id: dto.project_id,
        reporter_id: userId,
        title: dto.title ?? dto.description.split('\n')[0],
        description: dto.description,
        status: dto.status ?? 'Incoming',
        severity: dto.severity ?? 'Medium',
        url: dto.url ?? null,
        route: dto.route ?? null,
        browser_info: dto.browser_info ?? null,
        element_info: dto.element_info ?? null,
        screenshot_url,
        element_screenshot_url,
        replay_storage_path: replayPath ?? null,
        video_storage_path: dto.videoStoragePath ?? null,
        metadata: metadataWithExtras,
        sync_status: 'pending',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async findByProject(user: AuthUser, projectId: string) {
    await this.access.assertCanAccessProject(user, projectId);
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findOne(user: AuthUser, issueId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .single();
    if (error || !data) throw new NotFoundException('Issue not found');

    const role = await this.access.getProjectRole(user, data.project_id);
    if (!role) throw new NotFoundException('Issue not found');

    return this.withSignedUrls(data);
  }

  /**
   * Reporter-scoped lookup kept for callers that only pass a user id
   * (integration sync, source-map resolution). Behaviour unchanged.
   */
  async findOneForReporter(userId: string, issueId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single();
    if (error) throw new NotFoundException('Issue not found');
    return this.withSignedUrls(data);
  }

  private async withSignedUrls(data: any) {
    let replayUrl: string | null = null;
    if (data.replay_storage_path) {
      const { data: signed } = await this.supabase.db.storage
        .from('qa-replays')
        .createSignedUrl(data.replay_storage_path, 60 * 60); // 1 hour
      replayUrl = signed?.signedUrl ?? null;
    }

    let videoUrl: string | null = null;
    if (data.video_storage_path) {
      const { data: signedVideo } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.video_storage_path, 60 * 60); // 1 hour
      videoUrl = signedVideo?.signedUrl ?? null;
    }

    let webcamUrl: string | null = null;
    if (data.webcam_storage_path) {
      const { data: signedWebcam } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.webcam_storage_path, 60 * 60); // 1 hour
      webcamUrl = signedWebcam?.signedUrl ?? null;
    }

    let thumbnailUrl: string | null = null;
    if (data.thumbnail_storage_path) {
      const { data: signedThumbnail } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.thumbnail_storage_path, 60 * 60); // 1 hour
      thumbnailUrl = signedThumbnail?.signedUrl ?? null;
    }

    return { ...data, replayUrl, videoUrl, webcamUrl, thumbnailUrl };
  }

  async uploadVideoFile(userId: string, projectId: string, base64: string): Promise<{ storagePath: string }> {
    const timestamp = Date.now();
    const path = `${userId}/${projectId}/${timestamp}-video.webm`;
    const storagePath = await this.uploadVideo(base64, path);
    if (!storagePath) throw new Error('Video upload failed');
    return { storagePath };
  }

  async attachVideo(userId: string, issueId: string, dto: AttachVideoDto) {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, project_id')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .maybeSingle();
    if (!issue) throw new NotFoundException('Issue not found');
    for (const path of [dto.videoStoragePath, dto.webcamStoragePath, dto.thumbnailStoragePath]) {
      assertOwnedStoragePath(path, userId, issue.project_id);
    }

    const patch: { video_storage_path: string; webcam_storage_path?: string; thumbnail_storage_path?: string } = {
      video_storage_path: dto.videoStoragePath,
    };
    if (dto.webcamStoragePath) patch.webcam_storage_path = dto.webcamStoragePath;
    if (dto.thumbnailStoragePath) patch.thumbnail_storage_path = dto.thumbnailStoragePath;

    const { data, error } = await this.supabase.db
      .from('issues')
      .update(patch)
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .select()
      .single();

    if (error || !data) throw new NotFoundException('Issue not found');
    return data;
  }

  async createReplayToken(userId: string, issueId: string): Promise<{ token: string; url: string }> {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, replay_storage_path')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single();

    if (!issue?.replay_storage_path) {
      throw new NotFoundException('No replay available for this issue');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.db
      .from('replay_tokens')
      .insert({ issue_id: issueId, expires_at: expiresAt, created_by: userId })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    const url = `${process.env.PLATFORM_URL ?? 'http://localhost:3000'}/replay/${data.id}`;
    return { token: data.id, url };
  }

  async updateSyncStatus(
    issueId: string,
    status: 'pending' | 'synced' | 'failed',
    externalTicketId?: string,
    externalTicketUrl?: string,
  ) {
    await this.supabase.db
      .from('issues')
      .update({
        sync_status: status,
        external_ticket_id: externalTicketId ?? null,
        external_ticket_url: externalTicketUrl ?? null,
      })
      .eq('id', issueId);
  }

  async remove(userId: string, issueId: string) {
    const { data: issue, error: fetchError } = await this.supabase.db
      .from('issues')
      .select('id, replay_storage_path')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single();

    if (fetchError || !issue) throw new NotFoundException('Issue not found');

    if (issue.replay_storage_path) {
      const { error: storageError } = await this.supabase.db.storage
        .from('qa-replays')
        .remove([issue.replay_storage_path]);
      if (storageError) {
        throw new Error(`Failed to delete replay: ${storageError.message}`);
      }
    }

    const { error: deleteError } = await this.supabase.db
      .from('issues')
      .delete()
      .eq('id', issueId)
      .eq('reporter_id', userId);

    if (deleteError) throw new Error(deleteError.message);
    return { ok: true };
  }

  /**
   * Owners may set any status; non-owner project members may only mark an
   * issue Resolved. Anyone without project access gets 404.
   */
  async updateStatus(user: AuthUser, issueId: string, status: string) {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, project_id')
      .eq('id', issueId)
      .maybeSingle();
    if (!issue) throw new NotFoundException('Issue not found');
    const role = await this.access.getProjectRole(user, issue.project_id);
    if (!role) throw new NotFoundException('Issue not found');
    if (role !== 'owner' && status !== 'Resolved') {
      throw new ForbiddenException('Members can only mark issues as Resolved');
    }

    const { data, error } = await this.supabase.db
      .from('issues')
      .update({ status })
      .eq('id', issueId)
      .eq('project_id', issue.project_id)
      .select()
      .single();

    if (error || !data) throw new NotFoundException('Issue not found');
    return data;
  }

  async getDashboardMetrics(user: AuthUser) {
    const projectList = await this.access.listAccessibleProjects(user);
    if (projectList.length === 0) {
      return { total: 0, open: 0, critical: 0, resolved: 0, trend: [], recentIssues: [] };
    }

    const projectIds = projectList.map((p) => p.id);
    const { data: issues } = await this.supabase.db
      .from('issues')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    const list = issues ?? [];
    const openStatuses = ['Incoming', 'In Triage', 'Confirmed', 'In Dev'];
    const resolvedStatuses = ['Resolved', 'Closed'];

    const open = list.filter((i) => openStatuses.includes(i.status ?? 'Incoming')).length;
    const critical = list.filter(
      (i) =>
        (i.severity === 'Critical' || i.severity === 'critical') &&
        !resolvedStatuses.includes(i.status ?? 'Incoming'),
    ).length;
    const resolved = list.filter((i) => resolvedStatuses.includes(i.status ?? 'Incoming')).length;

    // 7-day sparkline aggregation
    const now = Date.now();
    const trend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - (6 - i) * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const count = list.filter((issue) => issue.created_at?.startsWith(dateStr)).length;
      return { date: dateStr, count };
    });

    const projectMap = new Map(projectList.map((p) => [p.id, p.name]));
    const recentIssues = list.slice(0, 10).map((issue) => ({
      ...issue,
      projectName: projectMap.get(issue.project_id) ?? 'Project',
    }));

    return { total: list.length, open, critical, resolved, trend, recentIssues };
  }
}
