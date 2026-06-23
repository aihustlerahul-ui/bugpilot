import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { CreateWorkspaceDto } from './dto/create-workspace.dto'

@Injectable()
export class WorkspacesService {
  constructor(private supabase: SupabaseService) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    const { data, error } = await this.supabase.db
      .from('workspaces')
      .insert({ name: dto.name, owner_id: userId })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  async findByOwner(userId: string) {
    const { data, error } = await this.supabase.db
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)
      .single()
    if (error) throw new NotFoundException('Workspace not found')
    return data
  }
}
