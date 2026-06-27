import { Controller, Get, Param } from '@nestjs/common'
import { ReplayService } from './replay.service'

@Controller('replay')
export class ReplayController {
  constructor(private replay: ReplayService) {}

  @Get(':token')
  getReplay(@Param('token') token: string) {
    return this.replay.getReplayByToken(token);
  }
}
