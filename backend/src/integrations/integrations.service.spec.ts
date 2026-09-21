import { Test, TestingModule } from '@nestjs/testing'
import { IntegrationsService } from './integrations.service'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { IssuesService } from '../issues/issues.service'
import { EncryptionService } from './encryption.service'

describe('IntegrationsService', () => {
  let service: IntegrationsService

  const mockSupabase = {
    db: {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: {}, error: null }),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'int-1',
          workspace_id: 'ws-1',
          provider: 'jira',
          pat_encrypted: 'mock-encrypted-key',
          config: {
            host: 'https://test.atlassian.net',
            email: 'dev@test.com',
            project_key: 'BUG',
            issue_type: 'Bug',
          },
        },
        error: null,
      }),
    },
  }

  const mockWorkspaces = {
    findByOwner: jest.fn().mockResolvedValue({ id: 'ws-1', name: 'Test Workspace' }),
  }

  const mockIssues = {
    findOne: jest.fn().mockResolvedValue({
      id: 'issue-1',
      title: 'Checkout crash',
      description: 'TypeError on submit',
      url: 'https://app.com/checkout',
      severity: 'critical',
      triage_status: 'Incoming',
    }),
    updateSyncStatus: jest.fn().mockResolvedValue(true),
  }

  const mockEncryption = {
    encrypt: jest.fn().mockReturnValue('mock-encrypted-key'),
    decrypt: jest.fn().mockReturnValue('mock-decrypted-key'),
  }

  beforeEach(async () => {
    // Mock global fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: jest.fn().mockResolvedValue({
        id: '10001',
        key: 'BUG-42',
        data: { issueCreate: { success: true, issue: { id: 'lin-1', identifier: 'ENG-101', url: 'https://linear.app/issue/ENG-101' } } },
      }),
      text: jest.fn().mockResolvedValue(JSON.stringify({ id: '10001', key: 'BUG-42' })),
    }) as any

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: WorkspacesService, useValue: mockWorkspaces },
        { provide: IssuesService, useValue: mockIssues },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile()

    service = module.get<IntegrationsService>(IntegrationsService)
  })

  it('should test and upsert Jira integration', async () => {
    const res = await service.upsertJira('user-1', {
      host: 'https://test.atlassian.net',
      email: 'dev@test.com',
      apiToken: 'secret-token',
      projectKey: 'BUG',
    })

    expect(res.id).toBe('int-1')
    expect(res.config.project_key).toBe('BUG')
  })

  it('should sync issue to Jira Cloud', async () => {
    const res = await service.syncToJira('user-1', 'issue-1')
    expect(res.externalId).toBe('BUG-42')
    expect(res.externalUrl).toContain('https://test.atlassian.net/browse/BUG-42')
    expect(mockIssues.updateSyncStatus).toHaveBeenCalledWith('issue-1', 'synced', 'BUG-42', expect.any(String))
  })

  it('should dispatch outbound Slack webhook notification', async () => {
    mockSupabase.db.in.mockReturnValueOnce({
      data: [{ provider: 'slack', config: { webhook_url: 'https://hooks.slack.com/services/123' } }],
    })

    await service.dispatchWebhookNotification('ws-1', {
      title: 'Checkout button broken',
      severity: 'critical',
      url: 'https://app.com/checkout',
    }, 'created')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/123',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
