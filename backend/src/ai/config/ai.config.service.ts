import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TASK_DEFINITIONS } from './ai-tasks.config'
import { KNOWN_MODELS } from './ai-models.config'
import type { TaskDefinition, ModelDefinition } from '../core/ai.types'

@Injectable()
export class AiConfigService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Primary provider override (if set via AI_PROVIDER or PRIMARY_AI_PROVIDER)
   */
  getPrimaryProvider(): string | null {
    return (
      this.config.get<string>('AI_PROVIDER') ||
      this.config.get<string>('PRIMARY_AI_PROVIDER') ||
      null
    )
  }

  /**
   * Global fallback providers override (comma-separated list, e.g. "groq,openrouter,ollama,mock")
   */
  getGlobalFallbackProviders(): string[] {
    const raw = this.config.get<string>('FALLBACK_AI_PROVIDERS')
    if (!raw) return []
    return raw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  }

  /**
   * Get API key for a given provider
   */
  getApiKey(provider: string): string | null {
    const keyMap: Record<string, string> = {
      gemini: 'GEMINI_API_KEY',
      groq: 'GROQ_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      xai: 'XAI_API_KEY',
      cloudflare: 'CLOUDFLARE_API_KEY',
    }

    const envVar = keyMap[provider.toLowerCase()]
    if (!envVar) return null
    return this.config.get<string>(envVar) || process.env[envVar] || null
  }

  /**
   * Get Ollama base URL (defaults to http://localhost:11434)
   */
  getOllamaBaseUrl(): string {
    return (
      this.config.get<string>('OLLAMA_BASE_URL') ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    )
  }

  /**
   * Get Task configuration merged with environment overrides
   */
  getTaskConfig(taskName: string): TaskDefinition {
    const base = TASK_DEFINITIONS[taskName] || {
      task: taskName,
      description: `Dynamic task: ${taskName}`,
      preferredProvider: 'gemini',
      preferredModel: 'gemini-2.0-flash',
      fallbackProviders: ['groq', 'openrouter', 'ollama', 'mock'],
      requiredCapabilities: new Set(['text']),
      temperature: 0.3,
      maxTokens: 1500,
      costTierPreference: 'FREE',
    }

    // Apply global primary provider override if configured
    const primaryOverride = this.getPrimaryProvider()
    const globalFallbacks = this.getGlobalFallbackProviders()

    return {
      ...base,
      preferredProvider: primaryOverride || base.preferredProvider,
      fallbackProviders: globalFallbacks.length > 0 ? globalFallbacks : base.fallbackProviders,
    }
  }

  /**
   * Get Model definition for a given model ID
   */
  getModelDefinition(modelId: string): ModelDefinition | null {
    return KNOWN_MODELS[modelId] || null
  }

  /**
   * Get default model for a given provider
   */
  getDefaultModelForProvider(provider: string): string {
    const defaults: Record<string, string> = {
      gemini: 'gemini-2.0-flash',
      groq: 'llama-3.3-70b-versatile',
      openrouter: 'meta-llama/llama-3.3-70b-instruct',
      ollama: 'llama3.2',
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-haiku-20241022',
      mock: 'mock-model-v1',
    }
    return defaults[provider.toLowerCase()] || 'mock-model-v1'
  }
}
