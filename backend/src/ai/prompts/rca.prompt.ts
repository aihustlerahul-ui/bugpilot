import type { PromptTemplate } from './prompt.interface'
import type { GenerateRcaDto } from '../dto/generate-rca.dto'
import type { RcaResult } from '../ai.service'

export const RCA_PROMPT_V1: PromptTemplate<GenerateRcaDto, RcaResult> = {
  id: 'rca_generation_v1',
  task: 'rca_generation',
  version: '1.0.0',
  description: 'Generates root cause diagnostic summary, git diff patch, and repro steps from telemetry',
  systemPrompt: `You are an expert Senior Full-Stack and Reliability Engineer specializing in debugging web application failures.
Analyze the provided telemetry, React component context, console errors, network failures, and route information.
You MUST output valid, parseable JSON conforming strictly to the requested schema.`,
  buildUserPrompt: (dto: GenerateRcaDto) => {
    const elInfo = dto.elementInfo || {}
    const reactComp = elInfo.react?.componentName || elInfo.reactComponentName || 'UnknownComponent'
    const sourcePath = elInfo.reactSource?.fileName || elInfo.react?.source || 'N/A'
    const sourceLine = elInfo.reactSource?.lineNumber || 1
    const cssSelector = elInfo.cssSelector || elInfo.selector || 'button'

    return `### Bug Diagnostic Information
- Title: ${dto.title}
- Target Route / URL: ${dto.route || dto.url || 'N/A'}
- React Component: <${reactComp}>
- Source File: ${sourcePath}:${sourceLine}
- Target CSS Selector: ${cssSelector}

### Console Errors Captured:
${(dto.consoleErrors || []).map((e) => `- [${e.level.toUpperCase()}] ${e.message}`).join('\n') || '(None)'}

### Failed Network Calls:
${(dto.networkErrors || []).map((n) => `- ${n.method} ${n.url} -> Status ${n.status}`).join('\n') || '(None)'}

### Instructions:
1. Provide a clear technical diagnostic summary of the root cause.
2. Identify the probable component that should be modified.
3. Write a production-ready unified git diff patch with defensive coding/try-catch/optional chaining.
4. List step-by-step reproduction instructions.
5. Assess severity ("Critical", "High", "Medium", or "Low").
6. Provide a concise IDE prompt ready for Cursor/VSCode.`
  },
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Technical diagnostic summary of the bug root cause' },
      probableComponent: { type: 'string', description: 'Name of the likely faulty React component or file' },
      suggestedPatch: { type: 'string', description: 'Unified git diff fix patch' },
      reproductionSteps: { type: 'array', items: { type: 'string' }, description: 'Numbered repro steps' },
      severityAssessment: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
      confidenceScore: { type: 'number', description: 'Confidence between 0.0 and 1.0' },
      cursorPrompt: { type: 'string', description: 'Prompt text packaged for IDE AI assistants' },
    },
    required: [
      'summary',
      'probableComponent',
      'suggestedPatch',
      'reproductionSteps',
      'severityAssessment',
      'confidenceScore',
      'cursorPrompt',
    ],
  },
  defaultTemperature: 0.2,
  defaultMaxTokens: 1500,
}
