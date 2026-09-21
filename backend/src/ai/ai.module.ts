import { Module } from '@nestjs/common'
import { SupabaseModule } from '../supabase/supabase.module'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'

// Core & Configuration
import { AiConfigService } from './config/ai.config.service'

// Provider Adapters
import { GeminiProvider } from './providers/gemini.provider'
import { GroqProvider } from './providers/groq.provider'
import { OpenRouterProvider } from './providers/openrouter.provider'
import { OllamaProvider } from './providers/ollama.provider'
import { OpenAIProvider } from './providers/openai.provider'
import { AnthropicProvider } from './providers/anthropic.provider'
import { MockAIProvider } from './providers/mock.provider'
import { ProviderRegistry } from './providers/provider.registry'

// Prompts & Router
import { PromptRegistry } from './prompts/prompt.registry'
import { ModelRouterService } from './router/model-router.service'
import { AiOrchestratorService } from './router/ai-orchestrator.service'

@Module({
  imports: [SupabaseModule],
  controllers: [AiController],
  providers: [
    AiConfigService,
    // Providers
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    OllamaProvider,
    OpenAIProvider,
    AnthropicProvider,
    MockAIProvider,
    ProviderRegistry,
    // Prompts & Orchestration
    PromptRegistry,
    ModelRouterService,
    AiOrchestratorService,
    // High-Level Service
    AiService,
  ],
  exports: [
    AiService,
    AiOrchestratorService,
    ModelRouterService,
    ProviderRegistry,
    AiConfigService,
  ],
})
export class AiModule {}
