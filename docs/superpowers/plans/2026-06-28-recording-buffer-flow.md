# Screen Recording Buffer Flow — Implementation Plan

> **Status: ✅ Implemented (2026-06-29)** — verified in `extension/replay-recorder.js`, `extension/background.js`, `extension/sidepanel.js`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Verification checklist (manual)

- [x] `GET_REPLAY_EVENTS` returns full rolling buffer (no snapshot)
- [x] `visibilitychange` → `AUTO_STOP_RECORDING` on tab hidden
- [x] `saveRecording()` compresses + writes `qa_saved_replay`
- [x] Sidepanel chip via `storage.onChanged` + delete button
- [x] `postIssue` attaches replay when `replayUrlMatches(origin+pathname)`
- [x] Clears `qa_saved_replay` after successful submit

**Goal:** Replace the snapshot-on-click replay model with a save-to-buffer model: recording stops (manually, timer, or tab-switch) → events saved to `chrome.storage.local` → sidepanel shows a chip → next bug submitted on the same tab auto-attaches the saved replay.

**Architecture:** rrweb still injects per-tab. On any stop event, background.js pulls all events from the tab via `GET_REPLAY_EVENTS`, compresses them, and persists to `qa_saved_replay` in storage. The sidepanel reads storage changes to show/hide a chip. `postIssue` reads from storage instead of querying the tab, checks tab identity, attaches and clears on success.

**Tech Stack:** Chrome MV3 extension (vanilla JS), `chrome.storage.local`, `CompressionStream('gzip')`, rrweb

## Global Constraints

- No secrets committed to git
- MV3 only — `chrome.scripting.executeScript`, no `tabs.executeScript`
- All storage writes go through background.js (single writer) except sidepanel deleting `qa_saved_replay`
- `maskAllInputs: true` must remain in rrweb config
- Storage key names (exact): `qa_screen_recording` (bool), `qa_screen_recording_tab_id` (number), `qa_saved_replay` (object or null), `qa_replay_status` (string or null), `qa_recording_tab_id` (number or null)
- `qa_saved_replay` shape: `{ data: string, url: string, tabId: number, duration: number, recordedAt: number }`
- `qa_replay_status` values: `'attached'` | `'skipped'` | `null`
- No TypeScript, no new dependencies
- Syntax-check every JS file with `node --check <file>` before committing

---

## File Map

| File | What changes |
|---|---|
| `extension/replay-recorder.js` | Remove `_snapshotEvents` + `SNAPSHOT_REPLAY`; `GET_REPLAY_EVENTS` returns `_events`; add `visibilitychange` listener |
| `extension/background.js` | Store `qa_screen_recording_tab_id` on start; add `saveRecording(tabId)` helper; handle `AUTO_STOP_RECORDING`; update `STOP_SCREEN_RECORDING`; update `handleCaptureScreenshot`; rewrite `postIssue` replay block |
| `extension/sidepanel.html` | Add recording chip markup + CSS |
| `extension/sidepanel.js` | Show/hide chip via `storage.onChanged`; disable Start button when chip exists; delete button; `qa_replay_status` toast; update countdown auto-stop to delegate to background |

---

### Task 1: replay-recorder.js — return full events + visibilitychange

**Files:**
- Modify: `extension/replay-recorder.js`

**Interfaces:**
- Produces: `GET_REPLAY_EVENTS` → `{ ok: true, events: Event[] }` (full rolling buffer, not snapshot)
- Produces: sends `{ type: 'AUTO_STOP_RECORDING' }` to background when tab becomes hidden

- [ ] **Step 1: Read the current file**

```
extension/replay-recorder.js
```

- [ ] **Step 2: Replace the file with the updated version**

Replace the entire file with:

```js
// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  if (window.__qaReplayActive) return;
  window.__qaReplayActive = true;

  var _events = [];
  var _windowMs = 2 * 60 * 1000;
  var _stopFn = null;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];
    _stopFn = rrweb.record({
      emit: function (event) {
        _events.push(event);
        var cutoff = Date.now() - _windowMs;
        while (_events.length > 0 && _events[0].timestamp < cutoff) {
          _events.shift();
        }
      },
      maskAllInputs: true,
    });
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    window.__qaReplayActive = false;
  }

  // When user switches away from this tab, tell background to save + stop
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && window.__qaReplayActive) {
      chrome.runtime.sendMessage({ type: 'AUTO_STOP_RECORDING' });
    }
  });

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message.type === 'GET_REPLAY_EVENTS') {
      sendResponse({ ok: true, events: _events.slice() });
      return true;
    }
    if (message.type === 'STOP_REPLAY') {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.storage.local.get(['qa_replay_window_ms'], function (result) {
    startRecording(result.qa_replay_window_ms || 2 * 60 * 1000);
  });
})();
```

