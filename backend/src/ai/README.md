# BugPilot Provider-Agnostic AI Architecture

The BugPilot AI Architecture is **provider-agnostic**, decoupling application business logic from specific AI vendors (Gemini, Groq, OpenRouter, Ollama, OpenAI, Anthropic, etc.).

---

## 🏗️ 1. Core Architecture

```
Application Business Logic (AiService)
                  │
                  ▼
         AI Orchestrator (ai.generate, ai.generateStructured, ai.stream)
                  │
                  ▼
         Model Router & Fallback Engine (Capability matching, error classification, retry limit)
                  │
     ┌────────────┼────────────┬─────────────┬────────────┬────────────┐
     ▼            ▼            ▼             ▼            ▼            ▼
GeminiAdapter  GroqAdapter  OpenRouter   OllamaAdapter OpenAIAdapter MockAdapter
 (Google REST) (Groq REST)  (OpenRouter)   (Local REST) (OpenAI REST) (Offline)
     │            │            │             │            │            │
     └────────────┴────────────┴─────────────┴────────────┴────────────┘
                                   │
                                   ▼
                   Normalized AIResponse / Structured Data
```

### Key Principles
1. **Zero Vendor Lock-in**: Business logic never imports or calls provider SDKs directly.
2. **Zero External SDK Bloat**: Adapters use standard native `fetch` with `AbortController` timeouts and normalized error translation.
3. **Task-Driven Thinking**: The application asks for tasks (e.g. `rca_generation`, `smart_autofill`, `visual_anomaly_analysis`, `meeting_summary`), never hardcoded models.
4. **Resilient Fallback**: Automatic retry and fallback on rate limits (429), timeouts, and 5xx server errors (capped at 3 attempts).
5. **Deterministic Testing**: `MockAIProvider` enables 100% free, deterministic offline unit testing.

---

## 🚀 2. Provider Setup & Configuration

Configure providers via environment variables in `backend/.env` (or production environment variables):

### 🌟 Running with Google Gemini (Default Development & Production)
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
```

### ⚡ Running with Groq Cloud (Ultra-Fast Free Tier)
```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

### 🌐 Running with OpenRouter (Multi-Model Gateway)
```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
```

### 🦙 Running with Ollama (Local Models — Zero API Keys)
```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
```
Ensure Ollama is running locally:
```bash
ollama run llama3.2
```

### 🧪 Running with Mock Provider (Zero Cost / Offline Development)
```env
AI_PROVIDER=mock
```

### 🔄 Multi-Provider Fallback Priority Chain
```env
PRIMARY_AI_PROVIDER=gemini
FALLBACK_AI_PROVIDERS=groq,openrouter,ollama,mock
```

---

## 🛠️ 3. How to Add a New Provider Adapter

To add a new provider (e.g. `CloudflareWorkersAIProvider` or `XAIProvider`):

1. Create a new file in `backend/src/ai/providers/<name>.provider.ts` extending `BaseAIProvider`:

```typescript
import { Injectable } from '@nestjs/common';
import { BaseAIProvider } from './base.provider';
import type { NormalizedAIRequest, NormalizedAIResponse, AICapability, CostTier } from '../core/ai.types';
import { AiConfigService } from '../config/ai.config.service';

@Injectable()
export class CloudflareProvider extends BaseAIProvider {
  readonly id = 'cloudflare';
  readonly name = 'Cloudflare Workers AI';

  constructor(private readonly configService: AiConfigService) {
    super();
  }

  async isAvailable(): Promise<boolean> {
    const key = this.configService.getApiKey(this.id);
    return Boolean(key);
  }

  getCapabilities(): Set<AICapability> {
    return new Set(['text', 'structured_output']);
  }

  getCostTier(): CostTier {
    return 'CHEAP';
  }

  async generate(request: NormalizedAIRequest, model = '@cf/meta/llama-3-8b-instruct'): Promise<NormalizedAIResponse> {
    // Perform fetchWithTimeout(...)
  }

  async generateStructured<T = any>(request: NormalizedAIRequest, model = '@cf/meta/llama-3-8b-instruct'): Promise<NormalizedAIResponse<T>> {
    // Perform fetchWithTimeout(...) and extractJsonFromText<T>(...)
  }
}
```

2. Register the provider in `ProviderRegistry` (`backend/src/ai/providers/provider.registry.ts`) and `AiModule` (`backend/src/ai/ai.module.ts`).

---

## 🎯 4. How to Create a New AI Task

1. Define the task configuration in `backend/src/ai/config/ai-tasks.config.ts`:

```typescript
export const TASK_DEFINITIONS: Record<string, TaskDefinition> = {
  // ...
  code_review: {
    task: 'code_review',
    description: 'Reviews pull request diffs for security and performance flaws',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-1.5-pro',
    fallbackProviders: ['groq', 'openrouter', 'mock'],
    requiredCapabilities: new Set(['text', 'structured_output']),
    temperature: 0.1,
    maxTokens: 2500,
  },
};
```

2. (Optional) Create a versioned prompt template in `backend/src/ai/prompts/` and register it in `PromptRegistry`.

3. Call the orchestrator anywhere in backend services:

```typescript
const result = await this.aiOrchestrator.generateStructured<{ flaws: string[]; score: number }>({
  task: 'code_review',
  prompt: 'Review diff: ...',
});
```

---

## 🧪 5. Running Tests Without Paid API Keys

All unit tests use mocked HTTP fetch responses or `MockAIProvider`, requiring **zero network calls and zero API credits**:

```bash
cd backend
npm test
```

### Test Suites Included:
- `src/ai/tests/ai-router.spec.ts` — Tests routing, 429 rate limit fallback, 500 error fallback, capability filtering.
- `src/ai/tests/providers.spec.ts` — Tests Gemini, Groq, OpenRouter, Ollama, and Mock adapters.
- `src/ai/tests/structured-output.spec.ts` — Tests JSON schema validation and multi-step workflows.
- `src/ai/ai.service.spec.ts` — Tests all BugPilot domain operations (RCA, Playwright, Duplicate Detection, Smart Autofill, Visual Anomalies).
