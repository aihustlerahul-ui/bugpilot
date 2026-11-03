import { Module } from '@nestjs/common'
import { IssuesService } from './issues.service'
import { IssuesController } from './issues.controller'
import { CommentsService } from './comments.service'
import { SourceMapService } from './source-map.service'
import { WorkspacesModule } from '../workspaces/workspaces.module'

@Module({
  imports: [WorkspacesModule],
  providers: [IssuesService, SourceMapService, CommentsService],
  controllers: [IssuesController],
  exports: [IssuesService, SourceMapService],
})
export class IssuesModule {}