- [ ] **Step 3: Syntax check**

```bash
node --check extension/replay-recorder.js
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add extension/replay-recorder.js
git commit -m "refactor(extension): remove snapshot model, GET_REPLAY_EVENTS returns full buffer, add visibilitychange trigger"
```

---

### Task 2: background.js — saveRecording helper + stop handlers

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `GET_REPLAY_EVENTS` response from replay-recorder.js (Task 1)
- Produces: `saveRecording(tabId): Promise<void>` — pulls events, compresses, writes `qa_saved_replay` to storage
- Produces: `qa_screen_recording_tab_id` stored on successful `START_SCREEN_RECORDING`
- Produces: handles `AUTO_STOP_RECORDING` message from content script

- [ ] **Step 1: Store tabId on successful start**

In `handleStartScreenRecording`, after `sendResponse({ ok: true })`, also save the tabId:

Find this block (around line 182):
```js
    await chrome.storage.local.set({ qa_screen_recording: true });
    sendResponse({ ok: true });
```

Replace with:
```js
    await chrome.storage.local.set({
      qa_screen_recording: true,
      qa_screen_recording_tab_id: tabId,
    });
    sendResponse({ ok: true });
```

- [ ] **Step 2: Add saveRecording helper**

Add this function after `compressReplayEvents` (around line 26):

```js
// ── Save recording to storage ─────────────────────────────────────────────────
async function saveRecording(tabId) {
  try {
    const replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' });
    if (replayRes?.ok && replayRes.events?.length > 0) {
      const data = await compressReplayEvents(replayRes.events);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const firstTs = replayRes.events[0].timestamp;
      const lastTs  = replayRes.events[replayRes.events.length - 1].timestamp;
      const duration = Math.round((lastTs - firstTs) / 1000);
      await chrome.storage.local.set({
        qa_saved_replay: {
          data,
          url: tab?.url || '',
          tabId,
          duration,
          recordedAt: Date.now(),
        },
      });
    }
  } catch (_) {}
  // Always stop the recorder and clear active flag
  try { await chrome.tabs.sendMessage(tabId, { type: 'STOP_REPLAY' }); } catch (_) {}
  await chrome.storage.local.set({
    qa_screen_recording: false,
    qa_screen_recording_tab_id: null,
  });
}
```

- [ ] **Step 3: Add AUTO_STOP_RECORDING to message router**

In the message router block, add before the `OPEN_ANNOTATOR` handler:

```js
  if (type === 'AUTO_STOP_RECORDING') {
    handleAutoStopRecording(_sender, sendResponse);
    return true;
  }
```

- [ ] **Step 4: Add handleAutoStopRecording function**

Add after `handleStopScreenRecording`:

```js
// ── AUTO_STOP_RECORDING (tab hidden / visibilitychange) ───────────────────────
async function handleAutoStopRecording(sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) { sendResponse({ ok: true }); return; }
  const { qa_screen_recording, qa_screen_recording_tab_id } =
    await chrome.storage.local.get(['qa_screen_recording', 'qa_screen_recording_tab_id']);
  if (!qa_screen_recording || qa_screen_recording_tab_id !== tabId) {
    sendResponse({ ok: true });
    return;
  }
  await saveRecording(tabId);
  sendResponse({ ok: true });
}
```

- [ ] **Step 5: Update handleStopScreenRecording to call saveRecording**

Find the current `handleStopScreenRecording`:
```js
async function handleStopScreenRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: true }); return; }
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_RELAY' });
  } catch (_) {}
  await chrome.storage.local.set({ qa_screen_recording: false });
  sendResponse({ ok: true });
}
```

Replace with:
```js
async function handleStopScreenRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: true }); return; }
  await saveRecording(tabId);
  sendResponse({ ok: true });
}
```

(`saveRecording` already stops the replay and clears the flag — no duplication needed.)

- [ ] **Step 6: Update handleCaptureScreenshot — remove SNAPSHOT_REPLAY, add auto-save if recording active on same tab**

Find `handleCaptureScreenshot`:
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

