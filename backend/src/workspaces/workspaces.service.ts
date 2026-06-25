import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { CreateWorkspaceDto } from './dto/create-workspace.dto'

export interface ExtensionSettings {
  // Screenshot
  screenshotMode: 'full' | 'element_crop' | 'element_context' | 'full_highlighted' | 'both'

  // General
  captureUrl: boolean
  capturePageTitle: boolean
  captureBrowserInfo: boolean
  captureRoute: boolean

  // Advanced
  captureReact: boolean
  captureConsole: boolean
  captureNetwork: boolean
  capturePerformance: boolean
  captureDomHierarchy: boolean
  captureComputedStyles: boolean
  captureXPath: boolean

  // Security (default off)
  captureLocalStorage: boolean
  captureSessionStorage: boolean
  captureCookies: boolean
  captureUserInfo: boolean

  // Bug Form optional fields
  formExpectedResult: boolean
  formActualResult: boolean
  formPriority: boolean
  formEnvironment: boolean
  formLabels: boolean
  formSprint: boolean
  formAssignee: boolean
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  screenshotMode: 'element_context',

  captureUrl: true,
  capturePageTitle: true,
  captureBrowserInfo: true,
  captureRoute: true,

  captureReact: true,
  captureConsole: true,
  captureNetwork: true,
  capturePerformance: true,
  captureDomHierarchy: true,
  captureComputedStyles: false,
  captureXPath: true,

  captureLocalStorage: false,
  captureSessionStorage: false,
  captureCookies: false,
  captureUserInfo: false,

  formExpectedResult: true,
  formActualResult: true,
  formPriority: false,
  formEnvironment: false,
  formLabels: false,
  formSprint: false,
  formAssignee: false,
}

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

  async getSettings(userId: string): Promise<ExtensionSettings> {
    const workspace = await this.findByOwner(userId)
    return { ...DEFAULT_SETTINGS, ...(workspace.settings ?? {}) }
  }

  async updateSettings(userId: string, patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings(userId)
    const next = { ...current, ...patch }
    const workspace = await this.findByOwner(userId)
    const { error } = await this.supabase.db
      .from('workspaces')
      .update({ settings: next })
      .eq('id', workspace.id)
    if (error) throw new Error(error.message)
    return next
  }
}
