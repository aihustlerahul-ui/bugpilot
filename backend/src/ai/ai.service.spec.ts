import { Test, TestingModule } from '@nestjs/testing'
import { AiService } from './ai.service'
import { SupabaseService } from '../supabase/supabase.service'

describe('AiService', () => {
  let service: AiService

  const mockSupabase = {
    db: {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'issue-101',
            title: 'Cart checkout button throws error',
            description: 'Clicking submit triggers 500 error',
            url: 'https://shop.example.com/checkout',
            severity: 'critical',
            triage_status: 'In Dev',
            element_info: { cssSelector: 'button#checkout-btn' },
            metadata: {
              consoleErrors: [{ message: 'Uncaught TypeError: Cannot read properties of undefined (reading items)' }],
              networkTransactions: [{ url: '/api/v1/checkout', status: 500 }],
            },
          },
        ],
      }),
    },
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile()

    service = module.get<AiService>(AiService)
  })

  it('should generate RCA with network error diagnostics', async () => {
    const result = await service.generateRca({
      title: 'Checkout button fails',
      url: 'https://shop.example.com/checkout',
      elementInfo: {
        reactComponentName: 'CheckoutButton',
        reactSource: { fileName: 'src/components/CheckoutButton.tsx', lineNumber: 42 },
        cssSelector: 'button#checkout-btn',
      },
      networkErrors: [{ method: 'POST', url: '/api/v1/checkout', status: 500 }],
    })

    expect(result.summary).toContain('CheckoutButton')
    expect(result.summary).toContain('500')
    expect(result.suggestedPatch).toContain('try {')
    expect(result.cursorPrompt).toContain('You are debugging a verified bug in BugPilot')
    expect(result.confidenceScore).toBeGreaterThan(0.8)
  })

  it('should generate RCA with console error diagnostics', async () => {
    const result = await service.generateRca({
      title: 'Navigation crashes',
      url: 'https://shop.example.com/nav',
      elementInfo: {
        reactComponentName: 'Navbar',
        cssSelector: 'nav.top-bar',
      },
      consoleErrors: [{ level: 'error', message: 'TypeError: undefined is not an object' }],
    })

    expect(result.summary).toContain('Navbar')
    expect(result.summary).toContain('TypeError')
    expect(result.reproductionSteps.length).toBeGreaterThanOrEqual(3)
  })

  it('should generate Playwright test spec from breadcrumb sequence', async () => {
    const result = await service.generatePlaywrightTest({
      title: 'Login validation flow',
      url: 'https://app.example.com/login',
      breadcrumbs: [
        { type: 'input', category: 'ui.input', message: 'Input email', timestamp: 100, data: { selector: 'input#email', value: 'user@test.com' } },
        { type: 'click', category: 'ui.click', message: 'Click submit', timestamp: 200, data: { selector: 'button[type="submit"]' } },
      ],
      elementInfo: { cssSelector: 'div.alert-error' },
    })

    expect(result.filename).toBe('login-validation-flow.spec.ts')
    expect(result.testScript).toContain("import { test, expect } from '@playwright/test';")
    expect(result.testScript).toContain("await page.goto('https://app.example.com/login');")
    expect(result.testScript).toContain("await page.locator('input#email').fill('user@test.com');")
    expect(result.testScript).toContain("await page.locator('button[type=\"submit\"]').first().click();")
    expect(result.testScript).toContain("await expect(target).toBeVisible();")
  })

  it('should detect duplicate issues using compound fingerprinting', async () => {
    const duplicates = await service.detectDuplicates({
      projectId: 'proj-1',
      title: 'Cart checkout button throws error',
      description: 'Clicking submit triggers 500 error',
      url: 'https://shop.example.com/checkout',
      elementInfo: { cssSelector: 'button#checkout-btn' },
      consoleErrors: [{ message: 'Uncaught TypeError: Cannot read properties of undefined (reading items)' }],
      networkErrors: [{ url: '/api/v1/checkout', status: 500 }],
    })

    expect(duplicates.length).toBeGreaterThan(0)
    expect(duplicates[0].issueId).toBe('issue-101')
    expect(duplicates[0].fingerprintMatch).toBe(true)
    expect(duplicates[0].similarityScore).toBeGreaterThanOrEqual(0.9)
  })

  it('B2: should generate smart autofill bug report from single-input prompt & 50-token DOM context', async () => {
    const result = await service.generateSmartAutofill({
      userInput: 'Save button stays disabled after entering valid email',
      url: 'https://app.example.com/settings/profile',
      route: '/settings/profile',
      elementInfo: {
        reactComponentName: 'ProfileSaveButton',
        tag: 'button',
      },
      domContext: {
        page: { title: 'User Profile Settings', path: '/settings/profile' },
        container: { tag: 'form', role: 'form', label: 'Edit Profile' },
        heading: 'Profile Information',
        siblings: [
          { tag: 'input', role: null, name: 'Email', value: 'user@test.com' },
          { tag: 'input', role: null, name: 'Full Name', value: 'John Doe' },
        ],
        target: { tag: 'button', role: 'button', name: 'Save Changes', value: null, action: 'click' },
      },
    })

    expect(result.title).toContain('ProfileSaveButton')
    expect(result.title).toContain('Save button stays disabled')
    expect(result.description).toContain('### 📝 Summary')
    expect(result.description).toContain('### 🔄 Steps to Reproduce')
    expect(result.description).toContain('### ✅ Expected Behavior')
    expect(result.description).toContain('### ❌ Actual Behavior')
    expect(result.domSummary).toContain('Page: "User Profile Settings"')
    expect(result.labels).toContain('profilesavebutton')
    expect(result.labels).toContain('button')
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9)
  })

  it('B8: should analyze visual anomalies including layout clipping and contrast violations', async () => {
    const report = await service.analyzeVisualAnomalies({
      elementInfo: {
        tag: 'button',
        text: 'Proceed to Checkout and Finalize Order Details Now',
        dimensions: {
          x: 100,
          y: 200,
          width: 200,
          height: 36,
          top: 200,
          right: 300,
          bottom: 236,
          left: 100,
          scrollWidth: 320,
          clientWidth: 200,
          scrollHeight: 36,
          clientHeight: 36,
        },
        computedStyles: {
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'clip',
          color: '#94a3b8',
          backgroundColor: '#f8fafc',
          fontSize: '13px',
        },
      },
      parentInfo: {
        dimensions: { width: 250, height: 400 },
      },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    })

    expect(report.anomalies.length).toBeGreaterThanOrEqual(2)
    const clippingAnomaly = report.anomalies.find((a) => a.type === 'layout_clipping')
    expect(clippingAnomaly).toBeDefined()
    expect(clippingAnomaly?.title).toContain('Layout Clipping')
    expect(clippingAnomaly?.suggestedFix).toContain('overflow-x')

    const contrastAnomaly = report.anomalies.find((a) => a.type === 'contrast_violation')
    expect(contrastAnomaly).toBeDefined()
    expect(contrastAnomaly?.title).toContain('Low Text Contrast')
    expect(report.healthScore).toBeLessThan(100)
  })
})
