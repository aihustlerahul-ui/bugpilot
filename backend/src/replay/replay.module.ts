import { Module } from '@nestjs/common'
import { ReplayService } from './replay.service'
import { ReplayController } from './replay.controller'

@Module({
  providers: [ReplayService],
  controllers: [ReplayController],
})
export class ReplayModule {}
