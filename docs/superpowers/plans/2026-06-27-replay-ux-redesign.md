# Replay UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple rrweb screen recording from the bug capture UI — "Start Recording Screen" starts rrweb independently, "Capture Now" activates the hover UI, and a snapshot is taken at click time so the replay ends at the bug moment (not after form interaction).

**Architecture:** The replay toggle is replaced by a "Start Recording Screen" button that sends a new `START_SCREEN_RECORDING` / `STOP_SCREEN_RECORDING` message to background.js, which injects rrweb. The "Start Recording" button is renamed "Capture Now" and retains its existing hover-UI behaviour. A new `SNAPSHOT_REPLAY` message freezes `_events` into `_snapshotEvents` at the moment an element is clicked (before the modal opens). On submit, background.js requests `_snapshotEvents` (not the live buffer).

**Tech Stack:** MV3 vanilla JS (extension), existing chrome.storage.local, existing message bus.

## Global Constraints

- Extension is MV3 vanilla JS — no bundler, no imports, no TypeScript
- All CSS class names prefixed `qa-` or use existing design tokens (--brand, --border, --red, etc.)
- All styles use `!important` in content-styles.css; sidepanel styles do not
- Only extension files touched: sidepanel.html, sidepanel.js, background.js, replay-recorder.js
- Storage keys: `qa_screen_recording` (boolean — rrweb active), `qa_replay_window_ms` (existing, unchanged)
- Graceful fallback: if user clicks "Capture Now" without starting screen recording, issue submits normally with no replay attached

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `extension/sidepanel.html` | Modify | Remove toggle row, add "Start Recording Screen" button + styles |
| `extension/sidepanel.js` | Modify | New button handlers, qa_screen_recording state, rename Capture Now |
| `extension/background.js` | Modify | Handle START_SCREEN_RECORDING / STOP_SCREEN_RECORDING messages; snapshot on CAPTURE_SCREENSHOT |
| `extension/replay-recorder.js` | Modify | Add SNAPSHOT_REPLAY handler that freezes _snapshotEvents; GET_REPLAY_EVENTS returns snapshot |

---

## Task 1: sidepanel.html — replace toggle with "Start Recording Screen" button

**Files:**
- Modify: `extension/sidepanel.html`

**Interfaces:**
- Produces: `#btn-screen-recording` button, `#replay-window-select` dropdown (kept), `#btn-toggle-recording` renamed visually to "Capture Now"

- [ ] **Step 1: Remove the replay toggle row**

In `extension/sidepanel.html`, find and remove the entire `<div class="replay-row" ...>` block (the toggle + dropdown row added in the previous implementation). It looks like:

```html
    <div class="replay-row" id="replay-row">
      ...
    </div>
```

Delete it entirely.

- [ ] **Step 2: Add "Start Recording Screen" button + window dropdown**

In place of the removed toggle row, add this block immediately after the `btn-toggle-recording` button and before `<p class="shortcut-hint">`:

```html
    <div class="screen-rec-row" id="screen-rec-row">
      <button class="btn btn-screen-rec btn-full" id="btn-screen-recording">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="6" cy="6" r="2.5"/></svg>
        Start Recording Screen
      </button>
      <select class="replay-window-select" id="replay-window-select" title="Replay window length">
        <option value="30000">30s</option>
        <option value="60000">1 min</option>
        <option value="120000" selected>2 min</option>
        <option value="180000">3 min</option>
        <option value="240000">4 min</option>
        <option value="300000">5 min</option>
      </select>
    </div>
```

- [ ] **Step 3: Rename "Start Recording" button label in HTML**

Find the `btn-toggle-recording` button's inner text. It currently says `Start Recording`. Change the default label to `Capture Now`:

```html
    <button class="btn btn-record btn-full" id="btn-toggle-recording">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 11,6 3,11"/></svg>
      Capture Now
    </button>
```

- [ ] **Step 4: Add styles in the `<style>` tag**

Find the existing `.replay-row` CSS block (added in previous task) and replace it entirely with:

```css
    /* ── SCREEN RECORDING ROW ── */
    .screen-rec-row {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 14px 10px;
    }
    .btn-screen-rec {
      flex: 1;
      background: var(--surface); color: var(--text-hi);
      border: 1px solid var(--border);
      font-size: 12px; padding: 8px 10px;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .btn-screen-rec:hover:not(:disabled) { background: var(--bg); }
    .btn-screen-rec.active {
      background: var(--red-bg); color: #991b1b;
      border-color: var(--red-border);
    }
    .btn-screen-rec.active svg circle:last-child { fill: var(--red); }
    .replay-window-select {
      font-size: 11px; padding: 3px 6px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--surface); color: var(--text-hi);
      cursor: pointer; flex-shrink: 0;
    }
    .replay-window-select:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 5: Verify HTML is valid**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('extension/sidepanel.html', 'utf8');
const hasScreenRec = html.includes('btn-screen-recording');
const hasCapture = html.includes('Capture Now');
const noToggle = !html.includes('toggle-replay');
console.log('btn-screen-recording:', hasScreenRec);
console.log('Capture Now label:', hasCapture);
console.log('Old toggle removed:', noToggle);
"
```
Expected: all three print `true`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/sidepanel.html
git commit -m "feat(extension): replace replay toggle with Start Recording Screen button"
```

---

## Task 2: sidepanel.js — wire up new button + rename state

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `#btn-screen-recording`, `#replay-window-select` DOM elements
- Produces: sends `START_SCREEN_RECORDING` / `STOP_SCREEN_RECORDING` to background.js; stores `qa_screen_recording` in chrome.storage.local
- Produces: `applyRecordingState` updates "Capture Now" / "Stop Capturing" label (not "Start/Stop Recording")

