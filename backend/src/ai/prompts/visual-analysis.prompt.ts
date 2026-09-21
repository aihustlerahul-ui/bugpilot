import type { PromptTemplate } from './prompt.interface'
import type { VisualAnalysisDto } from '../dto/visual-analysis.dto'
import type { VisualAnomalyReport } from '../ai.service'

export const VISUAL_ANALYSIS_PROMPT_V1: PromptTemplate<VisualAnalysisDto, VisualAnomalyReport> = {
  id: 'visual_anomaly_analysis_v1',
  task: 'visual_anomaly_analysis',
  version: '1.0.0',
  description: 'Analyzes layout clipping, text truncation, WCAG contrast violations, and touch target sizing',
  systemPrompt: `You are an expert UI/UX and Accessibility Inspector analyzing frontend DOM telemetry and visual styles.
Identify any visual anomalies (overflow clipping, WCAG contrast failures, touch target sizing < 24px, element overlap).
Output valid JSON adhering strictly to the schema.`,
  buildUserPrompt: (dto: VisualAnalysisDto) => {
    return `### Element & Layout Telemetry:
- Target Element: ${JSON.stringify(dto.elementInfo || {})}
- Parent Container: ${JSON.stringify(dto.parentInfo || {})}
- Viewport: ${JSON.stringify(dto.viewport || {})}
- Screenshot attached: ${dto.screenshotBase64 ? 'Yes' : 'No'}`
  },
  schema: {
    type: 'object',
    properties: {
      anomalies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'layout_clipping',
                'element_overlap',
                'text_truncation',
                'contrast_violation',
                'touch_target_size',
                'layout_shift',
              ],
            },
            severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
            title: { type: 'string' },
            description: { type: 'string' },
            boundingBox: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            cssPropertyTrigger: { type: 'string' },
            suggestedFix: { type: 'string' },
            confidenceScore: { type: 'number' },
          },
          required: ['id', 'type', 'severity', 'title', 'description', 'suggestedFix', 'confidenceScore'],
        },
      },
      totalIssues: { type: 'number' },
      healthScore: { type: 'number' },
      summary: { type: 'string' },
    },
    required: ['anomalies', 'totalIssues', 'healthScore', 'summary'],
  },
  defaultTemperature: 0.1,
  defaultMaxTokens: 1500,
}
