import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('server boots over stdio and lists tools', async () => {
  const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, BUGPILOT_API_KEY: 'bp_live_x', BUGPILOT_WORKSPACE_ID: 'w' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buf = '';
  const waiters = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
    }
  });
  const rpc = (id, method, params) =>
    new Promise((resolve) => {
      waiters.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const res = await rpc(2, 'tools/list', {});
    const names = res.result.tools.map((t) => t.name);
    console.log('TOOLS:', names.join(', '));
    assert.deepEqual(names.sort(), ['add_comment', 'assign_issue', 'assign_to_reporter', 'get_issue', 'get_project', 'list_issues', 'list_members', 'list_projects', 'update_issue_status']);
  } finally {
    child.kill();
  }
});
