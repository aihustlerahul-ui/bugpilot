import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ModelRouterService } from '../router/model-router.service'
import { ProviderRegistry } from '../providers/provider.registry'
import { AiConfigService } from '../config/ai.config.service'
import { GeminiProvider } from '../providers/gemini.provider'
import { GroqProvider } from '../providers/groq.provider'
import { OpenRouterProvider } from '../providers/openrouter.provider'
import { OllamaProvider } from '../providers/ollama.provider'
import { OpenAIProvider } from '../providers/openai.provider'
import { AnthropicProvider } from '../providers/anthropic.provider'
import { MockAIProvider } from '../providers/mock.provider'
import { RateLimitError, RetryableProviderError, AuthenticationError } from '../core/ai-error'

describe('ModelRouterService', () => {
  let router: ModelRouterService
  let configService: AiConfigService
  let mockProvider: MockAIProvider
  let geminiProvider: GeminiProvider

  const mockConfigValues: Record<string, string> = {
    GEMINI_API_KEY: 'test-gemini-key',
    GROQ_API_KEY: 'test-groq-key',
    AI_PROVIDER: 'gemini',
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRouterService,
        AiConfigService,
        GeminiProvider,
        GroqProvider,
        OpenRouterProvider,
        OllamaProvider,
        OpenAIProvider,
        AnthropicProvider,
        MockAIProvider,
        ProviderRegistry,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfigValues[key] || null),
          },
        },
      ],
    }).compile()

    router = module.get<ModelRouterService>(ModelRouterService)
    configService = module.get<AiConfigService>(AiConfigService)
    mockProvider = module.get<MockAIProvider>(MockAIProvider)
    geminiProvider = module.get<GeminiProvider>(GeminiProvider)

    mockProvider.reset()
  })

  it('should successfully route to preferred available provider', async () => {
    // Spy on mock provider
    jest.spyOn(mockProvider, 'generateStructured')

    const res = await router.routeAndExecute({
      task: 'rca_generation',
      preferredProvider: 'mock',
      prompt: 'Diagnose checkout bug',
    }, true)

    expect(res.provider).toBe('mock')
    expect(res.fallbackUsed).toBe(false)
    expect(res.structuredData).toBeDefined()
  })

  it('should gracefully fallback to secondary provider when primary encounters 429 rate limit', async () => {
    // Make Gemini throw 429 rate limit
    jest.spyOn(geminiProvider, 'generateStructured').mockRejectedValueOnce(
      new RateLimitError('gemini', 'gemini-2.0-flash', 1000)
    )

    const res = await router.routeAndExecute({
      task: 'rca_generation',
      preferredProvider: 'gemini',
      fallbackProviders: ['mock'],
      prompt: 'Diagnose checkout bug',
    }, true)

    expect(res.provider).toBe('mock')
    expect(res.fallbackUsed).toBe(true)
    expect(res.attempts).toContain('gemini/gemini-2.0-flash')
    expect(res.attempts).toContain('mock/mock-model-v1')
  })

  it('should gracefully fallback when primary encounters 500 server error', async () => {
    // Make Gemini throw 500 server error
    jest.spyOn(geminiProvider, 'generateStructured').mockRejectedValueOnce(
      new RetryableProviderError('Internal Server Error', 'gemini', 'gemini-2.0-flash', 500)
    )

    const res = await router.routeAndExecute({
      task: 'rca_generation',
      preferredProvider: 'gemini',
      fallbackProviders: ['mock'],
      prompt: 'Diagnose checkout bug',
    }, true)

    expect(res.provider).toBe('mock')
    expect(res.fallbackUsed).toBe(true)
  })

  it('should halt immediately on non-retryable error (e.g. AuthenticationError)', async () => {
    jest.spyOn(geminiProvider, 'generateStructured').mockRejectedValueOnce(
      new AuthenticationError('gemini', 'Invalid API key')
    )

    await expect(
      router.routeAndExecute({
        task: 'rca_generation',
        preferredProvider: 'gemini',
        fallbackProviders: ['mock'],
        prompt: 'Diagnose checkout bug',
      }, true)
    ).rejects.toThrow(AuthenticationError)
  })

  it('should filter candidate providers by required capabilities', async () => {
    // Groq does not have 'vision' capability
    const groqProvider = (router as any).providerRegistry.getProvider('groq')
    const groqSpy = jest.spyOn(groqProvider, 'generateStructured')

    const res = await router.routeAndExecute({
      task: 'visual_anomaly_analysis', // requires vision
      preferredProvider: 'groq',
      fallbackProviders: ['mock'], // mock has vision
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    }, true)

    // Groq should have been skipped due to capability mismatch
    expect(groqSpy).not.toHaveBeenCalled()
    expect(res.provider).toBe('mock')
  })
})
