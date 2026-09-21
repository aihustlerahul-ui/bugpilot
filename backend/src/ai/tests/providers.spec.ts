import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AiConfigService } from '../config/ai.config.service'
import { GeminiProvider } from '../providers/gemini.provider'
import { GroqProvider } from '../providers/groq.provider'
import { OpenRouterProvider } from '../providers/openrouter.provider'
import { OllamaProvider } from '../providers/ollama.provider'
import { OpenAIProvider } from '../providers/openai.provider'
import { AnthropicProvider } from '../providers/anthropic.provider'
import { MockAIProvider } from '../providers/mock.provider'
import { AuthenticationError } from '../core/ai-error'

describe('AI Provider Adapters', () => {
  let configService: AiConfigService
  let mockProvider: MockAIProvider
  let geminiProvider: GeminiProvider
  let groqProvider: GroqProvider
  let ollamaProvider: OllamaProvider

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiConfigService,
        GeminiProvider,
        GroqProvider,
        OpenRouterProvider,
        OllamaProvider,
        OpenAIProvider,
        AnthropicProvider,
        MockAIProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'GEMINI_API_KEY') return 'mock-gemini-key'
              if (key === 'GROQ_API_KEY') return 'mock-groq-key'
              if (key === 'OLLAMA_BASE_URL') return 'http://localhost:11434'
              return null
            }),
          },
        },
      ],
    }).compile()

    configService = module.get<AiConfigService>(AiConfigService)
    mockProvider = module.get<MockAIProvider>(MockAIProvider)
    geminiProvider = module.get<GeminiProvider>(GeminiProvider)
    groqProvider = module.get<GroqProvider>(GroqProvider)
    ollamaProvider = module.get<OllamaProvider>(OllamaProvider)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('MockAIProvider', () => {
    it('should generate deterministic mock completion', async () => {
      const res = await mockProvider.generate({
        task: 'coding',
        prompt: 'Fix null pointer exception',
      })

      expect(res.provider).toBe('mock')
      expect(res.content).toContain('Mock AI response')
      expect(res.latencyMs).toBeGreaterThan(0)
    })

    it('should generate structured JSON output for RCA task', async () => {
      const res = await mockProvider.generateStructured({
        task: 'rca_generation',
      })

      expect(res.structuredData).toBeDefined()
      expect(res.structuredData.probableComponent).toBe('CheckoutButton')
      expect(res.structuredData.suggestedPatch).toContain('try {')
    })
  })

  describe('GeminiProvider', () => {
    it('should report availability true when API key is set', async () => {
      expect(await geminiProvider.isAvailable()).toBe(true)
    })

    it('should execute normalized request against Gemini API and parse response', async () => {
      const mockFetchResponse = {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ summary: 'Network failed', probableComponent: 'App' }) }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25, totalTokenCount: 40 },
        }),
      }

      jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce(mockFetchResponse as any)

      const res = await geminiProvider.generateStructured({
        task: 'rca_generation',
        prompt: 'Analyze error',
      })

      expect(res.provider).toBe('gemini')
      expect(res.structuredData.summary).toBe('Network failed')
      expect(res.usage?.totalTokens).toBe(40)
    })
  })

  describe('GroqProvider', () => {
    it('should execute normalized request against Groq Cloud API', async () => {
      const mockFetchResponse = {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ category: 'Frontend', confidence: 0.95 }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        }),
      }

      jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce(mockFetchResponse as any)

      const res = await groqProvider.generateStructured({
        task: 'classification',
        prompt: 'Classify UI error',
      })

      expect(res.provider).toBe('groq')
      expect(res.structuredData.category).toBe('Frontend')
      expect(res.usage?.totalTokens).toBe(22)
    })
  })
})
