import { Injectable } from '@nestjs/common'
import { BaseAIProvider } from './base.provider'
import type {
  NormalizedAIRequest,
  NormalizedAIResponse,
  AICapability,
  CostTier,
} from '../core/ai.types'
import { RateLimitError, TimeoutError, RetryableProviderError } from '../core/ai-error'

@Injectable()
export class MockAIProvider extends BaseAIProvider {
  readonly id = 'mock'
  readonly name = 'Offline Mock AI'

  private simulatedError: 'none' | 'ratelimit' | 'timeout' | 'servererror' = 'none'
  private customResponses: Map<string, any> = new Map()

  async isAvailable(): Promise<boolean> {
    return true
  }

  getCapabilities(): Set<AICapability> {
    return new Set([
      'text',
      'vision',
      'audio',
      'structured_output',
      'streaming',
      'tool_calling',
      'embeddings',
      'long_context',
    ])
  }

  getCostTier(): CostTier {
    return 'FREE'
  }

  /**
   * Test hook: Configure mock provider to simulate error conditions
   */
  setSimulatedError(errorType: 'none' | 'ratelimit' | 'timeout' | 'servererror') {
    this.simulatedError = errorType
  }

  /**
   * Test hook: Provide custom response for a specific task
   */
  setMockResponse(task: string, response: any) {
    this.customResponses.set(task, response)
  }

  /**
   * Clear test hooks
   */
  reset() {
    this.simulatedError = 'none'
    this.customResponses.clear()
  }

  async generate(request: NormalizedAIRequest, model = 'mock-model-v1'): Promise<NormalizedAIResponse> {
    this.checkSimulatedErrors(model)

    const startTime = Date.now()
    const requestId = this.generateRequestId()
    const content = this.getMockContent(request)

    return {
      content,
      provider: this.id,
      model,
      latencyMs: Date.now() - startTime + 5,
      requestId,
      finishReason: 'stop',
      usage: {
        promptTokens: 42,
        completionTokens: 88,
        totalTokens: 130,
      },
    }
  }

  async generateStructured<T = any>(
    request: NormalizedAIRequest,
    model = 'mock-model-v1',
  ): Promise<NormalizedAIResponse<T>> {
    this.checkSimulatedErrors(model)

    const startTime = Date.now()
    const requestId = this.generateRequestId()

    let structuredData: T
    if (this.customResponses.has(request.task)) {
      structuredData = this.customResponses.get(request.task)
    } else {
      structuredData = this.getMockStructuredData(request)
    }

    const content = JSON.stringify(structuredData, null, 2)

    return {
      content,
      structuredData,
      provider: this.id,
      model,
      latencyMs: Date.now() - startTime + 5,
      requestId,
      finishReason: 'stop',
      usage: {
        promptTokens: 50,
        completionTokens: 120,
        totalTokens: 170,
      },
    }
  }

  private checkSimulatedErrors(model: string) {
    if (this.simulatedError === 'ratelimit') {
      throw new RateLimitError(this.id, model, 1000)
    }
    if (this.simulatedError === 'timeout') {
      throw new TimeoutError(this.id, model, 5000)
    }
    if (this.simulatedError === 'servererror') {
      throw new RetryableProviderError('Simulated internal server error (500)', this.id, model, 500)
    }
  }

  private getMockContent(request: NormalizedAIRequest): string {
    const task = request.task
    if (task === 'playwright_test_generation') {
      return `import { test, expect } from '@playwright/test';

test.describe('Mock Bug Reproduction', () => {
  test('should reproduce flow', async ({ page }) => {
    await page.goto('https://app.example.com');
    await page.locator('button').first().click();
    await expect(page.locator('body')).toBeVisible();
  });
});`
    }
    return `Mock AI response for task [${task}] with prompt: "${(request.prompt || '').slice(0, 50)}"`
  }

  private getMockStructuredData(request: NormalizedAIRequest): any {
    const task = request.task

    switch (task) {
      case 'rca_generation':
        return {
          summary: 'Component failed due to unhandled promise rejection in network hydration layer.',
          probableComponent: 'CheckoutButton',
          suggestedPatch: `// Safe error handling patch\n- const { data } = await api.fetch('/checkout');\n+ try {\n+   const { data } = await api.fetch('/checkout');\n+ } catch (err) {\n+   console.error(err);\n+ }`,
          reproductionSteps: [
            '1. Navigate to target URL',
            '2. Click checkout button',
            '3. Observe 500 network failure',
          ],
          severityAssessment: 'High',
          confidenceScore: 0.94,
          cursorPrompt: 'Fix network error handling in CheckoutButton component',
        }

      case 'smart_autofill':
        return {
          title: 'Save button remains disabled after entering valid form values',
          description: '### Summary\nUser unable to save form.\n\n### Steps\n1. Fill email\n2. Click save',
          severity: 'Medium',
          expectedResult: 'Button should be enabled',
          actualResult: 'Button stays disabled',
          labels: ['ui-bug', 'form', 'button'],
          domSummary: 'Page: "Profile" | Target: <button> "Save"',
          confidenceScore: 0.95,
        }

      case 'visual_anomaly_analysis':
        return {
          anomalies: [
            {
              id: 'mock-clip-1',
              type: 'layout_clipping',
              severity: 'High',
              title: 'Horizontal Layout Content Clipping',
              description: 'Content width overflows container with overflow: hidden',
              boundingBox: { x: 50, y: 100, width: 200, height: 40 },
              cssPropertyTrigger: 'overflow: hidden',
              suggestedFix: 'overflow-x: auto;\nwhite-space: normal;',
              confidenceScore: 0.95,
            },
          ],
          totalIssues: 1,
          healthScore: 75,
          summary: 'Detected 1 visual anomaly in target component.',
        }

      case 'meeting_summary':
        return {
          summary: 'Team reviewed sprint goals and approved AI architecture plan.',
          decisions: ['Approved provider-agnostic AI roadmap', 'Default development provider set to Gemini/Mock'],
          action_items: [
            { task: 'Implement provider adapters', owner: 'Engineer', deadline: 'Today' },
          ],
          open_questions: [],
        }

      case 'duplicate_detection':
        return {
          matches: [],
          topSimilarityScore: 0.0,
          hasDuplicate: false,
        }

      case 'classification':
        return {
          category: 'UI / Frontend',
          severity: 'Medium',
          tags: ['bug', 'ui'],
        }

      case 'extraction':
        return {
          entities: [{ key: 'name', value: 'BugPilot' }],
        }

      default:
        return {
          status: 'success',
          task,
          data: 'mock_payload',
        }
    }
  }
}
