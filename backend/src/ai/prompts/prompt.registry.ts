import { Injectable } from '@nestjs/common'
import type { PromptTemplate } from './prompt.interface'
import { RCA_PROMPT_V1 } from './rca.prompt'
import { SMART_AUTOFILL_PROMPT_V1 } from './smart-autofill.prompt'
import { VISUAL_ANALYSIS_PROMPT_V1 } from './visual-analysis.prompt'
import { PLAYWRIGHT_TEST_PROMPT_V1 } from './playwright-test.prompt'
import { DUPLICATE_DETECT_PROMPT_V1 } from './duplicate-detect.prompt'
import { MEETING_SUMMARY_PROMPT_V1, CLASSIFICATION_PROMPT_V1 } from './generic-tasks.prompt'

@Injectable()
export class PromptRegistry {
  private readonly prompts: Map<string, PromptTemplate> = new Map()

  constructor() {
    this.register(RCA_PROMPT_V1)
    this.register(SMART_AUTOFILL_PROMPT_V1)
    this.register(VISUAL_ANALYSIS_PROMPT_V1)
    this.register(PLAYWRIGHT_TEST_PROMPT_V1)
    this.register(DUPLICATE_DETECT_PROMPT_V1)
    this.register(MEETING_SUMMARY_PROMPT_V1)
    this.register(CLASSIFICATION_PROMPT_V1)
  }

  register(template: PromptTemplate) {
    // Register by specific ID (e.g. rca_generation_v1) and default by task name (rca_generation)
    this.prompts.set(template.id, template)
    if (!this.prompts.has(template.task)) {
      this.prompts.set(template.task, template)
    }
  }

  getPrompt(taskOrPromptId: string): PromptTemplate | null {
    return this.prompts.get(taskOrPromptId) || null
  }
}
