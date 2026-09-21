import type { JSONSchemaDefinition, AICapability } from '../core/ai.types'

export interface PromptTemplate<TInput = any, TOutput = any> {
  id: string
  task: string
  version: string
  description: string
  systemPrompt: string
  buildUserPrompt: (input: TInput) => string
  schema?: JSONSchemaDefinition
  requiredCapabilities?: Set<AICapability>
  defaultTemperature?: number
  defaultMaxTokens?: number
}
