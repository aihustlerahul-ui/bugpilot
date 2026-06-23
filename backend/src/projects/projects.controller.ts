import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { ProjectsService } from './projects.service'
import { CreateProjectDto } from './dto/create-project.dto'
import type { AuthUser } from '../common/interfaces/auth-user.interface'

@Controller('projects')
@UseGuards(SupabaseAuthGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.id, dto)
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.projects.findAll(user.id)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.findOne(user.id, id)
  }
}
