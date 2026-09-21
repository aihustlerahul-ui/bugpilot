// Tests validating canvas recording configuration and decoupled rrweb bundle footprint
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPLAY_RECORDER_PATH = path.resolve(__dirname, '../replay-recorder.js');
const RRWEB_BUNDLE_PATH    = path.resolve(__dirname, '../rrweb-record.min.js');
const MANIFEST_PATH        = path.resolve(__dirname, '../manifest.json');

test('canvas recording config: replay-recorder.js sets recordCanvas: true and sampling.canvas: 2', () => {
  const content = fs.readFileSync(REPLAY_RECORDER_PATH, 'utf8');

  // Verify recordCanvas is boolean true (NOT integer 4)
  assert.match(content, /recordCanvas:\s*true/);
  assert.doesNotMatch(content, /recordCanvas:\s*4/);

  // Verify canvas sampling frequency is configured under sampling
  assert.match(content, /sampling:\s*\{[^}]*canvas:\s*2/);
  assert.match(content, /slimDOM:\s*true/);
});

test('canvas recording config: decoupled @rrweb/record bundle is < 220KB', () => {
  assert.ok(fs.existsSync(RRWEB_BUNDLE_PATH), 'extension/rrweb-record.min.js must exist');
  const stats = fs.statSync(RRWEB_BUNDLE_PATH);

  // Original bundle was ~535.6 KB; decoupled bundle is ~182.7 KB (66% reduction)
  assert.ok(stats.size < 220000, `Bundle size ${stats.size} exceeds 220,000 bytes limit`);
  assert.ok(stats.size > 100000, `Bundle size ${stats.size} is suspiciously small`);
});

test('canvas recording config: rrweb-record.min.js exports record and takeFullSnapshot', () => {
  const code = fs.readFileSync(RRWEB_BUNDLE_PATH, 'utf8');
  const win = {};
  const sandbox = { window: win, globalThis: win };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const rrweb = win.rrweb || sandbox.rrweb;
  assert.ok(rrweb, 'rrweb must be defined on window/globalThis');
  assert.strictEqual(typeof rrweb.record, 'function', 'rrweb.record must be a function');
  assert.strictEqual(typeof rrweb.takeFullSnapshot, 'function', 'rrweb.takeFullSnapshot must be a function');
  assert.ok(rrweb.EventType, 'rrweb.EventType must be exported');
});

test('manifest.json: declares contextMenus and web_accessible_resources correctly', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  assert.ok(manifest.permissions.includes('contextMenus'), 'manifest must include contextMenus permission');

  const war = manifest.web_accessible_resources || [];
  const resources = war.flatMap(w => w.resources || []);
  assert.ok(resources.includes('rrweb-record.min.js'), 'web_accessible_resources must include rrweb-record.min.js');
  assert.ok(resources.includes('finder.js'), 'web_accessible_resources must include finder.js');
  assert.ok(!resources.includes('rrweb.min.js'), 'web_accessible_resources should not reference old rrweb.min.js');

  const contentScripts = manifest.content_scripts || [];
  const csJs = contentScripts.flatMap(cs => cs.js || []);
  assert.ok(csJs.includes('finder.js'), 'content_scripts must include finder.js');
  assert.ok(csJs.includes('content.js'), 'content_scripts must include content.js');
});
