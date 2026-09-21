import type { PromptTemplate } from './prompt.interface'
import type { GeneratePlaywrightTestDto } from '../dto/generate-test.dto'
import type { PlaywrightTestResult } from '../ai.service'

export const PLAYWRIGHT_TEST_PROMPT_V1: PromptTemplate<GeneratePlaywrightTestDto, PlaywrightTestResult> = {
  id: 'playwright_test_generation_v1',
  task: 'playwright_test_generation',
  version: '1.0.0',
  description: 'Generates Playwright E2E reproduction test (.spec.ts) from interaction breadcrumbs',
  systemPrompt: `You are an expert QA Automation Engineer. Generate a robust, clean Playwright test script in TypeScript reproducing the sequence of user interactions and final assertions.
Output valid JSON adhering to the schema.`,
  buildUserPrompt: (dto: GeneratePlaywrightTestDto) => {
    return `### Test Target:
- Title: ${dto.title}
- Target URL: ${dto.url}
- Breadcrumbs Sequence: ${JSON.stringify(dto.breadcrumbs || [])}
- Target Element: ${JSON.stringify(dto.elementInfo || {})}`
  },
  schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name ending in .spec.ts' },
      testScript: { type: 'string', description: 'Executable TypeScript test code importing @playwright/test' },
      stepCount: { type: 'number', description: 'Count of reproduction action steps' },
    },
    required: ['filename', 'testScript', 'stepCount'],
  },
  defaultTemperature: 0.1,
  defaultMaxTokens: 2000,
}
