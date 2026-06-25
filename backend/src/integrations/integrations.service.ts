import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'

// Azure Bug field → QA Reporter source field (default mapping)
const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  'System.Title': 'description',
  'Microsoft.VSTS.TCM.ReproSteps': 'repro_steps',
  'System.Description': 'system_info',
  'System.AssignedTo': 'assignee',
}

// All Azure Bug fields the user can map to
export const AZURE_FIELDS = [
  { field: 'System.Title', label: 'Title', required: true },
  { field: 'Microsoft.VSTS.TCM.ReproSteps', label: 'Repro Steps' },
  { field: 'System.Description', label: 'Description / System Info' },
  { field: 'System.AssignedTo',              label: 'Assigned To' },
  { field: 'Microsoft.VSTS.Common.Priority', label: 'Priority' },
  { field: 'Microsoft.VSTS.Common.Severity', label: 'Severity' },
  { field: 'System.Tags',                    label: 'Tags' },
  { field: 'System.IterationPath',           label: 'Sprint / Iteration' },
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
  { key: 'assignee',  label: 'Assignee (email)' },
  { key: 'priority',  label: 'Priority' },
  { key: 'severity',  label: 'Severity' },
  { key: 'labels',    label: 'Labels (as tags)' },
  { key: 'sprint',    label: 'Sprint / Iteration path' },
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

    // Upload screenshots as Azure attachments if present
    if (issue.screenshot_url) {
      const attachmentUrl = await this.uploadScreenshotAttachment(baseUrl, project_name, pat, issue.screenshot_url, 'element-screenshot').catch(() => null)
      if (attachmentUrl) {
        body.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: attachmentUrl, attributes: { comment: 'Element screenshot captured by QA Reporter' } } } as any)
      }
    }
    if (issue.element_screenshot_url) {
      const attachmentUrl = await this.uploadScreenshotAttachment(baseUrl, project_name, pat, issue.element_screenshot_url, 'full-page-screenshot').catch(() => null)
      if (attachmentUrl) {
        body.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: attachmentUrl, attributes: { comment: 'Full page screenshot captured by QA Reporter' } } } as any)
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
        return this.buildReproSteps(issue)
      }
      case 'system_info': {
        return this.buildSystemInfo(issue)
      }
      case 'assignee':
        return issue.metadata?.assignee ?? ''

      case 'priority': {
        const p = (issue.metadata?.priority ?? '').toLowerCase()
        const map: Record<string, string> = { critical: '1', high: '2', medium: '3', low: '4' }
        return map[p] ?? ''
      }

      case 'severity': {
        const s = (issue.severity ?? '').toLowerCase()
        const map: Record<string, string> = {
          critical: '1 - Critical',
          high:     '2 - High',
          medium:   '3 - Medium',
          low:      '4 - Low',
        }
        return map[s] ?? ''
      }

      case 'labels': {
        const labels = issue.metadata?.labels
        if (!Array.isArray(labels) || !labels.length) return ''
        return labels.join('; ')
      }

      case 'sprint':
        return issue.metadata?.sprint ?? ''

      default: return ''
    }
  }

  private buildReproSteps(issue: any): string {
    const m = issue.metadata ?? {}
    const e = issue.element_info ?? {}
    const sections: string[] = []

    // Bug description
    if (issue.description) {
      sections.push(`<h3>Description</h3><p>${this.esc(issue.description)}</p>`)
    }

    // Where it happened
    const location: string[] = []
    if (issue.url) location.push(`<p><strong>Page URL:</strong> <a href="${issue.url}">${this.esc(issue.url)}</a></p>`)
    if (issue.route) location.push(`<p><strong>Route:</strong> ${this.esc(issue.route)}</p>`)
    const ctx = m.pageContext ?? {}
    if (ctx.title) location.push(`<p><strong>Page Title:</strong> ${this.esc(ctx.title)}</p>`)
    if (ctx.queryParams && Object.keys(ctx.queryParams).length) {
      const qs = Object.entries(ctx.queryParams).map(([k, v]) => `${k}=${v}`).join('&amp;')
      location.push(`<p><strong>Query Params:</strong> ?${this.esc(qs)}</p>`)
    }
    if (ctx.scrollPosition) location.push(`<p><strong>Scroll:</strong> (${ctx.scrollPosition.x}, ${ctx.scrollPosition.y})</p>`)
    if (location.length) sections.push(`<h3>Location</h3>${location.join('')}`)

    // Element
    const elParts: string[] = []
    const tagStr = [e.tag, e.id ? `#${e.id}` : '', e.cssSelector ?? e.selector].filter(Boolean)
    if (tagStr.length) elParts.push(`<p><strong>Selector:</strong> <code>${this.esc(tagStr.join(' '))}</code></p>`)
    if (e.text) elParts.push(`<p><strong>Text:</strong> ${this.esc(e.text)}</p>`)
    if (e.xpath) elParts.push(`<p><strong>XPath:</strong> <code>${this.esc(e.xpath)}</code></p>`)
    if (e.domBreadcrumb) elParts.push(`<p><strong>DOM Path:</strong> <code>${this.esc(e.domBreadcrumb)}</code></p>`)
    if (e.dimensions) {
      const d = e.dimensions
      elParts.push(`<p><strong>Dimensions:</strong> ${d.width}×${d.height} at (${d.left}, ${d.top})</p>`)
    }
    if (elParts.length) sections.push(`<h3>Element</h3>${elParts.join('')}`)

    // Screenshots
    const shots: string[] = []
    if (issue.screenshot_url) shots.push(`<p>📸 <a href="${issue.screenshot_url}">Element Screenshot</a></p>`)
    if (issue.element_screenshot_url) shots.push(`<p>🖥️ <a href="${issue.element_screenshot_url}">Full Page Screenshot</a></p>`)
    if (shots.length) sections.push(`<h3>Screenshots</h3>${shots.join('')}`)

    // Expected / Actual (only if captured in form)
    const form: string[] = []
    if (m.expectedResult) form.push(`<p><strong>Expected:</strong> ${this.esc(m.expectedResult)}</p>`)
    if (m.actualResult) form.push(`<p><strong>Actual:</strong> ${this.esc(m.actualResult)}</p>`)
    if (m.priority) form.push(`<p><strong>Priority:</strong> ${this.esc(m.priority)}</p>`)
    if (m.environment) form.push(`<p><strong>Environment:</strong> ${this.esc(m.environment)}</p>`)
    if (m.labels?.length) form.push(`<p><strong>Labels:</strong> ${this.esc(m.labels.join(', '))}</p>`)
    if (m.sprint) form.push(`<p><strong>Sprint:</strong> ${this.esc(m.sprint)}</p>`)
    if (m.assignee) form.push(`<p><strong>Assignee:</strong> ${this.esc(m.assignee)}</p>`)
    if (form.length) sections.push(`<h3>Bug Details</h3>${form.join('')}`)

    // Console errors (only if captured)
    const consoleErrors: any[] = m.consoleErrors ?? []
    if (consoleErrors.length) {
      const items = consoleErrors.slice(0, 10).map(c => `<li><code>[${c.level}]</code> ${this.esc(c.message)}</li>`).join('')
      sections.push(`<h3>Console Errors</h3><ul>${items}</ul>`)
    }

    // Network errors (only if captured)
    const networkErrors: any[] = m.networkErrors ?? []
    if (networkErrors.length) {
      const items = networkErrors.slice(0, 10).map(n => `<li><code>[${n.method}]</code> ${this.esc(n.url)} → ${n.status} (${n.duration}ms)</li>`).join('')
      sections.push(`<h3>Network Errors</h3><ul>${items}</ul>`)
    }

    return sections.join('') || `<p>${this.esc(issue.description ?? '')}</p>`
  }

  private buildSystemInfo(issue: any): string {
    const m = issue.metadata ?? {}
    const b = issue.browser_info ?? {}
    const e = issue.element_info ?? {}
    const sections: string[] = []

    // Browser / Environment
    const env: string[] = []
    const browser = [b.browser, b.version, b.os].filter(Boolean).join(' / ')
    if (browser) env.push(`<p><strong>Browser:</strong> ${this.esc(browser)}</p>`)
    if (b.userAgent) env.push(`<p><strong>User Agent:</strong> ${this.esc(b.userAgent)}</p>`)
    if (b.language) env.push(`<p><strong>Language:</strong> ${this.esc(b.language)}</p>`)
    if (b.viewport) env.push(`<p><strong>Viewport:</strong> ${b.viewport.width}×${b.viewport.height}</p>`)
    if (b.devicePixelRatio) env.push(`<p><strong>DPR:</strong> ${b.devicePixelRatio}</p>`)
    if (env.length) sections.push(`<h3>Environment</h3>${env.join('')}`)

    // React component (only if captured)
    const react = e.react ?? {}
    if (react.componentName) {
      const r: string[] = []
      r.push(`<p><strong>Component:</strong> ${this.esc(react.componentName)}</p>`)
      if (react.source) r.push(`<p><strong>Source:</strong> <code>${this.esc(react.source)}</code></p>`)
      if (react.componentTree) r.push(`<p><strong>Tree:</strong> ${this.esc(react.componentTree)}</p>`)
      sections.push(`<h3>React Component</h3>${r.join('')}`)
    }

    // Performance (only if captured)
    const perf = m.performanceMetrics ?? {}
    if (Object.keys(perf).length) {
      const p: string[] = []
      if (perf.pageLoadMs != null) p.push(`<strong>Page Load:</strong> ${perf.pageLoadMs}ms`)
      if (perf.domContentLoadedMs != null) p.push(`<strong>DCL:</strong> ${perf.domContentLoadedMs}ms`)
      if (perf.ttfbMs != null) p.push(`<strong>TTFB:</strong> ${perf.ttfbMs}ms`)
      if (perf.firstContentfulPaintMs != null) p.push(`<strong>FCP:</strong> ${perf.firstContentfulPaintMs}ms`)
      if (p.length) sections.push(`<h3>Performance</h3><p>${p.join(' &nbsp;|&nbsp; ')}</p>`)
    }

    // App state (only if captured)
    const appState = m.appState ?? {}
    if (appState.reactRouterState || appState.zustandStoreKeys?.length) {
      const a: string[] = []
      if (appState.reactRouterState) a.push(`<p><strong>Router State:</strong> <code>${this.esc(JSON.stringify(appState.reactRouterState))}</code></p>`)
      if (appState.zustandStoreKeys?.length) a.push(`<p><strong>Zustand Stores:</strong> ${this.esc(appState.zustandStoreKeys.join(', '))}</p>`)
      sections.push(`<h3>App State</h3>${a.join('')}`)
    }

    // Navigation history (only if captured)
    const nav: any[] = m.navigationHistory ?? []
    if (nav.length) {
      const trail = nav.map(n => this.esc(n.url ?? n)).join(' → ')
      sections.push(`<h3>Navigation History</h3><p>${trail}</p>`)
    }

    // User info (only if captured)
    if (m.userInfo?.id || m.userInfo?.email) {
      const u: string[] = []
      if (m.userInfo.id) u.push(`<p><strong>User ID:</strong> ${this.esc(m.userInfo.id)}</p>`)
      if (m.userInfo.email) u.push(`<p><strong>Email:</strong> ${this.esc(m.userInfo.email)}</p>`)
      if (m.userInfo.name) u.push(`<p><strong>Name:</strong> ${this.esc(m.userInfo.name)}</p>`)
      sections.push(`<h3>User</h3>${u.join('')}`)
    }

    sections.push('<p><em>Reported via QA Reporter</em></p>')
    return sections.join('')
  }

  private esc(s: string): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private async uploadScreenshotAttachment(baseUrl: string, projectName: string, pat: string, screenshotUrl: string, label = 'screenshot'): Promise<string> {
    // Fetch the image from Supabase
    const imageRes = await fetch(screenshotUrl)
    if (!imageRes.ok) throw new Error('Could not fetch screenshot')
    const imageBuffer = await imageRes.arrayBuffer()
    const contentType = imageRes.headers.get('content-type') ?? 'image/png'
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png'

    // Upload to Azure DevOps attachments API
    const uploadRes = await fetch(
      `${baseUrl}/${projectName}/_apis/wit/attachments?fileName=${label}.${ext}&api-version=7.1`,
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
