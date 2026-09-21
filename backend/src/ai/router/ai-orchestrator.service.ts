import { Injectable, Logger } from '@nestjs/common'
import { ModelRouterService } from './model-router.service'
import { PromptRegistry } from '../prompts/prompt.registry'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  JSONSchemaDefinition,
} from '../core/ai.types'

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name)

  constructor(
    private readonly router: ModelRouterService,
    private readonly promptRegistry: PromptRegistry,
  ) {}

  /**
   * Generates a free-form text or completion response
   */
  async generate(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    const enriched = this.enrichRequestWithPrompt(request)
    return this.router.routeAndExecute(enriched, false)
  }

  /**
   * Generates a strongly typed structured object validated against JSON Schema
   */
  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    customSchema?: JSONSchemaDefinition,
  ): Promise<NormalizedAIResponse<T>> {
    const enriched = this.enrichRequestWithPrompt(request)
    if (customSchema) {
      enriched.schema = customSchema
    }
    return this.router.routeAndExecute<T>(enriched, true)
  }

  /**
   * Run multi-stage AI workflow (e.g. Researcher -> Critic -> Synthesizer)
   */
  async runWorkflow<T = any>(workflowName: string, input: any): Promise<T> {
    this.logger.log(`Executing AI Workflow: "${workflowName}"`)

    if (workflowName === 'diagnose_and_verify') {
      // Step 1: Diagnose root cause
      const rca = await this.generateStructured({
        task: 'rca_generation',
        metadata: input,
      })

      // Step 2: Generate Playwright spec
      const testSpec = await this.generateStructured({
        task: 'playwright_test_generation',
        metadata: { ...input, rca: rca.structuredData },
      })

      return {
        rca: rca.structuredData,
        testSpec: testSpec.structuredData,
      } as unknown as T
    }

    throw new Error(`Unknown AI workflow: ${workflowName}`)
  }

  /**
   * Helper: Merges prompt template (system prompt, schema) if registered for this task
   */
  private enrichRequestWithPrompt(request: NormalizedAIRequest): NormalizedAIRequest {
    const template = this.promptRegistry.getPrompt(request.task)
    if (!template) {
      return request
    }

    return {
      ...request,
      systemPrompt: request.systemPrompt || template.systemPrompt,
      schema: request.schema || template.schema,
      temperature: request.temperature ?? template.defaultTemperature,
      maxTokens: request.maxTokens ?? template.defaultMaxTokens,
    }
  }
}
