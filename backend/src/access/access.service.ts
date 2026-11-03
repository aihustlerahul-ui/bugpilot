import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { AuthUser } from '../common/interfaces/auth-user.interface'

export type ProjectRole = 'owner' | 'member'

@Injectable()
export class AccessService {
  constructor(
    private supabase: SupabaseService,
    private workspaces: WorkspacesService,
  ) {}

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase()
  }

  private async ownedWorkspaceId(userId: string): Promise<string | null> {
    try {
      const ws = await this.workspaces.findByOwner(userId)
      return ws?.id ?? null
    } catch (e) {
      if (e instanceof NotFoundException) return null
      throw e
    }
  }

  private async memberIds(email: string): Promise<string[]> {
    const normalized = this.normalizeEmail(email)
    if (!normalized) return []
    // escape ilike wildcards so the email is matched literally
    const pattern = normalized.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .select('id')
      .ilike('email', pattern)
    if (error) throw new Error(error.message)
    return (data ?? []).map((m: any) => m.id)
  }

  async listAccessibleProjects(user: AuthUser): Promise<Array<Record<string, any> & { role: ProjectRole }>> {
    const result = new Map<string, Record<string, any> & { role: ProjectRole }>()

    const workspaceId = await this.ownedWorkspaceId(user.id)
    if (workspaceId) {
      const { data, error } = await this.supabase.db
        .from('projects')
        .select('*')
        .eq('workspace_id', workspaceId)
      if (error) throw new Error(error.message)
      for (const p of data ?? []) result.set(p.id, { ...p, role: 'owner' as const })
    }

    const ids = await this.memberIds(user.email)
    if (ids.length) {
      const { data: links, error: linkErr } = await this.supabase.db
        .from('project_members')
        .select('project_id')
        .in('member_id', ids)
      if (linkErr) throw new Error(linkErr.message)
      const projectIds = [...new Set((links ?? []).map((l: any) => l.project_id as string))].filter(
        (id) => !result.has(id),
      )
      if (projectIds.length) {
        const { data, error } = await this.supabase.db
          .from('projects')
          .select('*')
          .in('id', projectIds)
        if (error) throw new Error(error.message)
        for (const p of data ?? []) result.set(p.id, { ...p, role: 'member' as const })
      }
    }

    return [...result.values()].sort((a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
    )
  }

  async getProjectRole(user: AuthUser, projectId: string): Promise<ProjectRole | null> {
    const { data: project, error } = await this.supabase.db
      .from('projects')
      .select('id, workspace_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) return null

    const workspaceId = await this.ownedWorkspaceId(user.id)
    if (workspaceId && project.workspace_id === workspaceId) return 'owner'

    const ids = await this.memberIds(user.email)
    if (!ids.length) return null
    const { data: links, error: linkErr } = await this.supabase.db
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .in('member_id', ids)
    if (linkErr) throw new Error(linkErr.message)
    return (links ?? []).length ? 'member' : null
  }

  async assertCanAccessProject(user: AuthUser, projectId: string): Promise<ProjectRole> {
    const role = await this.getProjectRole(user, projectId)
    if (!role) throw new NotFoundException('Project not found')
    return role
  }
}
