// Tests for Bug Magnet exploratory test data context menus & insertion logic
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BACKGROUND_PATH = path.resolve(__dirname, '../background.js');
const CONTENT_PATH    = path.resolve(__dirname, '../content.js');

test('bug magnet: background.js defines all required exploratory test data categories', () => {
  const content = fs.readFileSync(BACKGROUND_PATH, 'utf8');

  // Verify categories
  assert.match(content, /whitespace:\s*\{/);
  assert.match(content, /accents:\s*\{/);
  assert.match(content, /emojis:\s*\{/);
  assert.match(content, /rtl:\s*\{/);
  assert.match(content, /emails:\s*\{/);
  assert.match(content, /numbers:\s*\{/);
  assert.match(content, /boundaries:\s*\{/);
  assert.match(content, /exploits:\s*\{/);

  // Verify specific exploratory payloads
  assert.match(content, /Zero\\u200BWidth\\u200CSpace/); // zero-width
  assert.match(content, /Héllo Wörld Café-au-lait/);      // accents
  assert.match(content, /👋 🚀 🐞 ⚡️ 🔥 🦄/);             // emojis
  assert.match(content, /مرحبا بالعالم/);                  // RTL
  assert.match(content, /<script>alert\("BugMagnet"\)<\/script>/); // XSS
  assert.match(content, /' OR '1'='1/);                   // SQLi
  assert.match(content, /9007199254740991/);              // Max safe int
});

test('bug magnet: background.js registers context menu setup and click listener', () => {
  const content = fs.readFileSync(BACKGROUND_PATH, 'utf8');

  assert.match(content, /function setupBugMagnetContextMenus\(\)/);
  assert.match(content, /chrome\.contextMenus\.create\(\{/);
  assert.match(content, /contexts:\s*\[['"]editable['"]\]/);
  assert.match(content, /chrome\.contextMenus\.onClicked\.addListener/);
  assert.match(content, /type:\s*['"]BUG_MAGNET_INSERT['"]/);
});

test('bug magnet: content.js handles BUG_MAGNET_INSERT and dispatches input/change events', () => {
  const content = fs.readFileSync(CONTENT_PATH, 'utf8');

  assert.match(content, /BUG_MAGNET_INSERT/);
  assert.match(content, /new Event\(['"]input['"],\s*\{\s*bubbles:\s*true\s*\}\)/);
  assert.match(content, /new Event\(['"]change['"],\s*\{\s*bubbles:\s*true\s*\}\)/);
});

test('bug magnet insertion simulation: updates input value and selection position', () => {
  // Simulate insertion logic exactly as implemented in content.js
  const el = {
    tagName: 'INPUT',
    value: 'Hello World',
    selectionStart: 5,
    selectionEnd: 5,
    dispatchedEvents: [],
    dispatchEvent(ev) { this.dispatchedEvents.push(ev.type); }
  };

  const message = { type: 'BUG_MAGNET_INSERT', value: ' [TEST] ' };

  const start = el.selectionStart;
  const end = el.selectionEnd;
  const val = el.value;
  const insertVal = String(message.value);
  el.value = val.substring(0, start) + insertVal + val.substring(end);
  el.selectionStart = el.selectionEnd = start + insertVal.length;
  el.dispatchEvent({ type: 'input', bubbles: true });
  el.dispatchEvent({ type: 'change', bubbles: true });

  assert.strictEqual(el.value, 'Hello [TEST]  World');
  assert.strictEqual(el.selectionStart, 13);
  assert.deepStrictEqual(el.dispatchedEvents, ['input', 'change']);
});
