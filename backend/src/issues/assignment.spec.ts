import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { AccessService } from '../access/access.service';

type Row = Record<string, any>;

const WM_JANE = '11111111-1111-4111-8111-111111111111';
const WM_BOB = '22222222-2222-4222-8222-222222222222';
const WM_OTHER = '33333333-3333-4333-8333-333333333333';

function build(opts: { users?: Record<string, any>; members?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    projects: [
      { id: 'p1', workspace_id: 'ws-1', name: 'Alpha' },
      { id: 'p2', workspace_id: 'ws-2', name: 'Beta' },
    ],
    workspace_members: opts.members ?? [
      { id: WM_JANE, workspace_id: 'ws-1', name: 'Jane Dev', email: 'Jane@Team.com', role: 'x' },
      { id: WM_BOB, workspace_id: 'ws-1', name: 'Bob QA', email: 'bob@team.com', role: 'x' },
      { id: WM_OTHER, workspace_id: 'ws-2', name: 'Eve Else', email: 'eve@else.com', role: 'x' },
    ],
    project_members: [],
    issues: [
      {
        id: 'i1',
        project_id: 'p1',
        reporter_id: 'rep-1',
        assignee_member_id: null,
        metadata: { assignee: 'old free text', keep: 'me' },
      },
    ],
  };
  const updated: Array<{ table: string; patch: Row }> = [];
  const db: any = {
    from(table: string) {
      let rows = [...tables[table]];
      let pending: Row | null = null;
      const b: any = {
        select: () => b,
        update: (patch: Row) => ((pending = patch), b),
        eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        single: () => {
          if (!rows[0]) return Promise.resolve({ data: null, error: { message: 'no rows' } });
          if (pending) {
            updated.push({ table, patch: pending });
            Object.assign(rows[0], pending);
          }
          return Promise.resolve({ data: { ...rows[0] }, error: null });
        },
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return b;
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
    auth: {
      admin: {
        getUserById: jest.fn(async (id: string) => {
          const u = (opts.users ?? { 'rep-1': { email: 'JANE@team.com', user_metadata: { full_name: 'Jane R' } } })[id];
          return u ? { data: { user: { id, ...u } }, error: null } : { data: { user: null }, error: { message: 'nf' } };
        }),
      },
    },
  };
  const supabase: any = { db };
  const access = {
    getProjectRole: jest.fn(async (user: any, projectId: string) =>
      user.id === 'dev-1' && projectId === 'p1' ? 'member' : user.id === 'owner-1' ? 'owner' : null,
    ),
    assertCanAccessProject: jest.fn(async (user: any, projectId: string) => {
      if (user.id !== 'owner-1' && !(user.id === 'dev-1' && projectId === 'p1')) {
        throw new NotFoundException('Project not found');
      }
    }),
  } as unknown as AccessService;
  const service = new IssuesService(supabase, {} as any, {} as any, access);
  return { service, tables, updated, db };
}

const DEV = { id: 'dev-1', email: 'dev@team.com' };
const OWNER = { id: 'owner-1', email: 'o@team.com' };
const STRANGER = { id: 'x-1', email: 'x@else.com' };

describe('issue assignment', () => {
  it('assign sets assignee_member_id and mirrors name into metadata.assignee', async () => {
    const { service, updated } = build();
    const res = await service.assign(DEV, 'i1', WM_JANE);
    expect(updated[0].patch).toEqual({
      assignee_member_id: WM_JANE,
      metadata: { assignee: 'Jane Dev', keep: 'me' },
    });
    expect(res.assignee_member_id).toBe(WM_JANE);
  });

  it('assign null clears both', async () => {
    const { service, updated } = build();
    await service.assign(OWNER, 'i1', null);
    expect(updated[0].patch).toEqual({
      assignee_member_id: null,
      metadata: { assignee: null, keep: 'me' },
    });
  });

  it('assign rejects a member from another workspace', async () => {
    const { service, updated } = build();
    await expect(service.assign(DEV, 'i1', WM_OTHER)).rejects.toThrow(BadRequestException);
    expect(updated).toHaveLength(0);
  });

  it('assign 404s for a user without project access', async () => {
    const { service, updated } = build();
    await expect(service.assign(STRANGER, 'i1', WM_JANE)).rejects.toThrow(NotFoundException);
    expect(updated).toHaveLength(0);
  });

  it('reporter.memberId resolves by email case-insensitively', async () => {
    const { service } = build();
    const issue: any = await service.findOne(DEV, 'i1');
    expect(issue.reporter).toEqual({
      userId: 'rep-1',
      email: 'JANE@team.com',
      name: 'Jane R',
      memberId: WM_JANE,
    });
  });

  it('reporter.memberId is null with no workspace_members row, and assign error lists assignable members', async () => {
    const { service } = build({ members: [
      { id: WM_BOB, workspace_id: 'ws-1', name: 'Bob QA', email: 'bob@team.com' },
      { id: WM_OTHER, workspace_id: 'ws-2', name: 'Eve Else', email: 'eve@else.com' },
    ] });
    const issue: any = await service.findOne(DEV, 'i1');
    expect(issue.reporter.memberId).toBeNull();
    expect(issue.reporter.email).toBe('JANE@team.com');
    await expect(service.assign(DEV, 'i1', WM_JANE)).rejects.toThrow(/Bob QA/);
    await expect(service.assign(DEV, 'i1', WM_JANE)).rejects.not.toThrow(/Eve Else/);
  });

  it('reporter email is null when the account lookup fails', async () => {
    const { service } = build({ users: {} });
    const issue: any = await service.findOne(DEV, 'i1');
    expect(issue.reporter).toEqual({ userId: 'rep-1', email: null, name: null, memberId: null });
  });

  it('listAssignableMembers returns id/name/email only and requires project access', async () => {
    const { service } = build();
    const list = await service.listAssignableMembers(DEV, 'p1');
    expect(list).toEqual([
      { id: WM_JANE, name: 'Jane Dev', email: 'Jane@Team.com' },
      { id: WM_BOB, name: 'Bob QA', email: 'bob@team.com' },
    ]);
    await expect(service.listAssignableMembers(STRANGER, 'p1')).rejects.toThrow(NotFoundException);
    await expect(service.listAssignableMembers(DEV, 'p2')).rejects.toThrow(NotFoundException);
  });
});
