import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { CreateIssueDto } from './dto/create-issue.dto'

@Injectable()
export class IssuesService {
  constructor(private supabase: SupabaseService) {}

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

    const [screenshot_url, element_screenshot_url] = await Promise.all([
      dto.screenshot
        ? this.uploadScreenshot(dto.screenshot, `${basePath}-screenshot.png`)
        : Promise.resolve(null),
      dto.element_screenshot
        ? this.uploadScreenshot(dto.element_screenshot, `${basePath}-element.png`)
        : Promise.resolve(null),
    ])

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
        metadata: dto.metadata ?? null,
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
      .single()
    if (error) throw new NotFoundException('Issue not found')
    return data
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
}
