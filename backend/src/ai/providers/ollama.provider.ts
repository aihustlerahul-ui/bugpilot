import { Injectable } from '@nestjs/common'
import { BaseAIProvider } from './base.provider'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  AICapability,
  CostTier,
} from '../core/ai.types'
import { AiConfigService } from '../config/ai.config.service'
import { RetryableProviderError } from '../core/ai-error'

@Injectable()
export class OllamaProvider extends BaseAIProvider {
  readonly id = 'ollama'
  readonly name = 'Ollama (Local Models)'

  constructor(private readonly configService: AiConfigService) {
    super()
  }

  async isAvailable(): Promise<boolean> {
    const baseUrl = this.configService.getOllamaBaseUrl()
    try {
      const res = await this.fetchWithTimeout(`${baseUrl}/api/tags`, { method: 'GET' }, 3000)
      return res.ok
    } catch {
      return false
    }
  }

  getCapabilities(): Set<AICapability> {
    return new Set(['text', 'vision', 'structured_output', 'streaming'])
  }

  getCostTier(): CostTier {
    return 'FREE'
  }

  async generate(request: NormalizedAIRequest, model = 'llama3.2'): Promise<NormalizedAIResponse> {
    return this.executeOllamaCall(request, model, false)
  }

  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    model = 'llama3.2',
  ): Promise<NormalizedAIResponse<T>> {
    return this.executeOllamaCall<T>(request, model, true)
  }

  private async executeOllamaCall<T = any>(
    request: NormalizedAIRequest,
    model: string,
    isStructured: boolean,
  ): Promise<NormalizedAIResponse<T>> {
    const baseUrl = this.configService.getOllamaBaseUrl()
    const startTime = Date.now()
    const requestId = this.generateRequestId()
    const endpoint = `${baseUrl}/api/chat`

    const messages: any[] = []
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt })
    }

    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) {
        const item: any = { role: m.role, content: m.content }
        if (m.images && m.images.length > 0) {
          item.images = m.images.map((img) => img.replace(/^data:image\/\w+;base64,/, ''))
        }
        messages.push(item)
      }
    } else if (request.prompt) {
      const item: any = { role: 'user', content: request.prompt }
      if (request.images && request.images.length > 0) {
        item.images = request.images.map((img) => img.replace(/^data:image\/\w+;base64,/, ''))
      }
      messages.push(item)
    }

    const payload: any = {
      model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens ?? 2048,
        top_p: request.topP ?? 0.95,
      },
    }

    if (isStructured) {
      payload.format = 'json'
    }

    let res: Response
    try {
      res = await this.fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        60000,
      )
    } catch (err: any) {
      throw new RetryableProviderError(
        `Failed to connect to local Ollama at ${baseUrl}: ${err.message}`,
        this.id,
        model,
        undefined,
        err,
      )
    }

    if (!res.ok) {
      await this.handleHttpError(res, model)
    }

    const data = await res.json()
    const textContent = data.message?.content || ''
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
      finishReason: data.done ? 'stop' : 'unknown',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    }
  }
}
