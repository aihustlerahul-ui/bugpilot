import type { PromptTemplate } from './prompt.interface'

export interface MeetingSummaryInput {
  transcript: string
  participants?: string[]
}

export interface MeetingSummaryOutput {
  summary: string
  decisions: string[]
  action_items: Array<{ task: string; owner: string | null; deadline: string | null }>
  open_questions: string[]
}

export const MEETING_SUMMARY_PROMPT_V1: PromptTemplate<MeetingSummaryInput, MeetingSummaryOutput> = {
  id: 'meeting_summary_v1',
  task: 'meeting_summary',
  version: '1.0.0',
  description: 'Summarizes transcripts into key takeaways, decisions, and action items',
  systemPrompt: `You are an expert executive assistant. Summarize the provided meeting transcript into structured decisions, key highlights, action items, and open questions. Output valid JSON adhering to the schema.`,
  buildUserPrompt: (input: MeetingSummaryInput) => {
    return `### Transcript:\n${input.transcript}\n\nParticipants: ${(input.participants || []).join(', ') || 'N/A'}`
  },
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'string' } },
      action_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            owner: { type: ['string', 'null'] },
            deadline: { type: ['string', 'null'] },
          },
          required: ['task', 'owner', 'deadline'],
        },
      },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'decisions', 'action_items', 'open_questions'],
  },
  defaultTemperature: 0.3,
  defaultMaxTokens: 2000,
}

export const CLASSIFICATION_PROMPT_V1: PromptTemplate<{ text: string; categories?: string[] }, { category: string; confidence: number; tags: string[] }> = {
  id: 'classification_v1',
  task: 'classification',
  version: '1.0.0',
  description: 'Classifies input text into categories',
  systemPrompt: `You are an AI text classifier. Categorize the given text accurately. Output valid JSON.`,
  buildUserPrompt: (input) => `Classify this text: "${input.text}"\nTarget categories: ${(input.categories || []).join(', ') || 'Any applicable'}`,
  schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
      confidence: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['category', 'confidence', 'tags'],
  },
  defaultTemperature: 0.0,
  defaultMaxTokens: 300,
}
