import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  NormalizedStreamChunk,
  AICapability,
  CostTier,
} from './ai.types'

export interface AIProvider {
  readonly id: string
  readonly name: string

  /**
   * Returns whether the provider is currently available (configured, reachable, has valid credentials)
   */
  isAvailable(): Promise<boolean>

  /**
   * Returns the set of capabilities supported by this provider
   */
  getCapabilities(): Set<AICapability>

  /**
   * Returns the cost tier category for this provider
   */
  getCostTier(): CostTier

  /**
   * Generates a standard text completion / chat response
   */
  generate(request: NormalizedAIRequest, model: string): Promise<NormalizedAIResponse>

  /**
   * Generates a structured JSON output conforming to the requested schema
   */
  generateStructured<T = any>(
    request: NormalizedAIRequest,
    model: string,
  ): Promise<NormalizedAIResponse<T>>

  /**
   * Streams a text completion / chat response
   */
  stream?(
    request: NormalizedAIRequest,
    model: string,
  ): AsyncIterable<NormalizedStreamChunk>
}
