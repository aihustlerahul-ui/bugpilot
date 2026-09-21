import type { AIProvider } from '../core/ai-provider.interface'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  AICapability,
  CostTier,
} from '../core/ai.types'
import {
  RetryableProviderError,
  NonRetryableProviderError,
  RateLimitError,
  TimeoutError,
  AuthenticationError,
  SchemaValidationError,
} from '../core/ai-error'
import * as crypto from 'crypto'

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly id: string
  abstract readonly name: string

  abstract isAvailable(): Promise<boolean>
  abstract getCapabilities(): Set<AICapability>
  abstract getCostTier(): CostTier
  abstract generate(request: NormalizedAIRequest, model: string): Promise<NormalizedAIResponse>
  abstract generateStructured<T = any>(
    request: NormalizedAIRequest,
    model: string,
  ): Promise<NormalizedAIResponse<T>>

  /**
   * Helper: Performs an HTTP request with an AbortSignal timeout and standard error classification
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = 30000,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timer)
      return res
    } catch (err: any) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        throw new TimeoutError(this.id, undefined, timeoutMs)
      }
      throw new RetryableProviderError(
        `Network failure connecting to ${this.name}: ${err.message}`,
        this.id,
        undefined,
        undefined,
        err,
      )
    }
  }

  /**
   * Helper: Translates HTTP error responses into categorized domain errors
   */
  protected async handleHttpError(response: Response, model?: string): Promise<never> {
    let errorBody = ''
    try {
      errorBody = await response.text()
    } catch {
      // ignore
    }

    const status = response.status

    if (status === 401 || status === 403) {
      throw new AuthenticationError(
        this.id,
        `Authentication failed (${status}): Invalid API key or permission denied for ${this.name}. Details: ${errorBody.slice(0, 200)}`,
      )
    }

    if (status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) * 1000 || 2000
      throw new RateLimitError(this.id, model, retryAfter)
    }

    if (status >= 500) {
      throw new RetryableProviderError(
        `Server error (${status}) from ${this.name}: ${errorBody.slice(0, 200)}`,
        this.id,
        model,
        status,
      )
    }

    // 400 Bad Request or others
    throw new NonRetryableProviderError(
      `Bad request (${status}) to ${this.name}: ${errorBody.slice(0, 200)}`,
      this.id,
      model,
      status,
    )
  }

  /**
   * Helper: Robustly extracts and parses JSON from raw LLM output
   */
  protected extractJsonFromText<T>(rawText: string, model: string): T {
    if (!rawText) {
      throw new SchemaValidationError(this.id, model, 'Empty response from model', rawText)
    }

    // 1. Try direct parse
    try {
      return JSON.parse(rawText.trim())
    } catch {
      // Continue to regex parsing
    }

    // 2. Strip Markdown ```json ... ``` blocks
    const jsonBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (jsonBlockMatch && jsonBlockMatch[1]) {
      try {
        return JSON.parse(jsonBlockMatch[1].trim())
      } catch {
        // Continue to bracket matching
      }
    }

    // 3. Find outermost JSON object { ... } or array [ ... ]
    const firstBrace = rawText.indexOf('{')
    const lastBrace = rawText.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = rawText.slice(firstBrace, lastBrace + 1)
      try {
        return JSON.parse(candidate)
      } catch {
        // Try simple quote repair
        try {
          const sanitized = candidate
            .replace(/,\s*([\}\]])/g, '$1') // remove trailing commas
          return JSON.parse(sanitized)
        } catch {
          // fail
        }
      }
    }

    throw new SchemaValidationError(
      this.id,
      model,
      'Failed to parse structured JSON from LLM output',
      rawText,
    )
  }

  /**
   * Helper: Generate random request ID
   */
  protected generateRequestId(): string {
    return `req_${crypto.randomBytes(6).toString('hex')}`
  }
}
