import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateProjectDto } from './dto/create-project.dto'

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
}
