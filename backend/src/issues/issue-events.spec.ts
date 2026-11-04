import { listIssueEvents, recordIssueEvent } from './issue-events';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

function fakeDb(opts: { insertError?: { message: string }; rows?: unknown[]; throws?: boolean } = {}) {
  const inserts: any[] = [];
  const db: any = {
    from: (table: string) => {
      if (opts.throws) throw new Error('boom');
      return {
        insert: (row: any) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: opts.rows ?? [], error: null }),
            }),
          }),
        }),
      };
    },
  };
  return { db, inserts };
}

const jwtUser: AuthUser = { id: 'u1', email: 'dev@example.com', authMethod: 'jwt' };
const keyUser: AuthUser = { id: 'u1', email: 'dev@example.com', authMethod: 'api_key' };

describe('issue events', () => {
  it('records a change with actor name and web source', async () => {
    const { db, inserts } = fakeDb();
    await recordIssueEvent(db, jwtUser, 'i1', 'status', 'Incoming', 'In Dev');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('issue_events');
    expect(inserts[0].row).toMatchObject({
      issue_id: 'i1',
      event_type: 'status',
      from_value: 'Incoming',
      to_value: 'In Dev',
      actor_name: 'dev',
      source: 'web',
    });
  });

  it('marks API-key changes as mcp', async () => {
    const { db, inserts } = fakeDb();
    await recordIssueEvent(db, keyUser, 'i1', 'assignee', null, 'Prit');
    expect(inserts[0].row.source).toBe('mcp');
  });

  it('skips no-op changes', async () => {
    const { db, inserts } = fakeDb();
    await recordIssueEvent(db, jwtUser, 'i1', 'status', 'Resolved', 'Resolved');
    await recordIssueEvent(db, jwtUser, 'i1', 'assignee', null, null);
    expect(inserts).toHaveLength(0);
  });

  it('never throws when the insert fails or the table is missing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      recordIssueEvent(fakeDb({ insertError: { message: 'relation missing' } }).db, jwtUser, 'i1', 'status', 'a', 'b'),
    ).resolves.toBeUndefined();
    await expect(
      recordIssueEvent(fakeDb({ throws: true }).db, jwtUser, 'i1', 'status', 'a', 'b'),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('lists events and falls back to [] on failure', async () => {
    const rows = [{ id: 'e1' }];
    expect(await listIssueEvents(fakeDb({ rows }).db, 'i1')).toEqual(rows);
    expect(await listIssueEvents(fakeDb({ throws: true }).db, 'i1')).toEqual([]);
  });
});
