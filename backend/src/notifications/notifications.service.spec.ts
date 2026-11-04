import { Logger } from '@nestjs/common';
import { NotificationsService, escapeHtml } from './notifications.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

const issueRow = {
  id: 'i1',
  project_id: 'p1',
  title: 'Spacing <b>bug</b>',
  description: 'd',
  reporter_id: 'u-reporter',
  assignee_member_id: 'm-assignee',
};

function makeService(opts: { issue?: any; reporterEmail?: string; assigneeEmail?: string } = {}) {
  const issue = opts.issue === undefined ? issueRow : opts.issue;
  const db: any = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === 'issues' ? issue : { email: opts.assigneeEmail ?? 'assignee@example.com' },
            }),
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: { email: id === 'u-reporter' ? opts.reporterEmail ?? 'reporter@example.com' : 'actor@example.com' } } }),
      },
    },
  };
  return new NotificationsService({ db } as any);
}

const actor: AuthUser = { id: 'u-actor', email: 'actor@example.com', authMethod: 'jwt' };

describe('NotificationsService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM = 'BugPilot <noreply@example.com>';
    process.env.PLATFORM_URL = 'https://app.example.com/';
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.PLATFORM_URL;
  });

  const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

  it('is a silent no-op when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    await makeService().notifyComment(actor, 'i1', 'hi');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('comment: emails reporter and assignee separately, never the author', async () => {
    await makeService().notifyComment(actor, 'i1', 'looks fixed');
    const bodies = sent();
    expect(bodies.map((b) => b.to[0]).sort()).toEqual(['assignee@example.com', 'reporter@example.com']);
    expect(bodies.every((b) => b.to.length === 1)).toBe(true);
    expect(bodies[0].subject).toContain('New comment on:');
    expect(bodies[0].html).toContain('https://app.example.com/projects/p1/issues/i1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer re_test_key');
  });

  it('does not email the actor when they are the reporter', async () => {
    await makeService({ reporterEmail: 'actor@example.com' }).notifyComment(actor, 'i1', 'x');
    expect(sent().map((b) => b.to[0])).toEqual(['assignee@example.com']);
  });

  it('escapes issue titles and comment text in the HTML body', async () => {
    await makeService().notifyComment(actor, 'i1', '<script>alert(1)</script>');
    const html = sent()[0].html as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Spacing &lt;b&gt;bug&lt;/b&gt;');
  });

  it('status change: names both statuses and skips no-op changes', async () => {
    const svc = makeService();
    await svc.notifyStatusChanged(actor, 'i1', 'Incoming', 'Resolved');
    expect(sent()[0].subject).toContain('Status changed to Resolved');
    fetchMock.mockClear();
    await svc.notifyStatusChanged(actor, 'i1', 'Resolved', 'Resolved');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('assigned: emails only the new assignee, and not when assigning yourself', async () => {
    const svc = makeService();
    await svc.notifyAssigned(actor, 'i1', 'prit@example.com');
    expect(sent().map((b) => b.to[0])).toEqual(['prit@example.com']);
    fetchMock.mockClear();
    await svc.notifyAssigned(actor, 'i1', 'ACTOR@example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('added to project: emails the new member', async () => {
    await makeService().notifyAddedToProject('u-actor', 'new@example.com', 'Frontend QA', 'p1');
    const b = sent()[0];
    expect(b.to).toEqual(['new@example.com']);
    expect(b.subject).toBe('You were added to Frontend QA');
  });

  it('strips newlines from subjects so text cannot inject headers', async () => {
    await makeService({ issue: { ...issueRow, title: 'a\r\nBcc: evil@example.com' } }).notifyComment(actor, 'i1', 'x');
    expect(sent()[0].subject).not.toMatch(/[\r\n]/);
  });

  it('never throws when the API errors, times out, or the issue is missing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(makeService().notifyComment(actor, 'i1', 'x')).resolves.toBeUndefined();
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(makeService().notifyComment(actor, 'i1', 'x')).resolves.toBeUndefined();
    await expect(makeService({ issue: null }).notifyComment(actor, 'missing', 'x')).resolves.toBeUndefined();
  });

  it('escapeHtml covers the five special characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
