import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { WorkspacesService } from './workspaces.service'
import { CreateWorkspaceDto } from './dto/create-workspace.dto'
import type { AuthUser } from '../common/interfaces/auth-user.interface'

@Controller('workspaces')
@UseGuards(SupabaseAuthGuard)
export class WorkspacesController {
  constructor(private workspaces: WorkspacesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto)
  }

  @Get('me')
  findMine(@CurrentUser() user: AuthUser) {
    return this.workspaces.findByOwner(user.id)
  }

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.workspaces.getSettings(user.id)
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.workspaces.updateSettings(user.id, body as any)
  }
}
