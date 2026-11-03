import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateProjectDto } from './dto/create-project.dto'
import { UpdateProjectDto } from './dto/update-project.dto'

@Injectable()
export class ProjectsService {
  constructor(
    private supabase: SupabaseService,
    private workspaces: WorkspacesService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data, error } = await this.supabase.db
      .from('projects')
      .insert({ name: dto.name, sync_mode: dto.sync_mode, workspace_id: workspace.id })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  async findAll(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data, error } = await this.supabase.db
      .from('projects')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data ?? []
  }

  async findOne(userId: string, projectId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data, error } = await this.supabase.db
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('workspace_id', workspace.id)
      .single()
    if (error) throw new NotFoundException('Project not found')
    return data
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    const existing = await this.findOne(userId, projectId)

    const updatePayload: Record<string, any> = {}
    if (dto.name !== undefined) updatePayload.name = dto.name
    if (dto.sync_mode !== undefined) updatePayload.sync_mode = dto.sync_mode
    if (dto.settings !== undefined) {
      updatePayload.settings = {
        ...(existing.settings || {}),
        ...dto.settings,
      }
    }

    const { data, error } = await this.supabase.db
      .from('projects')
      .update(updatePayload)
      .eq('id', projectId)
      .eq('workspace_id', workspace.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  async remove(userId: string, projectId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    // verify existence
    await this.findOne(userId, projectId)

    const { error } = await this.supabase.db
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('workspace_id', workspace.id)

    if (error) throw new Error(error.message)
    return { success: true }
  }
}

