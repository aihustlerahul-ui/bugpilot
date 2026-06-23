import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
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
    const encryptedPat = this.encryption.encrypt(dto.pat)
    const config = {
      org_url: dto.orgUrl,
      project_name: dto.projectName,
      encrypted_pat: encryptedPat,
    }

    // Test connection before saving
    await this.testAzureConnection(dto.orgUrl, dto.projectName, dto.pat)

    const { data, error } = await this.supabase.db
      .from('integrations')
      .upsert(
        { workspace_id: workspace.id, provider: 'azure_devops', config, updated_at: new Date().toISOString() },
        { onConflict: 'workspace_id,provider' },
      )
      .select()
      .single()

    if (error) throw new BadRequestException(error.message)
    return { id: data.id, config: { org_url: dto.orgUrl, project_name: dto.projectName } }
  }

  async getAzure(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data } = await this.supabase.db
      .from('integrations')
      .select()
      .eq('workspace_id', workspace.id)
      .eq('provider', 'azure_devops')
      .single()

    if (!data) return null
    return { id: data.id, config: { org_url: data.config.org_url, project_name: data.config.project_name } }
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

    const { org_url, project_name, encrypted_pat } = integration.config
    const pat = this.encryption.decrypt(encrypted_pat)

    const workItemUrl = `${org_url}/${encodeURIComponent(project_name)}/_apis/wit/workitems/$Bug?api-version=7.1`
    const body = [
      { op: 'add', path: '/fields/System.Title', value: issue.description },
      { op: 'add', path: '/fields/System.Description', value: this.buildDescription(issue) },
    ]

    const res = await fetch(workItemUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      await this.issues.updateSyncStatus(issueId, 'failed')
      throw new BadRequestException((errBody as any).message ?? `Azure API error: ${res.status}`)
    }

    const created = await res.json() as any
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

  private buildDescription(issue: any): string {
    const parts = [`<p>${issue.description}</p>`]
    if (issue.url) parts.push(`<p><strong>URL:</strong> ${issue.url}</p>`)
    if (issue.route) parts.push(`<p><strong>Route:</strong> ${issue.route}</p>`)
    if (issue.screenshot_url) parts.push(`<p><img src="${issue.screenshot_url}" alt="Screenshot" /></p>`)
    return parts.join('')
  }

  private async testAzureConnection(orgUrl: string, projectName: string, pat: string) {
    const url = `${orgUrl}/_apis/projects/${encodeURIComponent(projectName)}?api-version=7.1`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` },
    })
    if (!res.ok) throw new BadRequestException('Azure DevOps connection test failed — check your PAT and project name')
  }
}
