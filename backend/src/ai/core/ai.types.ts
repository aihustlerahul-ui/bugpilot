/**
 * Normalized AI Request/Response and Configuration Types
 * Provider-agnostic domain definitions for BugPilot AI Architecture
 */

export type AICapability =
  | 'text'
  | 'vision'
  | 'audio'
  | 'structured_output'
  | 'tool_calling'
  | 'streaming'
  | 'embeddings'
  | 'long_context'

export type CostTier = 'FREE' | 'CHEAP' | 'STANDARD' | 'PREMIUM'

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AIMessage {
  role: AIMessageRole
  content: string
  name?: string
  images?: string[] // Base64 or URL strings for multimodal models
}

export interface JSONSchemaDefinition {
  type: string
  properties?: Record<string, any>
  required?: string[]
  items?: Record<string, any>
  description?: string
  additionalProperties?: boolean
  [key: string]: any
}

export interface NormalizedAIRequest {
  task: string
  prompt?: string
  systemPrompt?: string
  messages?: AIMessage[]
  images?: string[]
  schema?: JSONSchemaDefinition
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
  preferredProvider?: string
  preferredModel?: string
  fallbackProviders?: string[]
  metadata?: Record<string, any>
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface NormalizedAIResponse<T = any> {
  content: string
  structuredData?: T
  provider: string
  model: string
  latencyMs: number
  usage?: TokenUsage
  fallbackUsed?: boolean
  attempts?: string[]
  finishReason?: string
  requestId?: string
}

export interface NormalizedStreamChunk {
  content: string
  isComplete: boolean
  provider: string
  model: string
  usage?: TokenUsage
}

export interface ModelDefinition {
  id: string
  provider: string
  modelName: string
  displayName: string
  capabilities: Set<AICapability>
  costTier: CostTier
  maxContextTokens: number
  supportsJsonMode: boolean
}

export interface TaskDefinition {
  task: string
  description: string
  preferredProvider: string
  preferredModel: string
  fallbackProviders: string[]
  requiredCapabilities: Set<AICapability>
  temperature: number
  maxTokens: number
  schema?: JSONSchemaDefinition
  costTierPreference?: CostTier
}
