import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { CreateIssueDto } from './dto/create-issue.dto'

@Injectable()
export class IssuesService {
  constructor(private supabase: SupabaseService) {}

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

  private async uploadScreenshot(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(
        base64.replace(/^data:image\/\w+;base64,/, ''),
        'base64',
      )
      const { error } = await this.supabase.db.storage
        .from('screenshots')
        .upload(path, buffer, { contentType: 'image/png', upsert: false })
      if (error) return null

      const { data } = await this.supabase.db.storage
        .from('screenshots')
        .createSignedUrl(path, 60 * 60 * 24 * 365)
      return data?.signedUrl ?? null
    } catch {
      return null
    }
  }

  async create(userId: string, dto: CreateIssueDto) {
    const timestamp = Date.now()
    const basePath = `${userId}/${dto.project_id}/${timestamp}`

    const screenshotsRaw: { label: string; data: string }[] =
      Array.isArray(dto.metadata?.screenshots)
        ? (dto.metadata!.screenshots as { label: string; data: string }[])
        : []

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
    ])

    const screenshots = screenshotsRaw.length
      ? screenshotsRaw.map((img, i) => ({ label: img.label, url: screenshotUrls[i] })).filter(e => e.url)
      : undefined

    const metadataWithExtras = dto.metadata
      ? { ...dto.metadata, screenshots }
      : (screenshots ? { screenshots } : null)

    const { data, error } = await this.supabase.db
      .from('issues')
      .insert({
        project_id: dto.project_id,
        reporter_id: userId,
        title: dto.title ?? dto.description.split('\n')[0],
        description: dto.description,
        severity: dto.severity ?? 'Medium',
        url: dto.url ?? null,
        route: dto.route ?? null,
        browser_info: dto.browser_info ?? null,
        element_info: dto.element_info ?? null,
        screenshot_url,
        element_screenshot_url,
        replay_storage_path: replayPath ?? null,
        metadata: metadataWithExtras,
        sync_status: 'pending',
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  async findByProject(userId: string, projectId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data ?? []
  }

  async findOne(userId: string, issueId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single()
    if (error) throw new NotFoundException('Issue not found')

    let replayUrl: string | null = null;
    if (data.replay_storage_path) {
      const { data: signed } = await this.supabase.db.storage
        .from('qa-replays')
        .createSignedUrl(data.replay_storage_path, 60 * 60); // 1 hour
      replayUrl = signed?.signedUrl ?? null;
    }

    return { ...data, replayUrl };
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
      .eq('id', issueId)
  }

  async remove(userId: string, issueId: string) {
    const { data: issue, error: fetchError } = await this.supabase.db
      .from('issues')
      .select('id, replay_storage_path')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single()

    if (fetchError || !issue) throw new NotFoundException('Issue not found')

    if (issue.replay_storage_path) {
      const { error: storageError } = await this.supabase.db.storage
        .from('qa-replays')
        .remove([issue.replay_storage_path])
      if (storageError) {
        throw new Error(`Failed to delete replay: ${storageError.message}`)
      }
    }

    const { error: deleteError } = await this.supabase.db
      .from('issues')
      .delete()
      .eq('id', issueId)
      .eq('reporter_id', userId)

    if (deleteError) throw new Error(deleteError.message)
    return { ok: true }
  }
}