- [ ] **Step 1: Update DOM ref declarations**

Find the block in `sidepanel.js` where DOM refs are declared. Replace these lines:

```js
const toggleReplay     = document.getElementById('toggle-replay');
const replayWindowSel  = document.getElementById('replay-window-select');
const replayRow        = document.getElementById('replay-row');
```

With:

```js
const btnScreenRec    = document.getElementById('btn-screen-recording');
const replayWindowSel = document.getElementById('replay-window-select');
```

- [ ] **Step 2: Update applyRecordingState to use "Capture Now" / "Stop Capturing" labels**

In `applyRecordingState`, find the recording branch that sets `btnToggleRecording.innerHTML`. Change it to:

```js
    btnToggleRecording.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg> Stop Capturing';
```

And the idle branch to:

```js
    btnToggleRecording.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 11,6 3,11"/></svg> Capture Now';
```

Also in `applyRecordingState`, remove the lines that disabled/enabled `toggleReplay` and `replayWindowSel` (those were for the old toggle). Replace with: disable `replayWindowSel` and `btnScreenRec` while capturing is active:

```js
    // In the recording=true branch:
    replayWindowSel.disabled = true;
    btnScreenRec.disabled = true;

    // In the recording=false branch:
    replayWindowSel.disabled = false;
    btnScreenRec.disabled = false;
```

- [ ] **Step 3: Remove old toggle persistence block, add new screen recording button handler**

Find and remove the old replay toggle persistence block:
```js
// ── Replay toggle persistence ─────────────────────────────────────────────────
chrome.storage.local.get(['qa_replay_enabled', 'qa_replay_window_ms'], ...
toggleReplay.addEventListener('click', ...
replayWindowSel.addEventListener('change', ...
```

Replace entirely with:

```js
// ── Screen recording button ───────────────────────────────────────────────────
let isScreenRecording = false;

chrome.storage.local.get(['qa_screen_recording', 'qa_replay_window_ms'], function (result) {
  isScreenRecording = result.qa_screen_recording ?? false;
  const windowMs = result.qa_replay_window_ms ?? 120000;
  replayWindowSel.value = String(windowMs);
  applyScreenRecordingState(isScreenRecording);
});

function applyScreenRecordingState(active) {
  isScreenRecording = active;
  if (active) {
    btnScreenRec.className = 'btn btn-screen-rec btn-full active';
    btnScreenRec.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg> Stop Recording Screen';
  } else {
    btnScreenRec.className = 'btn btn-screen-rec btn-full';
    btnScreenRec.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="6" cy="6" r="2.5"/></svg> Start Recording Screen';
  }
}

btnScreenRec.addEventListener('click', async function () {
  const next = !isScreenRecording;
  await chrome.storage.local.set({ qa_screen_recording: next });
  applyScreenRecordingState(next);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (next) {
    chrome.runtime.sendMessage({ type: 'START_SCREEN_RECORDING', tabId: tab.id });
  } else {
    chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
  }
});

replayWindowSel.addEventListener('change', function () {
  chrome.storage.local.set({ qa_replay_window_ms: Number(replayWindowSel.value) });
});
```

- [ ] **Step 4: Verify syntax**

```bash
node -e "require('fs').readFileSync('extension/sidepanel.js','utf8'); console.log('syntax ok')" 2>&1 || echo "CHECK SYNTAX"
```
Expected: `syntax ok`

- [ ] **Step 5: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/sidepanel.js
git commit -m "feat(extension): wire Start Recording Screen button and rename Capture Now"
```

---

## Task 3: background.js — handle new messages + snapshot on capture

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `START_SCREEN_RECORDING` message → inject rrweb.min.js + replay-recorder.js
- Consumes: `STOP_SCREEN_RECORDING` message → send STOP_REPLAY to tab
- Consumes: `CAPTURE_SCREENSHOT` — after capturing screenshot, send `SNAPSHOT_REPLAY` to tab's replay-recorder before returning
- Produces: `postIssue` requests `GET_REPLAY_EVENTS` (which now returns the snapshot, not live buffer)

- [ ] **Step 1: Remove old rrweb injection from keyboard shortcut handler**

In `background.js`, find the keyboard shortcut recording start block where `qa_replay_enabled` is read and rrweb is injected:

```js
    // Inject rrweb + replay recorder if toggle is on
    const { qa_replay_enabled } = await chrome.storage.local.get(['qa_replay_enabled']);
    if (qa_replay_enabled) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['rrweb.min.js'] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['replay-recorder.js'] });
      } catch (err) {
        console.warn('[QA] replay inject failed:', err.message);
      }
    }
