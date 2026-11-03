import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tools, handlers } from '../src/tools/read.js';

let savedFetch, savedEnv;
beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  process.env.BUGPILOT_API_KEY = 'bp_live_k';
  process.env.BUGPILOT_WORKSPACE_ID = 'w';
  delete process.env.BUGPILOT_PROJECT_ID;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  process.env = savedEnv;
});

function route(map) {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const key = u.pathname;
    const h = map[key] ?? map[u.href];
    if (!h) return new Response('{"message":"nf"}', { status: 404 });
    if (h instanceof Response) return h;
    return new Response(JSON.stringify(h), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const text = (r) => JSON.parse(r.content.find((c) => c.type === 'text').text);

test('tools export names', () => {
  const names = tools.map((t) => t.name);
  for (const n of ['list_projects', 'get_project', 'list_issues', 'get_issue', 'list_members']) assert.ok(names.includes(n), n);
  for (const n of names) assert.equal(typeof handlers[n], 'function');
});

test('list_issues filters by status and assignee and applies limit', async () => {
  const issues = [
    { id: '1', title: 'a', status: 'open', severity: 'high', route: '/a', created_at: '2026-01-01', assignee_member_id: 'm1', metadata: {} },
    { id: '2', title: 'b', status: 'open', severity: 'low', route: '/b', created_at: '2026-01-03', assignee_member_id: 'm1', metadata: {} },
    { id: '3', title: 'c', status: 'closed', severity: 'low', route: '/c', created_at: '2026-01-04', assignee_member_id: 'm1', metadata: {} },
    { id: '4', title: 'd', status: 'open', severity: 'low', route: '/d', created_at: '2026-01-05', assignee_member_id: 'm2', metadata: { assignee: 'Zed' } },
    { id: '5', title: 'e', status: 'open', severity: 'low', route: '/e', created_at: '2026-01-06', assignee_member_id: null, metadata: { assignee: 'Zed' } },
  ];
  route({ '/api/issues/project/p1': issues });
  let r = text(await handlers.list_issues({ projectId: 'p1', status: 'open', assigneeMemberId: 'm1', limit: 1 }));
  assert.equal(r.length, 1);
  assert.equal(r[0].id, '2'); // newest first among matches
  assert.deepEqual(Object.keys(r[0]).sort(), ['assignee', 'createdAt', 'id', 'reporter', 'route', 'severity', 'status', 'title'].sort());
  r = text(await handlers.list_issues({ projectId: 'p1' }));
  assert.equal(r[0].id, '5');
  assert.equal(r[0].assignee, 'Zed');
  assert.equal(r[1].assignee, 'm2');
  assert.equal(r.length, 5);
});

test('list_issues requires a project id', async () => {
  await assert.rejects(() => handlers.list_issues({}), /projectId/);
});

test('get_issue merges comments', async () => {
  route({
    '/api/issues/i1': { id: 'i1', title: 't', metadata: {} },
    '/api/issues/i1/comments': [{ id: 'c1', body: 'hi' }],
  });
  const r = text(await handlers.get_issue({ issueId: 'i1' }));
  assert.equal(r.comments[0].body, 'hi');
  assert.equal(r.id, 'i1');
});

test('get_issue truncates 500 console entries and flags truncated', async () => {
  const consoleErrors = Array.from({ length: 500 }, (_, i) => ({ m: i }));
  route({
    '/api/issues/i1': { id: 'i1', description: 'x'.repeat(5000), metadata: { consoleErrors, networkErrors: [] } },
    '/api/issues/i1/comments': [],
  });
  const r = text(await handlers.get_issue({ issueId: 'i1' }));
  assert.equal(r.metadata.consoleErrors.length, 50);
  assert.equal(r.truncated, true);
  assert.ok(r.truncatedFields.some((f) => f.includes('consoleErrors')));
  assert.ok(r.truncatedFields.some((f) => f.includes('description')));
  assert.ok(r.description.length < 2100);
});

test('get_issue returns small screenshots as image content', async () => {
  const png = Buffer.from([1, 2, 3, 4]);
  route({
    '/api/issues/i1': { id: 'i1', metadata: {}, screenshot_url: 'https://cdn.test/s.png' },
    '/api/issues/i1/comments': [],
    'https://cdn.test/s.png': new Response(png, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  });
  const r = await handlers.get_issue({ issueId: 'i1' });
  const img = r.content.find((c) => c.type === 'image');
  assert.equal(img.mimeType, 'image/jpeg');
  assert.equal(img.data, png.toString('base64'));
});

test('oversize screenshot falls back to URL', async () => {
  const big = Buffer.alloc(1_600_000, 1);
  route({
    '/api/issues/i1': { id: 'i1', metadata: {}, screenshot_url: 'https://cdn.test/big.png' },
    '/api/issues/i1/comments': [],
    'https://cdn.test/big.png': new Response(big, { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  const r = await handlers.get_issue({ issueId: 'i1' });
  assert.equal(r.content.filter((c) => c.type === 'image').length, 0);
  assert.ok(r.content.find((c) => c.type === 'text').text.includes('https://cdn.test/big.png'));
});

test('screenshot download failure does not throw', async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('cdn.test')) throw new Error('boom');
    const body = u.endsWith('/comments') ? [] : { id: 'i1', metadata: {}, screenshot_url: 'https://cdn.test/s.png' };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const r = await handlers.get_issue({ issueId: 'i1' });
  assert.equal(r.content.filter((c) => c.type === 'image').length, 0);
});

test('list_members hits members endpoint', async () => {
  route({ '/api/issues/project/p1/members': [{ id: 'm', name: 'N', email: 'e' }] });
  assert.equal(text(await handlers.list_members({ projectId: 'p1' }))[0].id, 'm');
});
