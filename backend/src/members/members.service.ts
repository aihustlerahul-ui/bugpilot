import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import type { CreateMemberDto } from './dto/create-member.dto'

@Injectable()
export class MembersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async listWorkspaceMembers(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('name', { ascending: true })
    if (error) throw new BadRequestException(error.message)
    return data ?? []
  }

  async createMember(userId: string, dto: CreateMemberDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    await this.checkConflicts(workspace.id, dto.name, dto.email)
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .insert({ workspace_id: workspace.id, name: dto.name, email: dto.email })
      .select()
      .single()
    if (error) throw new BadRequestException(error.message)
    return data
  }

  async updateMember(userId: string, memberId: string, dto: Partial<CreateMemberDto>) {
    const workspace = await this.workspaces.findByOwner(userId)
    const existing = await this.findById(workspace.id, memberId)
    if (!existing) throw new NotFoundException('Member not found')
    if (dto.email && dto.email !== existing.email) {
      const emailConflict = await this.findByEmail(workspace.id, dto.email)
      if (emailConflict) throw new BadRequestException(JSON.stringify({ code: 'EMAIL_CONFLICT', existing: emailConflict }))
    }
    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.findByName(workspace.id, dto.name)
      if (nameConflict) throw new BadRequestException(JSON.stringify({ code: 'NAME_CONFLICT', existing: nameConflict }))
    }
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .update({ name: dto.name ?? existing.name, email: dto.email ?? existing.email })
      .eq('id', memberId)
      .eq('workspace_id', workspace.id)
      .select()
      .single()
    if (error) throw new BadRequestException(error.message)
    return data
  }

  async deleteMember(userId: string, memberId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const existing = await this.findById(workspace.id, memberId)
    if (!existing) throw new NotFoundException('Member not found')
    const { error } = await this.supabase.db
      .from('workspace_members')
      .delete()
      .eq('id', memberId)
      .eq('workspace_id', workspace.id)
    if (error) throw new BadRequestException(error.message)
    return { deleted: true }
  }

  // ── Helpers used by project members upsert ────────────────────────────────

  async findWorkspaceMemberByEmail(userId: string, email: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    return this.findByEmail(workspace.id, email)
  }

  async getWorkspaceId(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    return workspace.id
  }

  private async findByEmail(workspaceId: string, email: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .maybeSingle()
    return data ?? null
  }

  private async findByName(workspaceId: string, name: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .maybeSingle()
    return data ?? null
  }

  private async findById(workspaceId: string, memberId: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', memberId)
      .maybeSingle()
    return data ?? null
  }

  private async checkConflicts(workspaceId: string, name: string, email: string) {
    const emailConflict = await this.findByEmail(workspaceId, email)
    if (emailConflict) {
      throw new BadRequestException(JSON.stringify({ code: 'EMAIL_CONFLICT', existing: emailConflict }))
    }
    const nameConflict = await this.findByName(workspaceId, name)
    if (nameConflict) {
      throw new BadRequestException(JSON.stringify({ code: 'NAME_CONFLICT', existing: nameConflict }))
    }
  }
}
