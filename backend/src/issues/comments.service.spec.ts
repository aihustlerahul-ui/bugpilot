import { NotFoundException, ValidationPipe, BadRequestException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  const inserted: Row[] = [];
  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let pending: Row | null = null;
      const b: any = {
        select: () => b,
        eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
        order: (k: string, o: { ascending: boolean }) => (
          (rows = [...rows].sort((a, c) =>
            (String(a[k]) < String(c[k]) ? -1 : 1) * (o?.ascending === false ? -1 : 1),
          )),
          b
        ),
        insert: (row: Row) => {
          pending = { id: 'c-new', created_at: '2026-11-04T00:00:00Z', ...row };
          inserted.push(pending);
          return b;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: pending ?? rows[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return b;
    },
  };
  return { db, inserted };
}

const USER = { id: 'u1', email: 'jane@team.com' };

function setup(role: 'owner' | 'member' | null) {
  const fake = makeDb({
    issues: [{ id: 'i1', project_id: 'p1' }],
    issue_comments: [
      { id: 'c2', issue_id: 'i1', body: 'second', created_at: '2026-11-02T00:00:00Z' },
      { id: 'c1', issue_id: 'i1', body: 'first', created_at: '2026-11-01T00:00:00Z' },
      { id: 'cx', issue_id: 'i2', body: 'other', created_at: '2026-11-01T00:00:00Z' },
    ],
  });
  const access = { getProjectRole: jest.fn().mockResolvedValue(role) };
  const svc = new CommentsService({ db: fake.db } as any, access as any);
  return { svc, access, ...fake };
}

describe('CommentsService', () => {
  it('add stores comment with author and source', async () => {
    const { svc, inserted, access } = setup('member');
    const c = await svc.add(USER, 'i1', 'hello', 'mcp');
    expect(access.getProjectRole).toHaveBeenCalledWith(USER, 'p1');
    expect(inserted[0]).toMatchObject({
      issue_id: 'i1',
      author_user_id: 'u1',
      author_name: 'jane',
      body: 'hello',
      source: 'mcp',
    });
    expect(c.body).toBe('hello');
  });

  it('list returns oldest first', async () => {
    const { svc } = setup('owner');
    const out = await svc.list(USER, 'i1');
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('non-member gets NotFound', async () => {
    const { svc } = setup(null);
    await expect(svc.list(USER, 'i1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.add(USER, 'i1', 'x', 'web')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('missing issue gets NotFound', async () => {
    const { svc } = setup('owner');
    await expect(svc.list(USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CreateCommentDto validation', () => {
  const pipe = new ValidationPipe({ transform: true });
  const run = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: CreateCommentDto });

  it('accepts a normal body', async () => {
    await expect(run({ body: 'ok' })).resolves.toBeTruthy();
    await expect(run({ body: 'a'.repeat(5000) })).resolves.toBeTruthy();
  });
  it('empty body rejected', async () => {
    await expect(run({ body: '' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('body over 5000 chars rejected', async () => {
    await expect(run({ body: 'a'.repeat(5001) })).rejects.toBeInstanceOf(BadRequestException);
  });
});
