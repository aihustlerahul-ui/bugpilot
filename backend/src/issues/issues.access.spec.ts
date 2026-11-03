import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { AccessService } from '../access/access.service';

type Row = Record<string, any>;

// Minimal in-memory supabase fake supporting select/eq/in/ilike/order/single/maybeSingle/insert.
function makeDb(tables: Record<string, Row[]>) {
  const inserted: Row[] = [];
  const updated: Array<{ table: string; patch: Row; ids: string[] }> = [];
  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let pendingInsert: Row | null = null;
      let pendingUpdate: Row | null = null;
      const b: any = {
        update: (patch: Row) => ((pendingUpdate = patch), b),
        select: () => b,
        order: () => b,
        lt: (k: string, v: any) => ((rows = rows.filter((r) => String(r[k]) < String(v))), b),
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
        single: () => {
          if (pendingUpdate) {
            const target = rows[0];
            if (!target) return Promise.resolve({ data: null, error: { message: 'no rows' } });
            updated.push({ table, patch: pendingUpdate, ids: rows.map((r) => r.id) });
            return Promise.resolve({ data: { ...target, ...pendingUpdate }, error: null });
          }
          return Promise.resolve(
            pendingInsert
              ? { data: pendingInsert, error: null }
              : rows[0]
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'no rows' } },
          );
        },
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return b;
    },
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: null }), upload: async () => ({ error: null }) }),
    },
  };
  return { db, inserted, updated };
}

const OWNER = { id: 'owner-1', email: 'owner@team.com' };
const MEMBER = { id: 'member-1', email: 'Jane@Team.com', emailVerified: true };
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
  const { db, inserted, updated } = makeDb(tables);
  const supabase: any = { db };
  const workspaces: any = {
    findByOwner: jest.fn(async (userId: string) => {
      if (userId === 'owner-1') return { id: 'ws-1' };
      throw new NotFoundException('Workspace not found');
    }),
  };
  const access = new AccessService(supabase, workspaces);
  const service = new IssuesService(supabase, {} as any, workspaces, access);
  return { service, inserted, updated };
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

  describe('updateStatus (I1b)', () => {
    it('lets the project owner change status', async () => {
      const { service, updated } = build();
      const res = await service.updateStatus(OWNER, 'i1', 'In Dev');
      expect(res.status).toBe('In Dev');
      expect(updated).toEqual([{ table: 'issues', patch: { status: 'In Dev' }, ids: ['i1'] }]);
    });

    it('lets a member set Resolved on its project issue', async () => {
      const { service, updated } = build();
      const res = await service.updateStatus(MEMBER, 'i1', 'Resolved');
      expect(res.status).toBe('Resolved');
      expect(updated).toHaveLength(1);
    });

    it('forbids a member from setting In Dev or Closed and writes nothing', async () => {
      const { service, updated } = build();
      await expect(service.updateStatus(MEMBER, 'i1', 'In Dev')).rejects.toThrow(ForbiddenException);
      await expect(service.updateStatus(MEMBER, 'i1', 'Closed')).rejects.toThrow(ForbiddenException);
      expect(updated).toHaveLength(0);
    });

    it('member of project A cannot read or update status of an issue in project B', async () => {
      const { service, updated } = build();
      await expect(service.findOne(MEMBER, 'i2')).rejects.toThrow(NotFoundException);
      await expect(service.updateStatus(MEMBER, 'i2', 'Resolved')).rejects.toThrow(NotFoundException);
      expect(updated).toHaveLength(0);
    });

    it('owner can set any status', async () => {
      const { service } = build();
      for (const st of ['Incoming', 'In Dev', 'Resolved', 'Closed']) {
        expect((await service.updateStatus(OWNER, 'i1', st)).status).toBe(st);
      }
    });

    it('refuses a user from another tenant and writes nothing', async () => {
      const { service, updated } = build();
      await expect(service.updateStatus(STRANGER, 'i2', 'Closed')).rejects.toThrow(NotFoundException);
      expect(updated).toHaveLength(0);
    });

    it('404s for a missing issue', async () => {
      const { service } = build();
      await expect(service.updateStatus(OWNER, 'nope', 'Closed')).rejects.toThrow(NotFoundException);
    });
  });

  describe('client-supplied storage paths (I1d)', () => {
    it('create rejects a videoStoragePath outside user/project', async () => {
      const { service, inserted } = build();
      for (const videoStoragePath of [
        'owner-1/p1/1-video.webm',
        'member-1/p2/1-video.webm',
        'member-1/p1/../../owner-1/p1/x.webm',
        'p1/member-1/x.webm',
      ]) {
        await expect(service.create(MEMBER, { ...dto, videoStoragePath })).rejects.toThrow(BadRequestException);
      }
      expect(inserted).toHaveLength(0);
    });

    it('create accepts the reporter\'s own path', async () => {
      const { service, inserted } = build();
      await service.create(MEMBER, { ...dto, videoStoragePath: 'member-1/p1/1-video.webm' });
      expect(inserted[0].video_storage_path).toBe('member-1/p1/1-video.webm');
    });

    it('attachVideo rejects foreign video, webcam or thumbnail paths', async () => {
      const { service, updated } = build();
      await expect(
        service.attachVideo('member-1', 'i1', { videoStoragePath: 'owner-1/p2/x.webm' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.attachVideo('member-1', 'i1', {
          videoStoragePath: 'member-1/p1/x.webm',
          webcamStoragePath: 'owner-1/p1/cam.webm',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.attachVideo('member-1', 'i1', {
          videoStoragePath: 'member-1/p1/x.webm',
          thumbnailStoragePath: 'member-1/p2/t.jpg',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(updated).toHaveLength(0);
    });

    it('attachVideo accepts paths under the reporter and the issue\'s project', async () => {
      const { service, updated } = build();
      await service.attachVideo('member-1', 'i1', {
        videoStoragePath: 'member-1/p1/x.webm',
        thumbnailStoragePath: 'member-1/p1/t.jpg',
      });
      expect(updated[0].patch).toEqual({
        video_storage_path: 'member-1/p1/x.webm',
        thumbnail_storage_path: 'member-1/p1/t.jpg',
      });
    });

    it('attachVideo 404s for an issue the user did not report', async () => {
      const { service } = build();
      await expect(
        service.attachVideo('member-1', 'i2', { videoStoragePath: 'member-1/p2/x.webm' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('retention cleanup (I1a)', () => {
    const OLD = process.env.RETENTION_ADMIN_USER_IDS;
    afterEach(() => {
      if (OLD === undefined) delete process.env.RETENTION_ADMIN_USER_IDS;
      else process.env.RETENTION_ADMIN_USER_IDS = OLD;
    });

    it('denies everyone when RETENTION_ADMIN_USER_IDS is unset', async () => {
      delete process.env.RETENTION_ADMIN_USER_IDS;
      const { service } = build();
      await expect(service.runRetentionCleanup(OWNER, 14, true)).rejects.toThrow(ForbiddenException);
    });

    it('denies users not in the allow-list', async () => {
      process.env.RETENTION_ADMIN_USER_IDS = 'admin-1, admin-2';
      const { service } = build();
      await expect(service.runRetentionCleanup(OWNER, 14, true)).rejects.toThrow(ForbiddenException);
    });

    it('allows an allow-listed user', async () => {
      process.env.RETENTION_ADMIN_USER_IDS = 'admin-1, owner-1';
      const { service } = build();
      await expect(service.runRetentionCleanup(OWNER, 14, true)).resolves.toBeDefined();
    });
  });
});
