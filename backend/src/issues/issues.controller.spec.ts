import { Test } from '@nestjs/testing';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CommentsService } from './comments.service';
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

  const comments = { list: jest.fn(), add: jest.fn() };

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
        { provide: CommentsService, useValue: comments },
      ],
    }).compile();

    controller = module.get<IssuesController>(IssuesController);
  });

  it('addComment uses source mcp for api_key auth, web otherwise', async () => {
    await controller.addComment({ ...mockUser, authMethod: 'api_key' }, 'i1', { body: 'x' });
    expect(comments.add).toHaveBeenLastCalledWith(expect.anything(), 'i1', 'x', 'mcp');
    await controller.addComment(mockUser, 'i1', { body: 'y' });
    expect(comments.add).toHaveBeenLastCalledWith(mockUser, 'i1', 'y', 'web');
    await controller.addComment({ ...mockUser, authMethod: 'jwt' }, 'i1', { body: 'z' });
    expect(comments.add).toHaveBeenLastCalledWith(expect.anything(), 'i1', 'z', 'web');
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
