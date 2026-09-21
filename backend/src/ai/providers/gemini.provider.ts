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
export class GeminiProvider extends BaseAIProvider {
  readonly id = 'gemini'
  readonly name = 'Google Gemini'

  constructor(private readonly configService: AiConfigService) {
    super()
  }

  async isAvailable(): Promise<boolean> {
    const key = this.configService.getApiKey(this.id)
    return Boolean(key && key.trim().length > 0)
  }

  getCapabilities(): Set<AICapability> {
    return new Set(['text', 'vision', 'audio', 'structured_output', 'streaming', 'tool_calling', 'long_context'])
  }

  getCostTier(): CostTier {
    return 'FREE'
  }

  async generate(request: NormalizedAIRequest, model = 'gemini-2.0-flash'): Promise<NormalizedAIResponse> {
    return this.executeGeminiCall(request, model, false)
  }

  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    model = 'gemini-2.0-flash',
  ): Promise<NormalizedAIResponse<T>> {
    return this.executeGeminiCall<T>(request, model, true)
  }

  private async executeGeminiCall<T = any>(
    request: NormalizedAIRequest,
    model: string,
    isStructured: boolean,
  ): Promise<NormalizedAIResponse<T>> {
    const apiKey = this.configService.getApiKey(this.id)
    if (!apiKey) {
      throw new AuthenticationError(this.id, 'GEMINI_API_KEY is not configured in environment')
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()
    const cleanModel = model.replace(/^models\//, '')
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`

    // Build Gemini contents payload
    const contents: any[] = []

    if (request.messages && request.messages.length > 0) {
      for (const msg of request.messages) {
        if (msg.role === 'system') continue // handled in systemInstruction

        const parts: any[] = [{ text: msg.content }]
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            const base64Data = img.replace(/^data:image\/\w+;base64,/, '')
            parts.push({
              inlineData: {
                mimeType: 'image/png',
                data: base64Data,
              },
            })
          }
        }
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        })
      }
    } else {
      const parts: any[] = [{ text: request.prompt || '' }]
      if (request.images && request.images.length > 0) {
        for (const img of request.images) {
          const base64Data = img.replace(/^data:image\/\w+;base64,/, '')
          parts.push({
            inlineData: {
              mimeType: 'image/png',
              data: base64Data,
            },
          })
        }
      }
      contents.push({ role: 'user', parts })
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 2048,
        topP: request.topP ?? 0.95,
      },
    }

    if (request.systemPrompt) {
      payload.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      }
    }

    if (isStructured) {
      payload.generationConfig.responseMimeType = 'application/json'
      if (request.schema) {
        payload.generationConfig.responseSchema = request.schema
      }
    }

    const res = await this.fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      30000,
    )

    if (!res.ok) {
      await this.handleHttpError(res, model)
    }

    const data = await res.json()
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const usageMetadata = data.usageMetadata
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
      finishReason: data.candidates?.[0]?.finishReason || 'STOP',
      usage: usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    }
  }
}
