import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { SupabaseModule } from './supabase/supabase.module'
import { WorkspacesModule } from './workspaces/workspaces.module'
import { ProjectsModule } from './projects/projects.module'
import { IssuesModule } from './issues/issues.module'
import { IntegrationsModule } from './integrations/integrations.module'
import { MembersModule } from './members/members.module'
import { ReplayModule } from './replay/replay.module'
import { AiModule } from './ai/ai.module'
import { AccessModule } from './access/access.module'
import { AuthModule } from './auth/auth.module'
import { ApiKeysModule } from './api-keys/api-keys.module'
import { NotificationsModule } from './notifications/notifications.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    WorkspacesModule,
    ProjectsModule,
    IssuesModule,
    IntegrationsModule,
    MembersModule,
    ReplayModule,
    AiModule,
    AccessModule,
    AuthModule,
    ApiKeysModule,
    NotificationsModule,
  ],
})
export class AppModule {}