Replace with:
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

    // If screen recording is active on this same tab, save it now before the modal opens
    const { qa_screen_recording, qa_screen_recording_tab_id } =
      await chrome.storage.local.get(['qa_screen_recording', 'qa_screen_recording_tab_id']);
    if (qa_screen_recording && qa_screen_recording_tab_id === tab.id) {
      await saveRecording(tab.id);
    }

    sendResponse({ ok: true, dataUrl });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
```

- [ ] **Step 7: Syntax check**

```bash
node --check extension/background.js
```

Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): saveRecording helper, AUTO_STOP_RECORDING handler, auto-save on capture"
```

---

### Task 3: background.js — postIssue reads qa_saved_replay

**Files:**
- Modify: `extension/background.js` (postIssue function only)

**Interfaces:**
- Consumes: `qa_saved_replay` from `chrome.storage.local`
- Produces: clears `qa_saved_replay` after successful attach; writes `qa_replay_status` to storage for sidepanel toast

- [ ] **Step 1: Find and replace the replay block in postIssue**

Find this block in `postIssue` (the `qa_replay_enabled` / `qa_screen_recording` check):

```js
  // Collect replay events if recording was active
  let replayData = null;
  const { qa_screen_recording } = await chrome.storage.local.get(['qa_screen_recording']);
  if (qa_screen_recording) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const replayRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_REPLAY_EVENTS' });
        if (replayRes?.ok && replayRes.events?.length > 0) {
          replayData = await compressReplayEvents(replayRes.events);
        }
      }
    } catch (_) {
      // Tab may not have replay recorder injected — that's fine
    }
  }
```

Replace with:

```js
  // Attach saved replay if it exists and was recorded on the same tab as this bug
  let replayData = null;
  let replayStatus = null;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { qa_saved_replay } = await chrome.storage.local.get(['qa_saved_replay']);
  if (qa_saved_replay?.data) {
    if (activeTab && qa_saved_replay.tabId === activeTab.id) {
      replayData = qa_saved_replay.data;
      replayStatus = 'attached';
    } else {
      replayStatus = 'skipped';
    }
  }
```

- [ ] **Step 2: Clear qa_saved_replay and write status after successful POST**

Find the success path after `res.json()`:

```js
  return res.json();
```

Replace with:

```js
  const result = await res.json();
  // Clear saved replay after successful submit and signal sidepanel
  if (replayStatus === 'attached') {
    await chrome.storage.local.remove(['qa_saved_replay']);
  }
  if (replayStatus) {
    await chrome.storage.local.set({ qa_replay_status: replayStatus });
  }
  return result;
```

- [ ] **Step 3: Syntax check**

```bash
node --check extension/background.js
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): postIssue reads qa_saved_replay, tab-match check, clears on attach"
```

---

### Task 4: sidepanel.html — recording chip UI

**Files:**
- Modify: `extension/sidepanel.html`

**Interfaces:**
- Produces: `#replay-chip` div (hidden by default), `#replay-chip-duration`, `#replay-chip-url`, `#btn-delete-replay`

- [ ] **Step 1: Add CSS for the chip**

Find the closing style tag (`</style>`) and insert before it:

```css
    /* ── REPLAY CHIP ── */
    .replay-chip {
      display: none;
      background: #fef9ec;
      border: 1px solid #fde68a;
      border-radius: var(--radius);
      padding: 8px 11px;
      margin-top: -4px;
      gap: 8px;
      align-items: flex-start;
    }
    .replay-chip.show { display: flex; }
    .replay-chip-icon { font-size: 16px; flex-shrink: 0; line-height: 1.4; }
    .replay-chip-body { flex: 1; min-width: 0; }
    .replay-chip-title {
      font-size: 12px; font-weight: 700; color: #92400e;
      margin-bottom: 2px;
    }
    .replay-chip-meta {
      font-size: 10.5px; color: #a16207;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .btn-delete-replay {
      background: none; border: none; cursor: pointer;
      font-size: 11px; color: #b45309; font-weight: 600;
      font-family: inherit; flex-shrink: 0; padding: 2px 0;
      text-decoration: underline;
    }
    .btn-delete-replay:hover { color: #92400e; }
```

- [ ] **Step 2: Add chip markup**

Find the `screen-rec-timer-row` div:
```html
    <div class="screen-rec-timer-row" id="screen-rec-timer-row">
      <span class="screen-rec-timer-dot"></span><span id="screen-rec-timer">2:00</span> remaining
    </div>
```

