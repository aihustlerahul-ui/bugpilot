/**
 * AI Provider Error Taxonomy & Classification
 */

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly model?: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`)
    this.name = 'AIProviderError'
  }
}

export class RetryableProviderError extends AIProviderError {
  constructor(
    message: string,
    provider: string,
    model?: string,
    statusCode?: number,
    cause?: unknown,
  ) {
    super(message, provider, model, statusCode, cause)
    this.name = 'RetryableProviderError'
  }
}

export class NonRetryableProviderError extends AIProviderError {
  constructor(
    message: string,
    provider: string,
    model?: string,
    statusCode?: number,
    cause?: unknown,
  ) {
    super(message, provider, model, statusCode, cause)
    this.name = 'NonRetryableProviderError'
  }
}

export class RateLimitError extends RetryableProviderError {
  constructor(
    provider: string,
    model?: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super('Rate limit exceeded (429)', provider, model, 429, cause)
    this.name = 'RateLimitError'
  }
}

export class TimeoutError extends RetryableProviderError {
  constructor(provider: string, model?: string, public readonly timeoutMs?: number) {
    super(`Request timed out after ${timeoutMs || 30000}ms`, provider, model, 408)
    this.name = 'TimeoutError'
  }
}

export class AuthenticationError extends NonRetryableProviderError {
  constructor(provider: string, message = 'Invalid or missing API key') {
    super(message, provider, undefined, 401)
    this.name = 'AuthenticationError'
  }
}

export class CapabilityMismatchError extends NonRetryableProviderError {
  constructor(
    provider: string,
    model: string,
    public readonly missingCapability: string,
  ) {
    super(
      `Model "${model}" lacks required capability "${missingCapability}"`,
      provider,
      model,
      400,
    )
    this.name = 'CapabilityMismatchError'
  }
}

export class SchemaValidationError extends NonRetryableProviderError {
  constructor(
    provider: string,
    model: string,
    message: string,
    public readonly rawContent: string,
    public readonly validationErrors?: string[],
  ) {
    super(`Schema validation failed: ${message}`, provider, model, 422)
    this.name = 'SchemaValidationError'
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableProviderError) return true
  if (error instanceof NonRetryableProviderError) return false

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('fetch failed') ||
      msg.includes('overloaded')
    ) {
      return true
    }
  }

  return false
}
