import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { AiService } from './ai.service'
import { GenerateRcaDto } from './dto/generate-rca.dto'
import { GeneratePlaywrightTestDto } from './dto/generate-test.dto'
import { DetectDuplicatesDto } from './dto/detect-duplicates.dto'
import { SmartAutofillDto } from './dto/smart-autofill.dto'
import { VisualAnalysisDto } from './dto/visual-analysis.dto'

@UseGuards(SupabaseAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('rca')
  generateRca(@Body() dto: GenerateRcaDto) {
    return this.aiService.generateRca(dto)
  }

  @Post('generate-test')
  generatePlaywrightTest(@Body() dto: GeneratePlaywrightTestDto) {
    return this.aiService.generatePlaywrightTest(dto)
  }

  @Post('detect-duplicates')
  detectDuplicates(@Body() dto: DetectDuplicatesDto) {
    return this.aiService.detectDuplicates(dto)
  }

  @Post('smart-autofill')
  generateSmartAutofill(@Body() dto: SmartAutofillDto) {
    return this.aiService.generateSmartAutofill(dto)
  }

  @Post('visual-analysis')
  analyzeVisualAnomalies(@Body() dto: VisualAnalysisDto) {
    return this.aiService.analyzeVisualAnomalies(dto)
  }
}
