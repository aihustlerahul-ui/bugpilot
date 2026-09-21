import { Test, TestingModule } from '@nestjs/testing'
import { AiOrchestratorService } from '../router/ai-orchestrator.service'
import { ModelRouterService } from '../router/model-router.service'
import { PromptRegistry } from '../prompts/prompt.registry'
import { ProviderRegistry } from '../providers/provider.registry'
import { AiConfigService } from '../config/ai.config.service'
import { GeminiProvider } from '../providers/gemini.provider'
import { GroqProvider } from '../providers/groq.provider'
import { OpenRouterProvider } from '../providers/openrouter.provider'
import { OllamaProvider } from '../providers/ollama.provider'
import { OpenAIProvider } from '../providers/openai.provider'
import { AnthropicProvider } from '../providers/anthropic.provider'
import { MockAIProvider } from '../providers/mock.provider'
import { ConfigService } from '@nestjs/config'

describe('Structured Output & Schema Validation', () => {
  let orchestrator: AiOrchestratorService
  let mockProvider: MockAIProvider

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOrchestratorService,
        ModelRouterService,
        PromptRegistry,
        ProviderRegistry,
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
            get: jest.fn(() => null), // Use mock provider
          },
        },
      ],
    }).compile()

    orchestrator = module.get<AiOrchestratorService>(AiOrchestratorService)
    mockProvider = module.get<MockAIProvider>(MockAIProvider)
  })

  it('should generate structured meeting summary adhering to schema', async () => {
    const res = await orchestrator.generateStructured({
      task: 'meeting_summary',
      prompt: 'Meeting transcript: Reviewed BugPilot release roadmap. Decided to launch Part B tomorrow.',
    })

    expect(res.structuredData).toBeDefined()
    expect(res.structuredData.summary).toBeDefined()
    expect(Array.isArray(res.structuredData.decisions)).toBe(true)
    expect(Array.isArray(res.structuredData.action_items)).toBe(true)
  })

  it('should generate structured RCA diagnostic output', async () => {
    const res = await orchestrator.generateStructured({
      task: 'rca_generation',
      prompt: 'Diagnose checkout 500 error',
    })

    expect(res.structuredData).toBeDefined()
    expect(res.structuredData.probableComponent).toBe('CheckoutButton')
    expect(res.structuredData.suggestedPatch).toBeDefined()
    expect(res.structuredData.confidenceScore).toBeGreaterThan(0.8)
  })

  it('should run multi-model workflow orchestrator', async () => {
    const workflowResult = await orchestrator.runWorkflow('diagnose_and_verify', {
      title: 'Checkout failure',
      url: 'https://shop.example.com/checkout',
    })

    expect(workflowResult.rca).toBeDefined()
    expect(workflowResult.testSpec).toBeDefined()
  })
})
