import type { PromptTemplate } from './prompt.interface'
import type { SmartAutofillDto } from '../dto/smart-autofill.dto'
import type { SmartAutofillResult } from '../ai.service'

export const SMART_AUTOFILL_PROMPT_V1: PromptTemplate<SmartAutofillDto, SmartAutofillResult> = {
  id: 'smart_autofill_v1',
  task: 'smart_autofill',
  version: '1.0.0',
  description: 'Synthesizes title, description, expected vs actual behavior from 50-token DOM context and user prompt',
  systemPrompt: `You are an intelligent QA assistant in BugPilot.
Transform the user's natural language bug description and the 50-token semantic DOM context snapshot into a polished, structured bug report.
Output valid JSON adhering strictly to the schema.`,
  buildUserPrompt: (dto: SmartAutofillDto) => {
    return `### User Bug Description:
"${dto.userInput || 'Element does not behave as expected'}"

### Context & URL:
- Route: ${dto.route || dto.url || '/'}
- DOM Context Snapshot: ${JSON.stringify(dto.domContext || {})}
- Element Info: ${JSON.stringify(dto.elementInfo || {})}
- Console Errors: ${JSON.stringify(dto.consoleErrors || [])}
- Network Errors: ${JSON.stringify(dto.networkErrors || [])}`
  },
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Concise, actionable bug title' },
      description: { type: 'string', description: 'Full markdown formatted bug report' },
      severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
      expectedResult: { type: 'string', description: 'What should have happened' },
      actualResult: { type: 'string', description: 'What actually occurred' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Tags and category labels' },
      domSummary: { type: 'string', description: 'Short 50-token serialized DOM context' },
      confidenceScore: { type: 'number', description: 'Confidence between 0.0 and 1.0' },
    },
    required: [
      'title',
      'description',
      'severity',
      'expectedResult',
      'actualResult',
      'labels',
      'domSummary',
      'confidenceScore',
    ],
  },
  defaultTemperature: 0.2,
  defaultMaxTokens: 1000,
}
