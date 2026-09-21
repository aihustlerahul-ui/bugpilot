import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { SourceMapService } from './source-map.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('IssuesService - getDashboardMetrics Empirical Edge Cases', () => {
  let mockWorkspacesService: { findByOwner: jest.Mock };
  let mockSupabase: any;
  let service: IssuesService;

  beforeEach(async () => {
    mockWorkspacesService = {
      findByOwner: jest.fn(),
    };
    mockSupabase = {
      db: {
        from: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        IssuesService,
        { provide: SupabaseService, useValue: mockSupabase },
        {
          provide: SourceMapService,
          useValue: { resolveLocation: jest.fn(), resolveStackTrace: jest.fn() },
        },
        { provide: WorkspacesService, useValue: mockWorkspacesService },
      ],
    }).compile();

    service = module.get(IssuesService);
  });

  describe('Edge Case 1: Empty Workspace', () => {
    it('returns zeroes when findByOwner throws NotFoundException', async () => {
      mockWorkspacesService.findByOwner.mockRejectedValue(new NotFoundException('No workspace'));

      const result = await service.getDashboardMetrics('user-no-ws');
      expect(result).toEqual({
        total: 0,
        open: 0,
        critical: 0,
        resolved: 0,
        trend: [],
        recentIssues: [],
      });
    });

    it('returns zeroes when findByOwner returns null', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue(null);

      const result = await service.getDashboardMetrics('user-null-ws');
      expect(result).toEqual({
        total: 0,
        open: 0,
        critical: 0,
        resolved: 0,
        trend: [],
        recentIssues: [],
      });
    });

    it('returns zeroes when workspace exists but has no projects (empty array)', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-empty' });
      mockSupabase.db.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await service.getDashboardMetrics('user-empty-proj');
      expect(result).toEqual({
        total: 0,
        open: 0,
        critical: 0,
        resolved: 0,
        trend: [],
        recentIssues: [],
      });
    });

    it('returns zeroes when projects query returns null data', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-empty' });
      mockSupabase.db.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });

      const result = await service.getDashboardMetrics('user-null-proj');
      expect(result).toEqual({
        total: 0,
        open: 0,
        critical: 0,
        resolved: 0,
        trend: [],
        recentIssues: [],
      });
    });
  });

  describe('Edge Case 2: Projects without issues', () => {
    it('handles projects with empty issues array cleanly', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });
      mockSupabase.db.from.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [
                  { id: 'p-1', name: 'Alpha' },
                  { id: 'p-2', name: 'Beta' },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'issues') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await service.getDashboardMetrics('user-1');
      expect(result.total).toBe(0);
      expect(result.open).toBe(0);
      expect(result.critical).toBe(0);
      expect(result.resolved).toBe(0);
      expect(result.recentIssues).toEqual([]);
      expect(result.trend).toHaveLength(7);
      result.trend.forEach((t) => {
        expect(t.count).toBe(0);
        expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('handles issues returning null cleanly without crashing', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });
      mockSupabase.db.from.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ id: 'p-1', name: 'Alpha' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'issues') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await service.getDashboardMetrics('user-1');
      expect(result.total).toBe(0);
      expect(result.open).toBe(0);
      expect(result.critical).toBe(0);
      expect(result.resolved).toBe(0);
      expect(result.recentIssues).toEqual([]);
      expect(result.trend).toHaveLength(7);
    });
  });

  describe('Edge Case 3: Null, undefined, or atypical severity and status', () => {
    it('handles issues with null/undefined severity and status without runtime exceptions', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });
      const issues = [
        { id: 'i-1', project_id: 'p-1', status: null, severity: null, created_at: new Date().toISOString() },
        { id: 'i-2', project_id: 'p-1', status: undefined, severity: undefined, created_at: new Date().toISOString() },
        { id: 'i-3', project_id: 'p-1', status: 'In Dev', severity: null, created_at: new Date().toISOString() },
        { id: 'i-4', project_id: 'p-1', status: 'Resolved', severity: 'Critical', created_at: new Date().toISOString() },
        { id: 'i-5', project_id: 'p-1', status: 'Incoming', severity: 'critical', created_at: new Date().toISOString() },
      ];

      mockSupabase.db.from.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ id: 'p-1', name: 'Alpha' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'issues') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: issues, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await service.getDashboardMetrics('user-1');
      expect(result.total).toBe(5);
      // Status null and undefined default to 'Incoming' (which is in openStatuses)
      // i-1 (Incoming), i-2 (Incoming), i-3 (In Dev), i-5 (Incoming) -> 4 open
      expect(result.open).toBe(4);
      // Resolved issues: i-4 -> 1 resolved
      expect(result.resolved).toBe(1);
      // Critical count: i-4 is Critical but status is Resolved (so not counted).
      // i-5 is critical and status is Incoming (counted).
      // i-1, i-2, i-3 have null/undefined severity (not counted).
      expect(result.critical).toBe(1);
    });
  });

  describe('Edge Case 4: Dates across month and year boundaries', () => {
    it('accurately groups 7-day sparkline across February to March month boundary (leap year)', async () => {
      // Pin Date.now to 2024-03-02T12:00:00Z (2024 is leap year, Feb has 29 days)
      const fakeNow = new Date('2024-03-02T12:00:00.000Z').getTime();
      const realDateNow = Date.now;
      Date.now = jest.fn(() => fakeNow);

      try {
        mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });

        // Expected 7 days back from 2024-03-02:
        // i=0 (6 days ago): 2024-02-25
        // i=1 (5 days ago): 2024-02-26
        // i=2 (4 days ago): 2024-02-27
        // i=3 (3 days ago): 2024-02-28
        // i=4 (2 days ago): 2024-02-29 (leap day!)
        // i=5 (1 day ago):  2024-03-01
        // i=6 (0 days ago): 2024-03-02
        const issues = [
          { id: '1', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-02-28T23:59:59.000Z' },
          { id: '2', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-02-29T00:00:01.000Z' },
          { id: '3', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-02-29T18:30:00.000Z' },
          { id: '4', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-03-01T08:00:00.000Z' },
          { id: '5', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-03-02T11:59:59.000Z' },
          { id: '6', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2024-02-20T00:00:00.000Z' }, // older than 7d
        ];

        mockSupabase.db.from.mockImplementation((table: string) => {
          if (table === 'projects') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [{ id: 'p-1', name: 'Alpha' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'issues') {
            return {
              select: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  order: jest.fn().mockResolvedValue({ data: issues, error: null }),
                }),
              }),
            };
          }
          return {};
        });

        const result = await service.getDashboardMetrics('user-1');
        expect(result.trend).toHaveLength(7);

        const expectedDates = [
          '2024-02-25',
          '2024-02-26',
          '2024-02-27',
          '2024-02-28',
          '2024-02-29',
          '2024-03-01',
          '2024-03-02',
        ];

        const trendDates = result.trend.map((t) => t.date);
        expect(trendDates).toEqual(expectedDates);

        expect(result.trend.find((t) => t.date === '2024-02-28')?.count).toBe(1);
        expect(result.trend.find((t) => t.date === '2024-02-29')?.count).toBe(2);
        expect(result.trend.find((t) => t.date === '2024-03-01')?.count).toBe(1);
        expect(result.trend.find((t) => t.date === '2024-03-02')?.count).toBe(1);
      } finally {
        Date.now = realDateNow;
      }
    });

    it('accurately groups 7-day sparkline across December to January year boundary', async () => {
      // Pin Date.now to 2027-01-02T10:00:00Z
      const fakeNow = new Date('2027-01-02T10:00:00.000Z').getTime();
      const realDateNow = Date.now;
      Date.now = jest.fn(() => fakeNow);

      try {
        mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });

        const issues = [
          { id: '1', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2026-12-31T23:59:00.000Z' },
          { id: '2', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: '2027-01-01T00:01:00.000Z' },
        ];

        mockSupabase.db.from.mockImplementation((table: string) => {
          if (table === 'projects') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [{ id: 'p-1', name: 'Alpha' }],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'issues') {
            return {
              select: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  order: jest.fn().mockResolvedValue({ data: issues, error: null }),
                }),
              }),
            };
          }
          return {};
        });

        const result = await service.getDashboardMetrics('user-1');
        const expectedDates = [
          '2026-12-27',
          '2026-12-28',
          '2026-12-29',
          '2026-12-30',
          '2026-12-31',
          '2027-01-01',
          '2027-01-02',
        ];

        expect(result.trend.map((t) => t.date)).toEqual(expectedDates);
        expect(result.trend.find((t) => t.date === '2026-12-31')?.count).toBe(1);
        expect(result.trend.find((t) => t.date === '2027-01-01')?.count).toBe(1);
      } finally {
        Date.now = realDateNow;
      }
    });

    it('safely handles issues with missing or invalid created_at date strings', async () => {
      mockWorkspacesService.findByOwner.mockResolvedValue({ id: 'ws-1' });

      const issues = [
        { id: '1', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: null },
        { id: '2', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: undefined },
        { id: '3', project_id: 'p-1', status: 'Incoming', severity: 'Low', created_at: 'not-a-date' },
      ];

      mockSupabase.db.from.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ id: 'p-1', name: 'Alpha' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'issues') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: issues, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await service.getDashboardMetrics('user-1');
      expect(result.total).toBe(3);
      expect(result.open).toBe(3);
      // All 7 trend days should count 0 without throwing error
      result.trend.forEach((t) => expect(t.count).toBe(0));
    });
  });
});