Add the chip immediately after it:
```html
    <div class="replay-chip" id="replay-chip">
      <span class="replay-chip-icon">🎬</span>
      <div class="replay-chip-body">
        <div class="replay-chip-title">Recording saved — <span id="replay-chip-duration">0:00</span></div>
        <div class="replay-chip-meta" id="replay-chip-url"></div>
      </div>
      <button class="btn-delete-replay" id="btn-delete-replay">Delete</button>
    </div>
```

- [ ] **Step 3: Syntax-check HTML by opening in browser (visual check)**

Load `extension/sidepanel.html` directly in a browser tab. The chip should not be visible (hidden by default). No JS errors in console.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.html
git commit -m "feat(extension): add recording saved chip UI to sidepanel"
```

---

### Task 5: sidepanel.js — chip logic, disable button, toasts

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `qa_saved_replay` from storage (object or undefined)
- Consumes: `qa_replay_status` from storage (`'attached'` | `'skipped'` | null)
- Consumes: `#replay-chip`, `#replay-chip-duration`, `#replay-chip-url`, `#btn-delete-replay` (Task 4)

- [ ] **Step 1: Add DOM refs**

Find the line:
```js
const screenRecTimerRow  = document.getElementById('screen-rec-timer-row');
const screenRecTimerEl   = document.getElementById('screen-rec-timer');
```

Add after it:
```js
const replayChip         = document.getElementById('replay-chip');
const replayChipDuration = document.getElementById('replay-chip-duration');
const replayChipUrl      = document.getElementById('replay-chip-url');
const btnDeleteReplay    = document.getElementById('btn-delete-replay');
```

- [ ] **Step 2: Add applyReplayChip function**

Add this function after `applyScreenRecordingState`:

```js
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function applyReplayChip(savedReplay) {
  if (savedReplay && savedReplay.data) {
    replayChipDuration.textContent = formatDuration(savedReplay.duration || 0);
    try {
      replayChipUrl.textContent = new URL(savedReplay.url).hostname || savedReplay.url;
    } catch (_) {
      replayChipUrl.textContent = savedReplay.url || '';
    }
    replayChip.classList.add('show');
    btnScreenRec.disabled = true;
    replayWindowSel.disabled = true;
  } else {
    replayChip.classList.remove('show');
    // Only re-enable if not currently recording or in capture mode
    if (!isRecording) {
      btnScreenRec.disabled = false;
      replayWindowSel.disabled = false;
    }
  }
}
```

- [ ] **Step 3: Load chip state on init**

In the `init()` function, find:
```js
  const { qa_token, qa_user_email, qa_recording } = await chrome.storage.local.get([
    'qa_token', 'qa_user_email', 'qa_recording',
  ]);
```

Replace with:
```js
  const { qa_token, qa_user_email, qa_recording, qa_saved_replay } =
    await chrome.storage.local.get(['qa_token', 'qa_user_email', 'qa_recording', 'qa_saved_replay']);
```

Then after `applyRecordingState(actuallyRecording);`, add:
```js
  applyReplayChip(qa_saved_replay);
```

- [ ] **Step 4: Add storage.onChanged handlers for chip + replay status**

Find the existing `chrome.storage.onChanged.addListener` block:

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.qa_buffered_issues) refreshBufferUI();
  if (changes.qa_recording) {
    const rec = changes.qa_recording.newValue;
    applyRecordingState(!!rec);
  }
});
```

Replace with:

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.qa_buffered_issues) refreshBufferUI();
  if (changes.qa_recording) {
    applyRecordingState(!!changes.qa_recording.newValue);
  }
  if (changes.qa_screen_recording) {
    applyScreenRecordingState(!!changes.qa_screen_recording.newValue);
  }
  if (changes.qa_saved_replay) {
    applyReplayChip(changes.qa_saved_replay.newValue);
    // Show toast when a new recording is saved
    if (changes.qa_saved_replay.newValue?.data && !changes.qa_saved_replay.oldValue?.data) {
      const dur = formatDuration(changes.qa_saved_replay.newValue.duration || 0);
      showToast('Recording saved — ' + dur + ' captured', 'success', 4000);
    }
  }
  if (changes.qa_replay_status) {
    const status = changes.qa_replay_status.newValue;
    if (status === 'attached') {
      showToast('Bug submitted with replay attached ✓', 'success', 3500);
    } else if (status === 'skipped') {
      showToast('Bug submitted — replay was from a different tab, not attached', 'error', 5000);
    }
    // Clear the status signal
    if (status) chrome.storage.local.remove(['qa_replay_status']);
  }
});
```

- [ ] **Step 5: Add delete button handler**