```

Remove this entire block (both the main path and the fallback path inside the `catch`). Also remove the `STOP_REPLAY` line from the stop-recording block — screen recording now has its own lifecycle.

- [ ] **Step 2: Add START_SCREEN_RECORDING and STOP_SCREEN_RECORDING handlers to the message router**

In the message router (`chrome.runtime.onMessage.addListener`), add two new handlers after the existing ones:

```js
  if (type === 'START_SCREEN_RECORDING') {
    handleStartScreenRecording(message);
    return false;
  }
  if (type === 'STOP_SCREEN_RECORDING') {
    handleStopScreenRecording(message);
    return false;
  }
```

- [ ] **Step 3: Add handler functions**

Add these two functions to `background.js`:

```js
// ── START_SCREEN_RECORDING ────────────────────────────────────────────────────
async function handleStartScreenRecording(message) {
  const tabId = message.tabId;
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb.min.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['replay-recorder.js'] });
  } catch (err) {
    console.warn('[QA] screen recording inject failed:', err.message);
  }
}

// ── STOP_SCREEN_RECORDING ─────────────────────────────────────────────────────
async function handleStopScreenRecording(message) {
  const tabId = message.tabId;
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_REPLAY' });
  } catch (_) {}
  await chrome.storage.local.set({ qa_screen_recording: false });
}
```

- [ ] **Step 4: Add SNAPSHOT_REPLAY call inside handleCaptureScreenshot**

In `handleCaptureScreenshot`, after the screenshot is captured and before `sendResponse`, add:

```js
  // Snapshot replay events at bug-capture moment (before modal opens)
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'SNAPSHOT_REPLAY' });
    }
  } catch (_) {}
```

Full updated function:
```js
async function handleCaptureScreenshot(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      sendResponse({ ok: false, error: 'No active tab' });
      return;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80,
    });

    // Snapshot replay events at bug-capture moment (before modal opens)
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SNAPSHOT_REPLAY' });
    } catch (_) {}

    sendResponse({ ok: true, dataUrl });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
```

- [ ] **Step 5: Update postIssue to check qa_screen_recording instead of qa_replay_enabled**

In `postIssue`, find this line:
```js
  const { qa_replay_enabled } = await chrome.storage.local.get(['qa_replay_enabled']);
  if (qa_replay_enabled) {
```

Change to:
```js
  const { qa_screen_recording } = await chrome.storage.local.get(['qa_screen_recording']);
  if (qa_screen_recording) {
```

- [ ] **Step 6: Verify syntax**

```bash
node -e "require('fs').readFileSync('extension/background.js','utf8'); console.log('syntax ok')" 2>&1 || echo "CHECK SYNTAX"
```
Expected: `syntax ok`

- [ ] **Step 7: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/background.js
git commit -m "feat(extension): handle START/STOP_SCREEN_RECORDING, snapshot replay on capture"
```

---

## Task 4: replay-recorder.js — add SNAPSHOT_REPLAY handler

**Files:**
- Modify: `extension/replay-recorder.js`

**Interfaces:**
- Consumes: `SNAPSHOT_REPLAY` message → freezes `_snapshotEvents = _events.slice()`
- Produces: `GET_REPLAY_EVENTS` now returns `_snapshotEvents` (the frozen snapshot), not the live `_events`
- Produces: `STOP_REPLAY` clears both `_events` and `_snapshotEvents`

- [ ] **Step 1: Add _snapshotEvents variable**

In `replay-recorder.js`, find the variable declarations at the top of the IIFE:
```js
  var _events = [];
  var _windowMs = 2 * 60 * 1000;
  var _stopFn = null;
```

Add after them:
```js
  var _snapshotEvents = [];
```

- [ ] **Step 2: Add SNAPSHOT_REPLAY message handler**

In the `chrome.runtime.onMessage.addListener` block, add after the existing `GET_REPLAY_EVENTS` handler:

```js
    if (message.type === 'SNAPSHOT_REPLAY') {
      _snapshotEvents = _events.slice(); // freeze current buffer at bug moment
      sendResponse({ ok: true });
      return true;
    }
```

- [ ] **Step 3: Change GET_REPLAY_EVENTS to return snapshot**

Find the `GET_REPLAY_EVENTS` handler:
```js
    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _events.slice() });
      return true;
    }
```

Change to return the snapshot:
```js
    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _snapshotEvents.slice() });
      return true;
    }
```

- [ ] **Step 4: Clear snapshot in stopRecording**

In the `stopRecording` function:
```js
  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    window.__qaReplayActive = false;
  }
```

Add `_snapshotEvents = [];`:
```js
  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    _snapshotEvents = [];
    window.__qaReplayActive = false;
  }
```

- [ ] **Step 5: Verify syntax**

```bash
node -e "require('fs').readFileSync('extension/replay-recorder.js','utf8'); console.log('syntax ok')" 2>&1 || echo "CHECK SYNTAX"
```
Expected: `syntax ok`

- [ ] **Step 6: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/replay-recorder.js
git commit -m "feat(extension): snapshot replay events at capture moment, return snapshot on submit"
```
