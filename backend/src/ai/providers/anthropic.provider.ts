import { Injectable } from '@nestjs/common'
import { BaseAIProvider } from './base.provider'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  AICapability,
  CostTier,
} from '../core/ai.types'
import { AiConfigService } from '../config/ai.config.service'
import { AuthenticationError } from '../core/ai-error'

@Injectable()
export class AnthropicProvider extends BaseAIProvider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic Claude'

  constructor(private readonly configService: AiConfigService) {
    super()
  }

  async isAvailable(): Promise<boolean> {
    const key = this.configService.getApiKey(this.id)
    return Boolean(key && key.trim().length > 0)
  }

  getCapabilities(): Set<AICapability> {
    return new Set(['text', 'vision', 'structured_output', 'streaming', 'tool_calling', 'long_context'])
  }

  getCostTier(): CostTier {
    return 'PREMIUM'
  }

  async generate(request: NormalizedAIRequest, model = 'claude-3-5-haiku-20241022'): Promise<NormalizedAIResponse> {
    return this.executeAnthropicCall(request, model, false)
  }

  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    model = 'claude-3-5-haiku-20241022',
  ): Promise<NormalizedAIResponse<T>> {
    return this.executeAnthropicCall<T>(request, model, true)
  }

  private async executeAnthropicCall<T = any>(
    request: NormalizedAIRequest,
    model: string,
    isStructured: boolean,
  ): Promise<NormalizedAIResponse<T>> {
    const apiKey = this.configService.getApiKey(this.id)
    if (!apiKey) {
      throw new AuthenticationError(this.id, 'ANTHROPIC_API_KEY is not configured in environment')
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()
    const endpoint = 'https://api.anthropic.com/v1/messages'

    const messages: any[] = []
    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) {
        if (m.role === 'system') continue
        messages.push({ role: m.role, content: m.content })
      }
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt })
    }

    let system = request.systemPrompt || ''
    if (isStructured) {
      system += '\nIMPORTANT: You must respond ONLY with valid, parseable JSON conforming to the requested schema. Do not enclose in backticks or add introductory text.'
    }

    const payload: any = {
      model,
      messages,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.2,
    }

    if (system) {
      payload.system = system
    }

    const res = await this.fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      },
      30000,
    )

    if (!res.ok) {
      await this.handleHttpError(res, model)
    }

    const data = await res.json()
    const textContent = data.content?.[0]?.text || ''
    const usage = data.usage
    const latencyMs = Date.now() - startTime

    let structuredData: T | undefined
    if (isStructured) {
      structuredData = this.extractJsonFromText<T>(textContent, model)
    }

    return {
      content: textContent,
      structuredData,
      provider: this.id,
      model,
      latencyMs,
      requestId,
      finishReason: data.stop_reason || 'end_turn',
      usage: usage
        ? {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          }
        : undefined,
    }
  }
}