Add after the `replayWindowSel.addEventListener` block:

```js
// ── Delete saved replay ───────────────────────────────────────────────────────
btnDeleteReplay.addEventListener('click', async function () {
  await chrome.storage.local.remove(['qa_saved_replay']);
  applyReplayChip(null);
  showToast('Recording deleted', 'success', 2500);
});
```

- [ ] **Step 6: Update countdown auto-stop to delegate to background**

Find the auto-stop block inside `startCountdown`:

```js
    if (remaining <= 0) {
      clearInterval(_screenRecIntervalId);
      _screenRecIntervalId = null;
      // Auto-stop screen recording
      await chrome.storage.local.set({ qa_screen_recording: false });
      applyScreenRecordingState(false);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
    }
```

Replace with:

```js
    if (remaining <= 0) {
      clearInterval(_screenRecIntervalId);
      _screenRecIntervalId = null;
      // Delegate to background — it will saveRecording, set qa_screen_recording: false,
      // and write qa_saved_replay. storage.onChanged will update our UI.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
    }
```

- [ ] **Step 7: Update manual Stop button click to not pre-set storage**

Find the `btnScreenRec` click handler. The `else` branch (stopping) currently does:
```js
  } else {
    applyScreenRecordingState(false);
    await chrome.storage.local.set({ qa_screen_recording: false });
    chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
  }
```

Replace with:
```js
  } else {
    // Let background handle state — it calls saveRecording then sets qa_screen_recording: false
    // storage.onChanged will fire applyScreenRecordingState(false) for us
    chrome.runtime.sendMessage({ type: 'STOP_SCREEN_RECORDING', tabId: tab.id });
  }
```

- [ ] **Step 8: Syntax check**

```bash
node --check extension/sidepanel.js
```

Expected: no output (clean).

- [ ] **Step 9: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): recording chip, delete button, replay status toasts, delegate stop to background"
```

---

---

### Task 6: Per-tab capture session — hover UI scoped to the tab it started on

**Problem:** `qa_recording` is a global boolean. `stopRecording()` in sidepanel.js sends `STOP_REPORTING` to whatever tab is currently active — not the tab recording was started on. The keyboard shortcut has the same bug. If a user starts capture on Tab A then switches to Tab B, stopping sends `STOP_REPORTING` to Tab B (which has no hover UI active), and Tab A is left in a broken state.

**Fix:** Store `qa_recording_tab_id` when capture starts. Always target that specific tab for `STOP_REPORTING`, regardless of which tab is currently visible.

**Files:**
- Modify: `extension/sidepanel.js` — store `qa_recording_tab_id` on start; target it on stop; clear on sign-out
- Modify: `extension/background.js` — keyboard shortcut uses `qa_recording_tab_id` for both start and stop

**Interfaces:**
- Produces: `qa_recording_tab_id: number | null` in storage — the tab that has hover UI active

- [ ] **Step 1: sidepanel.js — store qa_recording_tab_id when capture starts**

In `startRecording()`, find:
```js
    await chrome.storage.local.set({ qa_recording: true });
    applyRecordingState(true);
```

Replace with:
```js
    await chrome.storage.local.set({ qa_recording: true, qa_recording_tab_id: tab.id });
    applyRecordingState(true);
```

- [ ] **Step 2: sidepanel.js — target the recorded tab when stopping**

In `stopRecording()`, find:
```js
async function stopRecording() {
  btnToggleRecording.disabled = true;
  try {
    await sendToActiveTab({ type: 'STOP_REPORTING' });
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
    await refreshBufferUI();
  } catch (_) {
    await chrome.storage.local.set({ qa_recording: false });
    applyRecordingState(false);
    await refreshBufferUI();
  } finally {
    btnToggleRecording.disabled = false;
  }
}
```

Replace with:
```js
async function stopRecording() {
  btnToggleRecording.disabled = true;
  try {
    const { qa_recording_tab_id } = await chrome.storage.local.get(['qa_recording_tab_id']);
    if (qa_recording_tab_id) {
      try { await chrome.tabs.sendMessage(qa_recording_tab_id, { type: 'STOP_REPORTING' }); } catch (_) {}
    }
    await chrome.storage.local.set({ qa_recording: false, qa_recording_tab_id: null });
    applyRecordingState(false);
    await refreshBufferUI();
  } catch (_) {
    await chrome.storage.local.set({ qa_recording: false, qa_recording_tab_id: null });
    applyRecordingState(false);
    await refreshBufferUI();
  } finally {
    btnToggleRecording.disabled = false;
  }
}
```

- [ ] **Step 3: sidepanel.js — clear qa_recording_tab_id on sign-out**

In `btnSignout` click handler, find:
```js
  await chrome.storage.local.remove([
    'qa_token', 'qa_refresh_token', 'qa_user_email', 'qa_recording',
    'qa_buffered_issues', 'qa_selected_project',
  ]);
