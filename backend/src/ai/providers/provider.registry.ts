import { Injectable, Logger } from '@nestjs/common'
import type { AIProvider } from '../core/ai-provider.interface'
import { GeminiProvider } from './gemini.provider'
import { GroqProvider } from './groq.provider'
import { OpenRouterProvider } from './openrouter.provider'
import { OllamaProvider } from './ollama.provider'
import { OpenAIProvider } from './openai.provider'
import { AnthropicProvider } from './anthropic.provider'
import { MockAIProvider } from './mock.provider'

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name)
  private readonly providers: Map<string, AIProvider> = new Map()

  constructor(
    private readonly gemini: GeminiProvider,
    private readonly groq: GroqProvider,
    private readonly openrouter: OpenRouterProvider,
    private readonly ollama: OllamaProvider,
    private readonly openai: OpenAIProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly mock: MockAIProvider,
  ) {
    this.registerProvider(gemini)
    this.registerProvider(groq)
    this.registerProvider(openrouter)
    this.registerProvider(ollama)
    this.registerProvider(openai)
    this.registerProvider(anthropic)
    this.registerProvider(mock)
  }

  registerProvider(provider: AIProvider) {
    this.providers.set(provider.id.toLowerCase(), provider)
  }

  getProvider(providerId: string): AIProvider | null {
    return this.providers.get(providerId.toLowerCase()) || null
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values())
  }
}
