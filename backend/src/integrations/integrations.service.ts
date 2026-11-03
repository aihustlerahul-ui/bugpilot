import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { IssuesService } from '../issues/issues.service'
import { EncryptionService } from './encryption.service'
import type { CreateAzureIntegrationDto } from './dto/create-azure-integration.dto'
import type { CreateJiraIntegrationDto } from './dto/create-jira-integration.dto'
import type { CreateLinearIntegrationDto } from './dto/create-linear-integration.dto'
import type { CreateWebhookIntegrationDto } from './dto/create-webhook-integration.dto'

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
  { field: 'System.AssignedTo', label: 'Assigned To' },
  { field: 'Microsoft.VSTS.Common.Priority', label: 'Priority' },
  { field: 'Microsoft.VSTS.Common.Severity', label: 'Severity' },
  { field: 'System.Tags', label: 'Tags' },
  { field: 'System.IterationPath', label: 'Sprint / Iteration' },
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
  { key: 'assignee', label: 'Assignee (email)' },
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'labels', label: 'Labels (as tags)' },
  { key: 'sprint', label: 'Sprint / Iteration path' },
]

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name)

  constructor(
    private readonly supabase: SupabaseService,
    private readonly workspaces: WorkspacesService,
    private readonly issues: IssuesService,
    private readonly encryption: EncryptionService,
  ) {}

  // ==========================================
  // AZURE DEVOPS
  // ==========================================

  async upsertAzure(userId: string, dto: CreateAzureIntegrationDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const orgUrl = dto.orgUrl.trim().replace(/\/$/, '')
    const projectName = dto.projectName.trim()
    const config: Record<string, any> = {
      org_url: orgUrl,
      project_name: projectName,
      field_mapping: dto.fieldMapping ?? DEFAULT_FIELD_MAPPING,
    }

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
    const issue = await this.issues.findOneForReporter(userId, issueId)

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

    const allScreenshots: { label: string; url: string }[] =
      Array.isArray(issue.metadata?.screenshots) && issue.metadata.screenshots.length > 0
        ? issue.metadata.screenshots
        : [
            issue.screenshot_url && { label: 'Element screenshot', url: issue.screenshot_url },
            issue.element_screenshot_url && { label: 'Full page screenshot', url: issue.element_screenshot_url },
          ].filter(Boolean) as { label: string; url: string }[]

    for (const shot of allScreenshots) {
      const slug = shot.label.toLowerCase().replace(/\s+/g, '-')
      const attachmentUrl = await this.uploadScreenshotAttachment(baseUrl, project_name, pat, shot.url, slug).catch(() => null)
      if (attachmentUrl) {
        body.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: attachmentUrl, attributes: { comment: `${shot.label} — captured by BugPilot` } } } as any)
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
        message = 'Azure DevOps rejected the request — your PAT may be expired or invalid.'
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
      throw new BadRequestException('Azure returned an unexpected response format.')
    }
    const externalId = String(created.id)
    const externalUrl = created._links?.html?.href ?? `${org_url}/${project_name}/_workitems/edit/${created.id}`

    await this.supabase.db.from('issue_sync_logs').insert({
      issue_id: issueId,
      integration_id: integration.id,
      external_id: externalId,
      external_url: externalUrl,
    })

    await this.issues.updateSyncStatus(issueId, 'synced', externalId, externalUrl)
    return { externalId, externalUrl }
  }

  // ==========================================
  // JIRA CLOUD
  // ==========================================

  async upsertJira(userId: string, dto: CreateJiraIntegrationDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const host = dto.host.trim().replace(/\/$/, '')
    const email = dto.email.trim()
    const projectKey = dto.projectKey.trim().toUpperCase()
    const issueType = dto.issueType?.trim() || 'Bug'

    const config: Record<string, any> = {
      host,
      email,
      project_key: projectKey,
      issue_type: issueType,
      field_mapping: dto.fieldMapping ?? {},
    }

    const { data: existing } = await this.supabase.db
      .from('integrations')
      .select('pat_encrypted')
      .eq('workspace_id', workspace.id)
      .eq('provider', 'jira')
      .single()

    const newKey = dto.apiToken?.trim()
    if (!newKey && !existing?.pat_encrypted) throw new BadRequestException('Jira API Token is required')

    const encryptedKey = newKey
      ? this.encryption.encrypt(newKey)
      : existing!.pat_encrypted

    const keyForTest = newKey ?? this.encryption.decrypt(existing!.pat_encrypted)
    await this.testJiraConnection(host, email, keyForTest, projectKey)

    const { data, error } = await this.supabase.db
      .from('integrations')
      .upsert(
        { workspace_id: workspace.id, provider: 'jira', config, pat_encrypted: encryptedKey },
        { onConflict: 'workspace_id,provider' },
      )
      .select()
      .single()

    if (error) throw new BadRequestException(error.message)
    return { id: data.id, config: { host, email, project_key: projectKey, issue_type: issueType } }
  }

  async getJira(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'jira')
      .single()

    if (!data || !data.pat_encrypted) return null
    try {
      const apiToken = this.encryption.decrypt(data.pat_encrypted)
      if (!apiToken?.trim()) return null
      await this.testJiraConnection(data.config.host, data.config.email, apiToken, data.config.project_key)
    } catch {
      return { id: data.id, config: data.config, invalid: true }
    }
    return { id: data.id, config: data.config, invalid: false }
  }

  async syncToJira(userId: string, issueId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const issue = await this.issues.findOneForReporter(userId, issueId)

    const { data: integration } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'jira')
      .single()

    if (!integration) throw new NotFoundException('Jira integration not configured')

    const { host, email, project_key, issue_type } = integration.config
    const apiToken = this.encryption.decrypt(integration.pat_encrypted)
    const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`

    const jiraPayload = {
      fields: {
        project: { key: project_key },
        summary: issue.title || issue.description?.slice(0, 100) || 'Bug report from BugPilot',
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: issue.description || 'No description provided.' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `Reported on URL: ${issue.url || 'N/A'}\nSeverity: ${issue.severity || 'Medium'}\nRoute: ${issue.route || 'N/A'}` },
              ],
            },
          ],
        },
        issuetype: { name: issue_type || 'Bug' },
      },
    }

    const res = await fetch(`${host}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(jiraPayload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException(`Jira API error (${res.status}): ${errText}`)
    }

    const created = await res.json() as any
    const externalId = created.key || String(created.id)
    const externalUrl = `${host}/browse/${created.key}`

    await this.supabase.db.from('issue_sync_logs').insert({
      issue_id: issueId,
      integration_id: integration.id,
      external_id: externalId,
      external_url: externalUrl,
    })

    await this.issues.updateSyncStatus(issueId, 'synced', externalId, externalUrl)
    return { externalId, externalUrl }
  }

  // ==========================================
  // LINEAR
  // ==========================================

  async upsertLinear(userId: string, dto: CreateLinearIntegrationDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const apiKey = dto.apiKey.trim()
    const teamId = dto.teamId.trim()
    const projectId = dto.projectId?.trim()

    await this.testLinearConnection(apiKey, teamId)

    const config: Record<string, any> = {
      team_id: teamId,
      project_id: projectId,
      field_mapping: dto.fieldMapping ?? {},
    }

    const encryptedKey = this.encryption.encrypt(apiKey)

    const { data, error } = await this.supabase.db
      .from('integrations')
      .upsert(
        { workspace_id: workspace.id, provider: 'linear', config, pat_encrypted: encryptedKey },
        { onConflict: 'workspace_id,provider' },
      )
      .select()
      .single()

    if (error) throw new BadRequestException(error.message)
    return { id: data.id, config }
  }

  async getLinear(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'linear')
      .single()

    if (!data || !data.pat_encrypted) return null
    try {
      const apiKey = this.encryption.decrypt(data.pat_encrypted)
      if (!apiKey?.trim()) return null
      await this.testLinearConnection(apiKey, data.config.team_id)
    } catch {
      return { id: data.id, config: data.config, invalid: true }
    }
    return { id: data.id, config: data.config, invalid: false }
  }

  async syncToLinear(userId: string, issueId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const issue = await this.issues.findOneForReporter(userId, issueId)

    const { data: integration } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'linear')
      .single()

    if (!integration) throw new NotFoundException('Linear integration not configured')

    const { team_id, project_id } = integration.config
    const apiKey = this.encryption.decrypt(integration.pat_encrypted)

    const priorityMap: Record<string, number> = {
      urgent: 1,
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    }
    const linearPriority = priorityMap[(issue.severity || '').toLowerCase()] ?? 3

    const description = `**Description:**\n${issue.description || 'N/A'}\n\n**Environment:**\n- URL: ${issue.url || 'N/A'}\n- Route: ${issue.route || 'N/A'}\n- Severity: ${issue.severity || 'Medium'}\n\n*Synced from BugPilot*`

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
          }
        }
      }
    `

    const variables = {
      input: {
        title: issue.title || issue.description?.slice(0, 80) || 'Bug report',
        description,
        teamId: team_id,
        projectId: project_id || undefined,
        priority: linearPriority,
      },
    }

    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query: mutation, variables }),
    })

    if (!res.ok) {
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException(`Linear API error: ${res.status}`)
    }

    const result = await res.json() as any
    const issueData = result?.data?.issueCreate?.issue
    if (!issueData) {
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException(`Linear error: ${JSON.stringify(result.errors || 'Unknown')}`)
    }

    const externalId = issueData.identifier || issueData.id
    const externalUrl = issueData.url

    await this.supabase.db.from('issue_sync_logs').insert({
      issue_id: issueId,
      integration_id: integration.id,
      external_id: externalId,
      external_url: externalUrl,
    })

    await this.issues.updateSyncStatus(issueId, 'synced', externalId, externalUrl)
    return { externalId, externalUrl }
  }

  // ==========================================
  // SLACK & MS TEAMS WEBHOOKS
  // ==========================================

  async upsertWebhook(userId: string, dto: CreateWebhookIntegrationDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const config = {
      webhook_url: dto.webhookUrl.trim(),
      channel_name: dto.channelName?.trim(),
      notify_on_severity: dto.notifyOnSeverity || ['critical', 'high', 'medium', 'low'],
      notify_on_status: dto.notifyOnStatus || ['Incoming', 'In Triage', 'In Dev', 'Resolved'],
    }

    const { data, error } = await this.supabase.db
      .from('integrations')
      .upsert(
        { workspace_id: workspace.id, provider: dto.provider, config, pat_encrypted: this.encryption.encrypt('webhook') },
        { onConflict: 'workspace_id,provider' },
      )
      .select()
      .single()

    if (error) throw new BadRequestException(error.message)
    return { id: data.id, provider: dto.provider, config }
  }

  async getWebhooks(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data } = await this.supabase.db
      .from('integrations')
      .select('id, provider, config')
      .eq('workspace_id', workspace.id)
      .in('provider', ['slack', 'teams'])

    return data || []
  }

  async dispatchWebhookNotification(workspaceId: string, issue: any, eventType: 'created' | 'updated' | 'resolved' = 'created') {
    const { data: webhooks } = await this.supabase.db
      .from('integrations')
      .select('provider, config')
      .eq('workspace_id', workspaceId)
      .in('provider', ['slack', 'teams'])

    if (!webhooks || !webhooks.length) return

    for (const webhook of webhooks) {
      const url = webhook.config?.webhook_url
      if (!url) continue

      try {
        if (webhook.provider === 'slack') {
          await this.sendSlackPayload(url, issue, eventType)
        } else if (webhook.provider === 'teams') {
          await this.sendTeamsPayload(url, issue, eventType)
        }
      } catch (err) {
        this.logger.error(`Failed to dispatch ${webhook.provider} notification: ${err.message}`)
      }
    }
  }

  private async sendSlackPayload(webhookUrl: string, issue: any, eventType: string) {
    const severityEmoji = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : '🟡'
    const payload = {
      text: `${severityEmoji} *Bug ${eventType.toUpperCase()}*: ${issue.title || issue.description || 'Bug Report'}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${severityEmoji} New Bug Report: ${issue.title || 'Untitled'}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${issue.severity || 'Medium'}` },
            { type: 'mrkdwn', text: `*Route:*\n${issue.route || issue.url || 'N/A'}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Description:*\n${(issue.description || 'No description').slice(0, 300)}`,
          },
        },
      ],
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  private async sendTeamsPayload(webhookUrl: string, issue: any, eventType: string) {
    const payload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: issue.severity === 'critical' ? 'D32F2F' : '1976D2',
      summary: `Bug ${eventType}: ${issue.title || issue.description}`,
      sections: [
        {
          activityTitle: `🚨 BugPilot Alert: ${issue.title || 'New Issue'}`,
          activitySubtitle: `Status: ${issue.triage_status || 'Incoming'} | Severity: ${issue.severity || 'Medium'}`,
          facts: [
            { name: 'URL', value: issue.url || 'N/A' },
            { name: 'Route', value: issue.route || 'N/A' },
          ],
          text: issue.description || 'No description provided.',
        },
      ],
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  // ==========================================
  // HELPERS & VALIDATION
  // ==========================================

  private async testAzureConnection(orgUrl: string, projectName: string, pat: string) {
    const baseUrl = orgUrl.replace(/\/$/, '')
    const url = `${baseUrl}/_apis/projects/${projectName}?api-version=7.1`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` },
    })
    if (!res.ok) throw new BadRequestException(`Azure DevOps connection test failed (${res.status})`)
  }

  private async testJiraConnection(host: string, email: string, apiToken: string, projectKey: string) {
    const url = `${host}/rest/api/3/project/${projectKey}`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}` },
    })
    if (!res.ok) throw new BadRequestException(`Jira connection test failed (${res.status}) — check your Host, Email, and API token.`)
  }

  private async testLinearConnection(apiKey: string, teamId: string) {
    const query = `
      query GetTeam($id: String!) {
        team(id: $id) {
          id
          name
        }
      }
    `
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables: { id: teamId } }),
    })
    if (!res.ok) throw new BadRequestException(`Linear connection test failed (${res.status})`)
    const body = await res.json() as any
    if (body.errors && body.errors.length) {
      throw new BadRequestException(`Linear connection test failed: ${body.errors[0]?.message || 'Invalid Team ID / Key'}`)
    }
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
      case 'repro_steps': return this.buildReproSteps(issue)
      case 'system_info': return this.buildSystemInfo(issue)
      case 'assignee': return issue.metadata?.assignee ?? ''
      case 'priority': {
        const p = (issue.metadata?.priority ?? '').toLowerCase()
        const map: Record<string, string> = { critical: '1', high: '2', medium: '3', low: '4' }
        return map[p] ?? ''
      }
      case 'severity': {
        const s = (issue.severity ?? '').toLowerCase()
        const map: Record<string, string> = {
          critical: '1 - Critical',
          high: '2 - High',
          medium: '3 - Medium',
          low: '4 - Low',
        }
        return map[s] ?? ''
      }
      case 'labels': {
        const labels = issue.metadata?.labels
        if (!Array.isArray(labels) || !labels.length) return ''
        return labels.join('; ')
      }
      case 'sprint': return issue.metadata?.sprint ?? ''
      default: return ''
    }
  }

  private buildReproSteps(issue: any): string {
    const m = issue.metadata ?? {}
    const e = issue.element_info ?? {}
    const sections: string[] = []

    if (issue.description) {
      sections.push(`<h3>Description</h3><p>${this.esc(issue.description)}</p>`)
    }

    const location: string[] = []
    if (issue.url) location.push(`<p><strong>Page URL:</strong> <a href="${issue.url}">${this.esc(issue.url)}</a></p>`)
    if (issue.route) location.push(`<p><strong>Route:</strong> ${this.esc(issue.route)}</p>`)
    if (location.length) sections.push(`<h3>Location</h3>${location.join('')}`)

    const elParts: string[] = []
    const selector = e.cssSelector ?? e.selector
    if (selector) elParts.push(`<p><strong>Selector:</strong> <code>${this.esc(selector)}</code></p>`)
    if (e.text) elParts.push(`<p><strong>Text:</strong> ${this.esc(e.text)}</p>`)
    if (elParts.length) sections.push(`<h3>Element</h3>${elParts.join('')}`)

    return sections.join('') || `<p>${this.esc(issue.description ?? '')}</p>`
  }

  private buildSystemInfo(issue: any): string {
    const b = issue.browser_info ?? {}
    const sections: string[] = []
    const browser = [b.browser, b.version, b.os].filter(Boolean).join(' / ')
    if (browser) sections.push(`<p><strong>Browser:</strong> ${this.esc(browser)}</p>`)
    sections.push('<p><em>Reported via BugPilot</em></p>')
    return sections.join('')
  }

  private esc(s: string): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private async uploadScreenshotAttachment(baseUrl: string, projectName: string, pat: string, screenshotUrl: string, label = 'screenshot'): Promise<string> {
    const imageRes = await fetch(screenshotUrl)
    if (!imageRes.ok) throw new Error('Could not fetch screenshot')
    const imageBuffer = await imageRes.arrayBuffer()
    const contentType = imageRes.headers.get('content-type') ?? 'image/png'
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png'

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
}