```

Replace with:
```js
  await chrome.storage.local.remove([
    'qa_token', 'qa_refresh_token', 'qa_user_email', 'qa_recording',
    'qa_recording_tab_id', 'qa_buffered_issues', 'qa_selected_project',
  ]);
```

- [ ] **Step 4: background.js — keyboard shortcut uses qa_recording_tab_id**

Find the keyboard shortcut handler:
```js
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recording') return;

  const { qa_token: token, qa_recording: recording } = await chrome.storage.local.get(['qa_token', 'qa_recording']);
  if (!token) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (recording) {
    // Stop recording
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_REPORTING' }); } catch (_) {}
    // Stop replay recorder if active
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RELAY' }); } catch (_) {}
    await chrome.storage.local.set({ qa_recording: false });
  } else {
    // Sync settings then start recording
    await handleSyncSettings(() => {});
    await chrome.storage.local.set({ qa_recording: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      try { await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' }); } catch (_) {}
    }
  }
});
```

Replace with:
```js
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recording') return;

  const { qa_token: token, qa_recording: recording, qa_recording_tab_id: recordingTabId } =
    await chrome.storage.local.get(['qa_token', 'qa_recording', 'qa_recording_tab_id']);
  if (!token) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  if (recording) {
    // Always stop the tab that capture was started on, not the current active tab
    const targetTabId = recordingTabId || activeTab.id;
    try { await chrome.tabs.sendMessage(targetTabId, { type: 'STOP_REPORTING' }); } catch (_) {}
    try { await chrome.tabs.sendMessage(targetTabId, { type: 'STOP_REPLAY' }); } catch (_) {}
    await chrome.storage.local.set({ qa_recording: false, qa_recording_tab_id: null });
  } else {
    // Start on the currently active tab
    await handleSyncSettings(() => {});
    await chrome.storage.local.set({ qa_recording: true, qa_recording_tab_id: activeTab.id });
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'START_REPORTING' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['content-styles.css'] });
      await new Promise(r => setTimeout(r, 300));
      try { await chrome.tabs.sendMessage(activeTab.id, { type: 'START_REPORTING' }); } catch (_) {}
    }
  }
});
```

- [ ] **Step 5: Syntax check both files**

```bash
node --check extension/sidepanel.js && node --check extension/background.js
```

Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js extension/background.js
git commit -m "fix(extension): scope capture hover UI to the tab it was started on (qa_recording_tab_id)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Recording stops manually → saveRecording → chip (Task 2 + 5)
- ✅ Recording stops on timer → STOP_SCREEN_RECORDING → saveRecording → chip (Task 2 + 5)
- ✅ Tab switch → visibilitychange → AUTO_STOP_RECORDING → saveRecording → chip (Task 1 + 2 + 5)
- ✅ Start button disabled while chip exists (Task 5 `applyReplayChip`)
- ✅ Delete chip → re-enables button (Task 5)
- ✅ Capture bug same tab → auto-save in handleCaptureScreenshot → postIssue attaches (Task 2 + 3)
- ✅ Capture bug different tab → skipped, toast (Task 3 + 5)
- ✅ No saved replay → submit normally, no error (Task 3)
- ✅ Toast at every meaningful state change (Task 5)
- ✅ `qa_saved_replay` cleared after successful attach (Task 3)
- ✅ Hover UI scoped to tab it was started on — stop always targets `qa_recording_tab_id` (Task 6)
- ✅ Keyboard shortcut stops the correct tab regardless of which tab is active (Task 6)
- ✅ `qa_recording_tab_id` cleared on sign-out (Task 6)

**Placeholder scan:** Clean — all steps have complete code.

**Type consistency:**
- `qa_saved_replay` shape `{ data, url, tabId, duration, recordedAt }` used consistently across Task 2 (writer) and Task 5 (reader)
- `saveRecording(tabId)` signature matches all call sites in Task 2
- `applyReplayChip(savedReplay | null)` matches all call sites in Task 5
- `formatDuration(seconds)` defined in Task 5 before use in `startCountdown` — both in same file, order is fine since `startCountdown` is called asynchronously
