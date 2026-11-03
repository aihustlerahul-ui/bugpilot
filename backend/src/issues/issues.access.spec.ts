import { NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { AccessService } from '../access/access.service';

type Row = Record<string, any>;

// Minimal in-memory supabase fake supporting select/eq/in/ilike/order/single/maybeSingle/insert.
function makeDb(tables: Record<string, Row[]>) {
  const inserted: Row[] = [];
  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let pendingInsert: Row | null = null;
      const b: any = {
        select: () => b,
        order: () => b,
        eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
        in: (k: string, v: any[]) => ((rows = rows.filter((r) => v.includes(r[k]))), b),
        ilike: (k: string, v: string) => (
          (rows = rows.filter((r) => String(r[k]).toLowerCase() === v.toLowerCase())), b
        ),
        insert: (row: Row) => {
          pendingInsert = { id: 'new-issue', ...row };
          inserted.push(pendingInsert);
          return b;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        single: () =>
          Promise.resolve(
            pendingInsert
              ? { data: pendingInsert, error: null }
              : rows[0]
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'no rows' } },
          ),
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return b;
    },
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: null }), upload: async () => ({ error: null }) }),
    },
  };
  return { db, inserted };
}

const OWNER = { id: 'owner-1', email: 'owner@team.com' };
const MEMBER = { id: 'member-1', email: 'Jane@Team.com' };
const STRANGER = { id: 'x-1', email: 'x@else.com' };

function build() {
  const tables = {
    projects: [
      { id: 'p1', workspace_id: 'ws-1', name: 'Alpha', created_at: '2026-01-02' },
      { id: 'p2', workspace_id: 'ws-1', name: 'Beta', created_at: '2026-01-01' },
    ],
    workspace_members: [{ id: 'wm-1', email: 'jane@team.com' }],
    project_members: [{ project_id: 'p1', member_id: 'wm-1' }],
    issues: [
      { id: 'i1', project_id: 'p1', reporter_id: 'member-1', status: 'Incoming', severity: 'Low', created_at: '2026-01-03' },
      { id: 'i2', project_id: 'p2', reporter_id: 'owner-1', status: 'Resolved', severity: 'Low', created_at: '2026-01-04' },
    ],
  };
  const { db, inserted } = makeDb(tables);
  const supabase: any = { db };
  const workspaces: any = {
    findByOwner: jest.fn(async (userId: string) => {
      if (userId === 'owner-1') return { id: 'ws-1' };
      throw new NotFoundException('Workspace not found');
    }),
  };
  const access = new AccessService(supabase, workspaces);
  const service = new IssuesService(supabase, {} as any, workspaces, access);
  return { service, inserted };
}

describe('IssuesService project access', () => {
  const dto: any = { project_id: 'p1', description: 'broken button' };

  describe('create', () => {
    it('rejects an unrelated user and inserts nothing', async () => {
      const { service, inserted } = build();
      await expect(service.create(STRANGER, dto)).rejects.toThrow(NotFoundException);
      expect(inserted).toHaveLength(0);
    });

    it('rejects a member for a project they were not added to', async () => {
      const { service, inserted } = build();
      await expect(service.create(MEMBER, { ...dto, project_id: 'p2' })).rejects.toThrow(NotFoundException);
      expect(inserted).toHaveLength(0);
    });

    it('lets a member file into a shared project with reporter_id = user.id', async () => {
      const { service, inserted } = build();
      await service.create(MEMBER, dto);
      expect(inserted).toHaveLength(1);
      expect(inserted[0].reporter_id).toBe('member-1');
      expect(inserted[0].project_id).toBe('p1');
    });

    it('lets the owner file into their project', async () => {
      const { service, inserted } = build();
      await service.create(OWNER, { ...dto, project_id: 'p2' });
      expect(inserted[0].reporter_id).toBe('owner-1');
    });
  });

  describe('findByProject', () => {
    it('throws for an unshared project', async () => {
      const { service } = build();
      await expect(service.findByProject(MEMBER, 'p2')).rejects.toThrow(NotFoundException);
      await expect(service.findByProject(STRANGER, 'p1')).rejects.toThrow(NotFoundException);
    });

    it('returns issues for owner and for a member of the project', async () => {
      const { service } = build();
      expect(await service.findByProject(OWNER, 'p1')).toHaveLength(1);
      expect(await service.findByProject(MEMBER, 'p1')).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('shows a member-filed issue to the project owner', async () => {
      const { service } = build();
      const issue = await service.findOne(OWNER, 'i1');
      expect(issue.id).toBe('i1');
    });

    it('returns the issue to its reporter (member)', async () => {
      const { service } = build();
      expect((await service.findOne(MEMBER, 'i1')).id).toBe('i1');
    });

    it('hides issues in an unrelated project', async () => {
      const { service } = build();
      await expect(service.findOne(MEMBER, 'i2')).rejects.toThrow(NotFoundException);
      await expect(service.findOne(STRANGER, 'i1')).rejects.toThrow(NotFoundException);
    });

    it('throws for a missing issue', async () => {
      const { service } = build();
      await expect(service.findOne(OWNER, 'nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDashboardMetrics', () => {
    it('member with no workspace gets metrics for shared projects only', async () => {
      const { service } = build();
      const res = await service.getDashboardMetrics(MEMBER);
      expect(res.total).toBe(1);
      expect(res.open).toBe(1);
      expect(res.recentIssues[0].id).toBe('i1');
      expect(res.recentIssues[0].projectName).toBe('Alpha');
    });

    it('owner sees all workspace projects', async () => {
      const { service } = build();
      expect((await service.getDashboardMetrics(OWNER)).total).toBe(2);
    });

    it('stranger gets the empty default', async () => {
      const { service } = build();
      expect((await service.getDashboardMetrics(STRANGER)).total).toBe(0);
    });
  });
});
