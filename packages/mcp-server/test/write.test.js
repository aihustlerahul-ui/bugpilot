import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tools, handlers, ISSUE_STATUSES } from '../src/tools/write.js';

let savedFetch, savedEnv, calls;
beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  process.env.BUGPILOT_API_KEY = 'bp_live_secretkey';
  process.env.BUGPILOT_WORKSPACE_ID = 'w';
  calls = [];
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  process.env = savedEnv;
});

/** routes: { 'METHOD /path': data | Response } */
function stub(routes) {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined });
    const h = routes[`${method} ${u.pathname}`];
    if (!h) return new Response('{"message":"nf"}', { status: 404 });
    if (h instanceof Response) return h;
    return new Response(JSON.stringify(h), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const text = (r) => JSON.parse(r.content.find((c) => c.type === 'text').text);

test('write tools export names and handlers', () => {
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_comment', 'assign_issue', 'assign_to_reporter', 'update_issue_status']);
  for (const n of names) assert.equal(typeof handlers[n], 'function');
  assert.equal(ISSUE_STATUSES.length, 6);
  for (const t of tools) {
    assert.match(t.description, /ONLY/);
    assert.match(t.description, /never auto-resolve/i);
  }
  assert.ok(tools.filter((t) => /assign_to_reporter/.test(t.description) && /Resolved/.test(t.description)).length >= 1);
});

test('add_comment posts body and reports comment id', async () => {
  stub({ 'POST /api/issues/i1/comments': { id: 'c1', issue_id: 'i1', body: 'fixed', source: 'mcp' } });
  const r = text(await handlers.add_comment({ issueId: 'i1', body: '  fixed  ' }));
  assert.deepEqual(r, { ok: true, issueId: 'i1', commentId: 'c1', source: 'mcp' });
  assert.deepEqual(calls[0].body, { body: 'fixed' });
});

test('add_comment validates body before calling the API', async () => {
  stub({});
  await assert.rejects(() => handlers.add_comment({ issueId: 'i1', body: '   ' }), /body/);
  await assert.rejects(() => handlers.add_comment({ issueId: 'i1', body: 'x'.repeat(5001) }), /5000/);
  assert.equal(calls.length, 0);
});

test('update_issue_status rejects values outside the enum without calling the API', async () => {
  stub({});
  await assert.rejects(() => handlers.update_issue_status({ issueId: 'i1', status: 'Done' }), /status/);
  assert.equal(calls.length, 0);
});

test('update_issue_status patches a valid status', async () => {
  stub({ 'PATCH /api/issues/i1/status': { id: 'i1', status: 'Resolved' } });
  const r = text(await handlers.update_issue_status({ issueId: 'i1', status: 'Resolved' }));
  assert.deepEqual(r, { ok: true, issueId: 'i1', status: 'Resolved' });
  assert.deepEqual(calls[0].body, { status: 'Resolved' });
});

test('assign_issue sends memberId null to clear', async () => {
  stub({ 'PATCH /api/issues/i1/assignee': { id: 'i1', assignee_member_id: null } });
  const r = text(await handlers.assign_issue({ issueId: 'i1', memberId: null }));
  assert.deepEqual(r, { ok: true, issueId: 'i1', assigneeMemberId: null });
  assert.ok(Object.hasOwn(calls[0].body, 'memberId'));
  assert.equal(calls[0].body.memberId, null);
});

test('assign_issue sends a member id', async () => {
  stub({ 'PATCH /api/issues/i1/assignee': { id: 'i1', assignee_member_id: 'm1' } });
  const r = text(await handlers.assign_issue({ issueId: 'i1', memberId: 'm1' }));
  assert.deepEqual(r, { ok: true, issueId: 'i1', assigneeMemberId: 'm1' });
  assert.deepEqual(calls[0].body, { memberId: 'm1' });
});

test('assign_issue without memberId errors and does not call the API', async () => {
  stub({});
  await assert.rejects(() => handlers.assign_issue({ issueId: 'i1' }), /memberId/);
  await assert.rejects(() => handlers.assign_issue({ issueId: 'i1', memberId: undefined }), /memberId/);
  await assert.rejects(() => handlers.assign_issue({ issueId: 'i1', memberId: '  ' }), /memberId/);
  assert.equal(calls.length, 0);
});

test('assign_to_reporter errors with member list when reporter has no member row', async () => {
  stub({
    'GET /api/issues/i1': { id: 'i1', project_id: 'p1', reporter: { userId: 'u', email: 'r@x.com', name: 'Rita', memberId: null } },
    'GET /api/issues/project/p1/members': [{ id: 'm1', name: 'Ann', email: 'ann@x.com' }, { id: 'm2', name: 'Bob', email: 'bob@x.com' }],
  });
  await assert.rejects(
    () => handlers.assign_to_reporter({ issueId: 'i1' }),
    (e) => /Rita/.test(e.message) && /Ann <ann@x.com> \(m1\)/.test(e.message) && /Bob <bob@x.com> \(m2\)/.test(e.message),
  );
  assert.ok(!calls.some((c) => c.method === 'PATCH'));
});

test('assign_to_reporter assigns reporter.memberId', async () => {
  stub({
    'GET /api/issues/i1': { id: 'i1', project_id: 'p1', reporter: { userId: 'u', email: 'r@x.com', name: 'Rita', memberId: 'm9' } },
    'PATCH /api/issues/i1/assignee': { id: 'i1', assignee_member_id: 'm9' },
  });
  const r = text(await handlers.assign_to_reporter({ issueId: 'i1' }));
  assert.deepEqual(r, { ok: true, issueId: 'i1', assigneeMemberId: 'm9', reporter: { name: 'Rita', email: 'r@x.com' } });
  assert.deepEqual(calls[1].body, { memberId: 'm9' });
});

test('a 403 from the backend surfaces as a clear error without the key', async () => {
  stub({ 'PATCH /api/issues/i1/status': new Response('{"message":"Only the project owner can set this status"}', { status: 403 }) });
  await assert.rejects(
    () => handlers.update_issue_status({ issueId: 'i1', status: 'Closed' }),
    (e) => /owner/.test(e.message) && !/bp_live_secretkey/.test(e.message),
  );
});
