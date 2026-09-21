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
export class GroqProvider extends BaseAIProvider {
  readonly id = 'groq'
  readonly name = 'Groq Cloud'

  constructor(private readonly configService: AiConfigService) {
    super()
  }

  async isAvailable(): Promise<boolean> {
    const key = this.configService.getApiKey(this.id)
    return Boolean(key && key.trim().length > 0)
  }

  getCapabilities(): Set<AICapability> {
    return new Set(['text', 'structured_output', 'streaming', 'tool_calling'])
  }

  getCostTier(): CostTier {
    return 'FREE'
  }

  async generate(request: NormalizedAIRequest, model = 'llama-3.3-70b-versatile'): Promise<NormalizedAIResponse> {
    return this.executeGroqCall(request, model, false)
  }

  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    model = 'llama-3.3-70b-versatile',
  ): Promise<NormalizedAIResponse<T>> {
    return this.executeGroqCall<T>(request, model, true)
  }

  private async executeGroqCall<T = any>(
    request: NormalizedAIRequest,
    model: string,
    isStructured: boolean,
  ): Promise<NormalizedAIResponse<T>> {
    const apiKey = this.configService.getApiKey(this.id)
    if (!apiKey) {
      throw new AuthenticationError(this.id, 'GROQ_API_KEY is not configured in environment')
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions'

    const messages: any[] = []
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt })
    }

    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) {
        messages.push({ role: m.role, content: m.content })
      }
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt })
    }

    const payload: any = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
      top_p: request.topP ?? 0.95,
    }

    if (isStructured) {
      payload.response_format = { type: 'json_object' }
    }

    const res = await this.fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      30000,
    )

    if (!res.ok) {
      await this.handleHttpError(res, model)
    }

    const data = await res.json()
    const textContent = data.choices?.[0]?.message?.content || ''
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
      finishReason: data.choices?.[0]?.finish_reason || 'stop',
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
        : undefined,
    }
  }
}
