import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { AuthUser } from '../common/interfaces/auth-user.interface'

export type ProjectRole = 'owner' | 'member'

/** Columns a member (non-owner) may see on a project. */
export const MEMBER_PROJECT_COLUMNS = 'id, name, workspace_id, sync_mode, created_at, settings'
const MEMBER_SETTINGS_KEYS = ['description', 'default_view'] as const

/** Strip a project row down to what a member may see (no owner-only settings). */
export function toMemberProjectView(p: Record<string, any>): Record<string, any> {
  const settings: Record<string, any> = {}
  for (const k of MEMBER_SETTINGS_KEYS) {
    if (p.settings && p.settings[k] !== undefined) settings[k] = p.settings[k]
  }
  return {
    id: p.id,
    name: p.name,
    workspace_id: p.workspace_id,
    sync_mode: p.sync_mode,
    created_at: p.created_at,
    settings,
  }
}

// PostgREST pattern wildcards (`*` is treated like `%`) and the escape char.
const PATTERN_CHARS = /[%_*\\]/

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

  /**
   * workspace_members ids whose email equals the user's email (case-insensitive).
   * Only trusted when Supabase has confirmed the email; owner access never comes through here.
   */
  private async memberIds(user: AuthUser): Promise<string[]> {
    if (user.emailVerified !== true) return []
    const normalized = this.normalizeEmail(user.email)
    if (!normalized) return []

    // Rows may be stored mixed-case, so keep a case-insensitive match. If the address has no
    // pattern characters the ilike value is a literal; otherwise escape them, and in every case
    // re-check exact equality below so no pattern can ever over-match.
    if (normalized.includes('*')) return [] // `*` cannot be escaped in a PostgREST filter value
    const value = PATTERN_CHARS.test(normalized)
      ? normalized.replace(/[\\%_]/g, (c) => `\\${c}`)
      : normalized
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .select('id, email')
      .ilike('email', value)
    if (error) throw new Error(error.message)
    return (data ?? [])
      .filter((m: any) => this.normalizeEmail(m.email) === normalized)
      .map((m: any) => m.id)
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

    const ids = await this.memberIds(user)
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
          .select(MEMBER_PROJECT_COLUMNS)
          .in('id', projectIds)
        if (error) throw new Error(error.message)
        for (const p of data ?? []) result.set(p.id, { ...toMemberProjectView(p), role: 'member' as const })
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
    if (error) {
      // 22P02 = invalid_text_representation (e.g. a non-UUID id): treat as "no such project".
      if ((error as any).code === '22P02') return null
      throw new Error(error.message)
    }
    if (!project) return null

    const workspaceId = await this.ownedWorkspaceId(user.id)
    if (workspaceId && project.workspace_id === workspaceId) return 'owner'

    const ids = await this.memberIds(user)
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
