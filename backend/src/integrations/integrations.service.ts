import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'

// Azure Bug field → QA Reporter source field (default mapping)
const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  'System.Title': 'description',
  'Microsoft.VSTS.TCM.ReproSteps': 'repro_steps',
  'System.Description': 'system_info',
}

// All Azure Bug fields the user can map to
export const AZURE_FIELDS = [
  { field: 'System.Title', label: 'Title', required: true },
  { field: 'Microsoft.VSTS.TCM.ReproSteps', label: 'Repro Steps' },
  { field: 'System.Description', label: 'Description / System Info' },
  { field: 'Microsoft.VSTS.Common.Priority', label: 'Priority' },
  { field: 'Microsoft.VSTS.Common.Severity', label: 'Severity' },
]

// QA Reporter fields the user can pick as sources
export const QA_SOURCE_FIELDS = [
  { key: 'description', label: 'Bug description' },
  { key: 'url', label: 'Page URL' },
  { key: 'route', label: 'App route' },
  { key: 'screenshot_url', label: 'Screenshot link' },
  { key: 'browser_info', label: 'Browser / OS info' },
  { key: 'element_info', label: 'Element info' },
  { key: 'repro_steps', label: 'Repro Steps (auto-built)' },
  { key: 'system_info', label: 'System Info (auto-built)' },
]
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { IssuesService } from '../issues/issues.service'
import { EncryptionService } from './encryption.service'
import type { CreateAzureIntegrationDto } from './dto/create-azure-integration.dto'

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly workspaces: WorkspacesService,
    private readonly issues: IssuesService,
    private readonly encryption: EncryptionService,
  ) {}

  async upsertAzure(userId: string, dto: CreateAzureIntegrationDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const orgUrl = dto.orgUrl.trim().replace(/\/$/, '')
    const projectName = dto.projectName.trim()
    const config: Record<string, any> = {
      org_url: orgUrl,
      project_name: projectName,
      field_mapping: dto.fieldMapping ?? DEFAULT_FIELD_MAPPING,
    }

    // Fetch existing integration to check if PAT is already stored
    const { data: existing } = await this.supabase.db
      .from('integrations')
      .select('pat_encrypted')
      .eq('workspace_id', workspace.id)
      .eq('provider', 'azure_devops')
      .single()

    const newPat = dto.pat?.trim()
    if (!newPat && !existing?.pat_encrypted) throw new BadRequestException('PAT is required')

    const encryptedPat = newPat
      ? this.encryption.encrypt(newPat)
      : existing!.pat_encrypted

    const patForTest = newPat ?? this.encryption.decrypt(existing!.pat_encrypted)
    await this.testAzureConnection(orgUrl, projectName, patForTest)

    const { data, error } = await this.supabase.db
      .from('integrations')
      .upsert(
        { workspace_id: workspace.id, provider: 'azure_devops', config, pat_encrypted: encryptedPat },
        { onConflict: 'workspace_id,provider' },
      )
      .select()
      .single()

    if (error) throw new BadRequestException(error.message)
    return { id: data.id, config: { org_url: orgUrl, project_name: projectName, field_mapping: config.field_mapping } }
  }

  async getAzure(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'azure_devops')
      .single()

    if (!data || !data.pat_encrypted) return null
    try {
      const pat = this.encryption.decrypt(data.pat_encrypted)
      if (!pat?.trim()) return null
      await this.testAzureConnection(data.config.org_url, data.config.project_name, pat)
    } catch {
      return { id: data.id, config: data.config, invalid: true }
    }
    return { id: data.id, config: data.config, invalid: false }
  }

  async syncToAzure(userId: string, issueId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const issue = await this.issues.findOne(userId, issueId)

    const { data: integration } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'azure_devops')
      .single()

    if (!integration) throw new NotFoundException('Azure DevOps integration not configured')

    const { org_url, project_name } = integration.config
    const pat = this.encryption.decrypt(integration.pat_encrypted)

    const baseUrl = org_url.replace(/\/$/, '')
    const workItemUrl = `${baseUrl}/${project_name}/_apis/wit/workitems/$Bug?api-version=7.1`
    const mapping: Record<string, string> = integration.config.field_mapping ?? DEFAULT_FIELD_MAPPING
    const body = this.buildPatchBody(issue, mapping)

    // Upload screenshot as Azure attachment if present
    if (issue.screenshot_url) {
      const attachmentUrl = await this.uploadScreenshotAttachment(baseUrl, project_name, pat, issue.screenshot_url).catch(() => null)
      if (attachmentUrl) {
        body.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: attachmentUrl, attributes: { comment: 'Screenshot captured by QA Reporter' } } } as any)
      }
    }

    const res = await fetch(workItemUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    })

    const contentType = res.headers.get('content-type') ?? ''
    const responseText = await res.text().catch(() => '')
    const isJson = contentType.includes('application/json') || contentType.includes('application/json-patch')

    if (!res.ok || !isJson) {
      let message: string
      if (!isJson) {
        message = 'Azure DevOps rejected the request — your PAT may be expired or invalid. Please reconnect the Azure connector with a fresh PAT.'
      } else {
        message = `Azure API error: ${res.status}`
        try { message = JSON.parse(responseText)?.message ?? message } catch { /* ignore */ }
      }
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException(message)
    }

    let created: any
    try {
      created = JSON.parse(responseText)
    } catch {
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException('Azure returned an unexpected response format. Please reconnect the Azure connector.')
    }
    const externalId = String(created.id)
    const externalUrl = created._links?.html?.href ?? `${org_url}/${project_name}/_workitems/edit/${created.id}`

    // Log the sync
    await this.supabase.db.from('issue_sync_logs').insert({
      issue_id: issueId,
      integration_id: integration.id,
      external_id: externalId,
      external_url: externalUrl,
    })

    await this.issues.updateSyncStatus(issueId, 'synced', externalId, externalUrl)
    return { externalId, externalUrl }
  }

  private buildPatchBody(issue: any, mapping: Record<string, string>) {
    return Object.entries(mapping)
      .filter(([, source]) => !!source)
      .map(([azureField, source]) => ({
        op: 'add',
        path: `/fields/${azureField}`,
        value: this.resolveSource(issue, source),
      }))
      .filter(op => op.value !== null && op.value !== '')
  }

  private resolveSource(issue: any, source: string): string {
    switch (source) {
      case 'description': return issue.description ?? ''
      case 'url': return issue.url ?? ''
      case 'route': return issue.route ?? ''
      case 'screenshot_url':
        return issue.screenshot_url ? `<a href="${issue.screenshot_url}">View screenshot</a>` : ''
      case 'browser_info': {
        const b = issue.browser_info ?? {}
        return [b.browser, b.version, b.os].filter(Boolean).join(' / ')
      }
      case 'element_info': {
        const e = issue.element_info ?? {}
        return [e.tag, e.id ? `#${e.id}` : '', e.text].filter(Boolean).join(' ')
      }
      case 'repro_steps': {
        const parts: string[] = []
        if (issue.url) parts.push(`<p><strong>Page URL:</strong> <a href="${issue.url}">${issue.url}</a></p>`)
        if (issue.route) parts.push(`<p><strong>Route:</strong> ${issue.route}</p>`)
        if (issue.screenshot_url) parts.push(`<p><strong>Screenshot:</strong> <a href="${issue.screenshot_url}">View screenshot</a></p>`)
        return parts.join('') || `<p>${issue.description}</p>`
      }
      case 'system_info': {
        const parts: string[] = []
        const b = issue.browser_info ?? {}
        const browser = [b.browser, b.version, b.os].filter(Boolean).join(' / ')
        if (browser) parts.push(`<p><strong>Browser:</strong> ${browser}</p>`)
        const e = issue.element_info ?? {}
        const el = [e.tag, e.id ? `#${e.id}` : '', e.text].filter(Boolean).join(' ')
        if (el) parts.push(`<p><strong>Element:</strong> ${el}</p>`)
        parts.push('<p><strong>Reported via:</strong> QA Reporter</p>')
        return parts.join('')
      }
      default: return ''
    }
  }

  private async uploadScreenshotAttachment(baseUrl: string, projectName: string, pat: string, screenshotUrl: string): Promise<string> {
    // Fetch the image from Supabase
    const imageRes = await fetch(screenshotUrl)
    if (!imageRes.ok) throw new Error('Could not fetch screenshot')
    const imageBuffer = await imageRes.arrayBuffer()
    const contentType = imageRes.headers.get('content-type') ?? 'image/png'
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png'

    // Upload to Azure DevOps attachments API
    const uploadRes = await fetch(
      `${baseUrl}/${projectName}/_apis/wit/attachments?fileName=screenshot.${ext}&api-version=7.1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        },
        body: imageBuffer,
      },
    )
    if (!uploadRes.ok) throw new Error(`Attachment upload failed: ${uploadRes.status}`)
    const uploaded = await uploadRes.json() as any
    return uploaded.url
  }

  private async testAzureConnection(orgUrl: string, projectName: string, pat: string) {
    const baseUrl = orgUrl.replace(/\/$/, '')
    const url = `${baseUrl}/_apis/projects/${projectName}?api-version=7.1`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` },
    })
    if (!res.ok) throw new BadRequestException(`Azure DevOps connection test failed (${res.status}) — check your org URL, project name, and PAT scopes`)
  }
}
