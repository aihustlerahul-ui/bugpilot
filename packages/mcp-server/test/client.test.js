import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, apiRequest, redactToken } from '../src/client.js';

const ENV_KEYS = ['BUGPILOT_API_KEY', 'BUGPILOT_WORKSPACE_ID', 'BUGPILOT_ACCESS_TOKEN', 'BUGPILOT_API_URL', 'BUGPILOT_PROJECT_ID'];
let savedEnv, savedFetch, calls;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  savedFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  globalThis.fetch = savedFetch;
});

function stub(status = 200, body = []) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

test('api key sends Authorization and X-Workspace-Id headers', async () => {
  process.env.BUGPILOT_API_KEY = 'bp_live_abc123';
  process.env.BUGPILOT_WORKSPACE_ID = 'ws-1';
  stub();
  await apiRequest('GET', '/api/projects');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bp_live_abc123');
  assert.equal(calls[0].init.headers['X-Workspace-Id'], 'ws-1');
});

test('falls back to BUGPILOT_ACCESS_TOKEN without workspace header', async () => {
  process.env.BUGPILOT_ACCESS_TOKEN = 'jwt.tok.en';
  stub();
  await apiRequest('GET', '/api/projects');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt.tok.en');
  assert.equal(calls[0].init.headers['X-Workspace-Id'], undefined);
});

test('missing workspace id with API key throws a clear error', () => {
  process.env.BUGPILOT_API_KEY = 'bp_live_abc123';
  assert.throws(() => getConfig(), /BUGPILOT_WORKSPACE_ID/);
});

test('missing all credentials throws naming both vars', () => {
  assert.throws(() => getConfig(), /BUGPILOT_API_KEY/);
});

test('errors never contain the key', async () => {
  process.env.BUGPILOT_API_KEY = 'bp_live_SECRETKEY99';
  process.env.BUGPILOT_WORKSPACE_ID = 'ws-1';
  stub(401, { message: 'bad key bp_live_SECRETKEY99 Bearer bp_live_SECRETKEY99' });
  await assert.rejects(
    () => apiRequest('GET', '/api/projects'),
    (e) => { assert.ok(!e.message.includes('SECRETKEY99')); return true; },
  );
  assert.ok(!redactToken('x bp_live_ABC_def-1 y').includes('ABC'));
});

test('POST sends JSON body and query params', async () => {
  process.env.BUGPILOT_ACCESS_TOKEN = 't';
  stub(200, { ok: true });
  await apiRequest('POST', '/api/x', { query: { a: '1' }, body: { b: 2 } });
  assert.match(calls[0].url, /\/api\/x\?a=1$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"b":2}');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('absolute foreign URL is rejected and fetch not called', async () => {
  process.env.BUGPILOT_ACCESS_TOKEN = 't';
  stub();
  await assert.rejects(() => apiRequest('GET', 'https://evil.test/x'), /relative|origin/);
  await assert.rejects(() => apiRequest('GET', '//evil.test/x'), /relative|origin/);
  assert.equal(calls.length, 0);
});
