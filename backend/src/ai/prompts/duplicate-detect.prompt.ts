import type { PromptTemplate } from './prompt.interface'
import type { DetectDuplicatesDto } from '../dto/detect-duplicates.dto'
import type { DuplicateMatch } from '../ai.service'

export interface DuplicateAnalysisResult {
  matches: DuplicateMatch[]
  topSimilarityScore: number
  hasDuplicate: boolean
}

export const DUPLICATE_DETECT_PROMPT_V1: PromptTemplate<DetectDuplicatesDto & { existingIssues: any[] }, DuplicateAnalysisResult> = {
  id: 'duplicate_detection_v1',
  task: 'duplicate_detection',
  version: '1.0.0',
  description: 'Evaluates semantic and technical similarity between an incoming bug and existing project issues',
  systemPrompt: `You are an AI issue triage engine. Analyze whether the incoming bug report is a duplicate of any existing issues.
Output valid JSON conforming strictly to the schema.`,
  buildUserPrompt: (input) => {
    return `### Incoming Issue:
- Title: ${input.title}
- Description: ${input.description || 'N/A'}
- URL: ${input.url || 'N/A'}
- Selector: ${input.elementInfo?.cssSelector || 'N/A'}
- Errors: ${JSON.stringify(input.consoleErrors || [])}

### Existing Project Issues to Compare Against:
${JSON.stringify(input.existingIssues || [])}`
  },
  schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issueId: { type: 'string' },
            title: { type: 'string' },
            severity: { type: 'string' },
            status: { type: 'string' },
            similarityScore: { type: 'number' },
            matchReason: { type: 'string' },
            fingerprintMatch: { type: 'boolean' },
          },
          required: ['issueId', 'title', 'severity', 'status', 'similarityScore', 'matchReason', 'fingerprintMatch'],
        },
      },
      topSimilarityScore: { type: 'number' },
      hasDuplicate: { type: 'boolean' },
    },
    required: ['matches', 'topSimilarityScore', 'hasDuplicate'],
  },
  defaultTemperature: 0.0,
  defaultMaxTokens: 800,
}
