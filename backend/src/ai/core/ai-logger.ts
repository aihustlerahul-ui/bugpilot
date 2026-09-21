import { Logger } from '@nestjs/common'
import type { TokenUsage } from './ai.types'

export interface AIObservabilityEvent {
  task: string
  provider: string
  model: string
  requestId: string
  latencyMs: number
  success: boolean
  fallbackUsed: boolean
  attempts?: string[]
  usage?: TokenUsage
  approximateCostUsd?: number
  errorCategory?: string
  errorMessage?: string
}

export class AiLogger {
  private static readonly logger = new Logger('AiObservability')

  /**
   * Logs a completed or failed AI request with sanitized telemetry
   */
  static logEvent(event: AIObservabilityEvent) {
    const status = event.success ? 'SUCCESS' : 'FAILED'
    const fallbackText = event.fallbackUsed ? ` [FALLBACK from ${event.attempts?.[0] || 'primary'}]` : ''
    const tokens = event.usage ? ` (tokens: ${event.usage.totalTokens})` : ''
    const cost = event.approximateCostUsd !== undefined ? ` (~$${event.approximateCostUsd.toFixed(6)})` : ''

    const logMsg = `[${event.task}] ${status} via ${event.provider}/${event.model} in ${event.latencyMs}ms${fallbackText}${tokens}${cost} (req: ${event.requestId})`

    if (event.success) {
      this.logger.log(logMsg)
    } else {
      this.logger.warn(`${logMsg} - ${event.errorCategory || 'Error'}: ${event.errorMessage || 'Unknown failure'}`)
    }
  }

  /**
   * Sanitizes sensitive text (API keys, authorization headers, passwords) before logging
   */
  static sanitize(text: string): string {
    if (!text) return ''
    return text
      .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
      .replace(/key=[A-Za-z0-9_\-]+/gi, 'key=[REDACTED]')
      .replace(/api[-_]?key["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]+/gi, 'api_key: [REDACTED]')
  }
}
