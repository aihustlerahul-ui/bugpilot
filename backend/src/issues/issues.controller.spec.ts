import { Test } from '@nestjs/testing';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

describe('IssuesController', () => {
  let controller: IssuesController;
  let service: {
    getDashboardMetrics: jest.Mock;
    updateStatus: jest.Mock;
  };

  const mockUser: AuthUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  beforeEach(async () => {
    service = {
      getDashboardMetrics: jest.fn(),
      updateStatus: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [IssuesController],
      providers: [
        { provide: IssuesService, useValue: service },
        { provide: SupabaseService, useValue: {} },
        { provide: ApiKeysService, useValue: {} },
        { provide: AccessService, useValue: {} },
      ],
    }).compile();

    controller = module.get<IssuesController>(IssuesController);
  });

  it('delegates getDashboardMetrics to IssuesService', async () => {
    const expected = {
      total: 10,
      open: 5,
      critical: 2,
      resolved: 3,
      trend: [],
      recentIssues: [],
    };
    service.getDashboardMetrics.mockResolvedValue(expected);

    const result = await controller.getDashboardMetrics(mockUser);
    expect(result).toBe(expected);
    expect(service.getDashboardMetrics).toHaveBeenCalledWith(mockUser);
  });

  it('delegates updateStatus to IssuesService', async () => {
    const expected = { id: 'issue-1', status: 'In Dev' };
    service.updateStatus.mockResolvedValue(expected);

    const result = await controller.updateStatus(mockUser, 'issue-1', { status: 'In Dev' });
    expect(result).toBe(expected);
    expect(service.updateStatus).toHaveBeenCalledWith(mockUser, 'issue-1', 'In Dev');
  });
});
