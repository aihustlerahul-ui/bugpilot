import { Injectable, Logger } from '@nestjs/common'
import { ProviderRegistry } from '../providers/provider.registry'
import { AiConfigService } from '../config/ai.config.service'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  AICapability,
} from '../core/ai.types'
import {
  isRetryableError,
  RetryableProviderError,
  NonRetryableProviderError,
  CapabilityMismatchError,
} from '../core/ai-error'
import { AiLogger } from '../core/ai-logger'

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name)

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly configService: AiConfigService,
  ) {}

  /**
   * Routes a request to the appropriate provider and model with deterministic fallback orchestration
   */
  async routeAndExecute<T = any>(
    request: NormalizedAIRequest,
    isStructured = false,
  ): Promise<NormalizedAIResponse<T>> {
    const taskConfig = this.configService.getTaskConfig(request.task)
    const requiredCaps = taskConfig.requiredCapabilities || new Set<AICapability>(['text'])

    // If request contains images, ensure vision capability is required
    if (request.images && request.images.length > 0) {
      requiredCaps.add('vision')
    }

    // Build candidate provider chain
    const candidateProviders: string[] = []

    // 1. Explicit request preferred provider
    if (request.preferredProvider) {
      candidateProviders.push(request.preferredProvider.toLowerCase())
    }

    // 2. Task preferred provider
    if (taskConfig.preferredProvider && !candidateProviders.includes(taskConfig.preferredProvider.toLowerCase())) {
      candidateProviders.push(taskConfig.preferredProvider.toLowerCase())
    }

    // 3. Fallback providers from request & task
    const fallbacks = [
      ...(request.fallbackProviders || []),
      ...(taskConfig.fallbackProviders || []),
      'mock', // Mock is always ultimate fallback
    ]

    for (const f of fallbacks) {
      const clean = f.toLowerCase()
      if (!candidateProviders.includes(clean)) {
        candidateProviders.push(clean)
      }
    }

    const attempts: string[] = []
    let lastError: unknown = null
    const MAX_ATTEMPTS = 3

    for (const providerId of candidateProviders) {
      if (attempts.length >= MAX_ATTEMPTS) {
        this.logger.warn(`Max fallback attempts (${MAX_ATTEMPTS}) reached for task [${request.task}]`)
        break
      }

      const provider = this.providerRegistry.getProvider(providerId)
      if (!provider) {
        continue
      }

      // Check capability match
      const caps = provider.getCapabilities()
      let hasAllCaps = true
      for (const cap of requiredCaps) {
        if (!caps.has(cap)) {
          hasAllCaps = false
          this.logger.debug(`Provider "${providerId}" skipped: lacks capability "${cap}" for task [${request.task}]`)
          break
        }
      }
      if (!hasAllCaps) continue

      // Check provider availability
      const available = await provider.isAvailable()
      if (!available) {
        this.logger.debug(`Provider "${providerId}" skipped: not available or unconfigured`)
        continue
      }

      // Determine model to use
      const model =
        (providerId === request.preferredProvider ? request.preferredModel : null) ||
        (providerId === taskConfig.preferredProvider ? taskConfig.preferredModel : null) ||
        this.configService.getDefaultModelForProvider(providerId)

      attempts.push(`${providerId}/${model}`)

      try {
        let response: NormalizedAIResponse<T>
        if (isStructured) {
          response = await provider.generateStructured<T>(request, model)
        } else {
          response = (await provider.generate(request, model)) as NormalizedAIResponse<T>
        }

        response.attempts = attempts
        response.fallbackUsed = attempts.length > 1

        AiLogger.logEvent({
          task: request.task,
          provider: response.provider,
          model: response.model,
          requestId: response.requestId || 'req_unknown',
          latencyMs: response.latencyMs,
          success: true,
          fallbackUsed: response.fallbackUsed,
          attempts,
          usage: response.usage,
        })

        return response
      } catch (err: any) {
        lastError = err

        AiLogger.logEvent({
          task: request.task,
          provider: providerId,
          model,
          requestId: 'err_' + Date.now(),
          latencyMs: 0,
          success: false,
          fallbackUsed: attempts.length > 1,
          attempts,
          errorCategory: err.name || 'ProviderError',
          errorMessage: err.message,
        })

        // Determine if we should attempt fallback
        if (!isRetryableError(err)) {
          this.logger.error(`Non-retryable error on provider "${providerId}": ${err.message}. Halting fallback.`)
          throw err
        }

        this.logger.warn(`Retryable error on provider "${providerId}" (${err.message}). Attempting next fallback...`)
      }
    }

    // All available providers failed
    if (lastError instanceof Error) {
      throw lastError
    }
    throw new RetryableProviderError(
      `All configured AI providers failed or were unavailable for task [${request.task}]. Attempts: ${attempts.join(', ')}`,
      'Router',
    )
  }
}
