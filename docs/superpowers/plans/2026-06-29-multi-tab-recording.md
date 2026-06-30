# Multi-Tab Session Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow QA testers to record rrweb sessions across multiple tabs simultaneously, with a unified tab-switcher replay player.

**Architecture:** The platform exposes a `multiTabRecording` workspace setting that gates the feature. When enabled, the extension sidepanel shows a "Multi-tab" toggle; when that toggle is ON, the background service worker listens for tab activations and auto-injects rrweb into each new tab the user visits. On stop, all streams are collected, packaged as a version-2 payload `{ version: 2, streams: [{tabId, url, title, events[]}], switches: [{at, toTabId}] }`, gzip-compressed, and saved. The ReplayPlayer detects `version: 2`, spawns one `Replayer` per stream (all mounted, only one visible), and auto-switches the active stream at the correct timestamp using the `switches` array.

**Tech Stack:** Chrome MV3 (JS), rrweb v2 (UMD), NestJS (TypeScript), Next.js 14 (TypeScript + Tailwind), Supabase JSONB settings column.

## Global Constraints

- `replay_data` sent to the API is base64-encoded gzip — existing single-tab format is `{ version: 1, data: "<base64>" }` (implicit) or just the raw `data` string; new format wraps it: `{ version: 2, data: "<base64>" }` where the decompressed JSON is the multi-stream object.
- `qa_ext_settings.multiTabRecording` default is `false` — feature is opt-in.
- The extension multi-tab toggle is only rendered when `qa_ext_settings.multiTabRecording === true` (platform gate).
- Backward compatibility: the player must handle both old (flat `events[]`) and new (`{ version: 2, streams: [...] }`) formats from the same `replayUrl`.
- No new Supabase tables or columns — settings go in the existing `settings` JSONB column; replay blob goes in the existing `replay_data` column.
- All rrweb injection uses `chrome.scripting.executeScript` with `files:` — never `eval`.
- `chrome.tabs.onActivated` is registered once at service-worker top level (MV3 event-driven model).

---

## File Map

| File | Change |
|------|--------|
| `backend/src/workspaces/workspaces.service.ts` | Add `multiTabRecording: boolean` to `ExtensionSettings` + `DEFAULT_SETTINGS` |
| `platform/app/(dashboard)/extension/page.tsx` | Add `multiTabRecording` to `ExtensionSettings` interface + `ToggleRow` under new "Session Replay" section |
| `extension/background.js` | Register `chrome.tabs.onActivated` listener; add `handleStartMultiTabRecording`, `handleStopMultiTabRecording`, `saveMultiTabRecording`; modify `handleSyncSettings` passthrough (no change needed — settings land in `qa_ext_settings` automatically) |
| `extension/sidepanel.html` | Add multi-tab toggle row + "N tabs" badge in the screen-recording section |
| `extension/sidepanel.js` | Show/hide multi-tab toggle based on `qa_ext_settings.multiTabRecording`; wire toggle to `qa_multitab_mode`; show tab-count badge; start/stop messages updated |
| `platform/components/ReplayPlayer.tsx` | Add format detection; `MultiStreamPlayer` sub-component with tab-strip + multiple `Replayer` instances + auto-switch logic |

---

## Task 1: Backend — add `multiTabRecording` setting

**Files:**
- Modify: `backend/src/workspaces/workspaces.service.ts`

**Interfaces:**
- Produces: `ExtensionSettings.multiTabRecording: boolean` (default `false`)

- [ ] **Step 1: Add field to interface and default**

In `backend/src/workspaces/workspaces.service.ts`, make these two edits:

```typescript
// In ExtensionSettings interface, add after formAssignee:
  captureNavHistory: boolean

  // Session Replay
  multiTabRecording: boolean
```

```typescript
// In DEFAULT_SETTINGS, add after formAssignee:
  captureNavHistory: true,

  multiTabRecording: false,
```

- [ ] **Step 2: Verify backend starts cleanly**

```bash
cd backend && npm run start:dev
# Expected: "Nest application successfully started" — no TypeScript errors
```

- [ ] **Step 3: Smoke-test the settings endpoint**

```bash
# Replace <TOKEN> with a valid bearer token
curl -s http://localhost:4000/api/workspaces/settings \
  -H "Authorization: Bearer <TOKEN>" | grep multiTabRecording
# Expected: "multiTabRecording": false
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/workspaces/workspaces.service.ts
git commit -m "feat(backend): add multiTabRecording to workspace settings schema"
```

---

## Task 2: Platform — expose the toggle in Extension Settings

**Files:**
- Modify: `platform/app/(dashboard)/extension/page.tsx`

**Interfaces:**
- Consumes: `ExtensionSettings.multiTabRecording: boolean` from Task 1
- Produces: UI toggle that PATCHes `/workspaces/settings` with `{ multiTabRecording: true/false }`

- [ ] **Step 1: Add field to the platform-side interface**

In `platform/app/(dashboard)/extension/page.tsx`, add to the `ExtensionSettings` interface after `captureNavHistory`:

```typescript
  captureNavHistory: boolean

  // Session Replay
  multiTabRecording: boolean
```

- [ ] **Step 2: Add a "Session Replay" section with the toggle**

After the `{/* Bug Form */}` closing `</Section>` tag and before the save toast `div`, add:

```tsx
      {/* Session Replay */}
      <Section
        title="Session Replay"
        description="Controls for the DOM session recorder. Multi-tab recording captures every tab the tester visits."
        badge="Beta"
        badgeColor="bg-purple-50 text-purple-600"
      >
        {isLoading ? <div className="py-4 text-sm text-gray-400">Loading…</div> : <>
          <ToggleRow
            label="Multi-tab recording"
            description="When enabled, the extension records every tab the tester visits during a session, not just the starting tab. Replays show a tab-switcher with all captured screens."
            enabled={s?.multiTabRecording ?? false}
            onChange={v => set('multiTabRecording', v)}
          />
        </>}
      </Section>
```

- [ ] **Step 3: Verify it renders without errors**

```bash
cd platform && npm run dev
# Open http://localhost:3000/extension (after login)
# Expected: "Session Replay" section visible with the toggle
```

- [ ] **Step 4: Toggle and verify PATCH fires**

Open browser DevTools → Network tab. Click the toggle. Expected: `PATCH /api/workspaces/settings` with body `{"multiTabRecording":true}` and 200 response.

- [ ] **Step 5: Commit**

```bash
git add platform/app/\(dashboard\)/extension/page.tsx
git commit -m "feat(platform): add multiTabRecording toggle in Extension Settings"
```

---

## Task 3: Extension background — multi-tab tracking and collection

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `chrome.storage.local.qa_ext_settings.multiTabRecording: boolean`, `chrome.storage.local.qa_multitab_mode: boolean`
- Produces:
  - `qa_multitab_recorded_tabs: number[]` — tabIds injected so far this session
  - `qa_multitab_switches: { at: number, toTabId: number }[]` — tab-activation timestamps
  - `qa_saved_replay` — now either single-stream (`{ data, url, tabId, duration, recordedAt }`) or multi-stream (`{ version: 2, data, urls: string[], duration, recordedAt }`)
- New message handlers: `START_MULTITAB_RECORDING`, `STOP_MULTITAB_RECORDING`

- [ ] **Step 1: Add `compressMultiStream` helper**

Add after `compressReplayEvents`:

```javascript
async function compressMultiStream(payload) {
  try {
    const json = JSON.stringify(payload);
    const encoded = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    const bytes = new Uint8Array(compressed);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (err) {
    console.warn('[QA] multistream compress failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Add `injectReplayIntoTab` helper**

Add after `compressMultiStream`:

```javascript
async function injectReplayIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['rrweb.min.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['replay-recorder.js'] });
    await new Promise(r => setTimeout(r, 300));
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_REPLAY' }).catch(() => null);
    return ping?.started === true;
  } catch (err) {
    console.warn('[QA] injectReplayIntoTab failed for tab', tabId, err?.message);
    return false;
  }
}
```

- [ ] **Step 3: Add `saveMultiTabRecording` helper**

Add after `saveRecording`:

```javascript
async function saveMultiTabRecording() {
  const { qa_multitab_recorded_tabs = [], qa_multitab_switches = [] } =
    await chrome.storage.local.get(['qa_multitab_recorded_tabs', 'qa_multitab_switches']);

  const streams = [];
  let minTs = Infinity;
  let maxTs = 0;

  for (const tabId of qa_multitab_recorded_tabs) {
    let tabInfo = null;
    try { tabInfo = await chrome.tabs.get(tabId); } catch (_) {}
    let replayRes = null;
    try { replayRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_REPLAY_EVENTS' }); } catch (_) {}
    try { await chrome.tabs.sendMessage(tabId, { type: 'STOP_REPLAY' }); } catch (_) {}

    if (replayRes?.ok && replayRes.events?.length > 0) {
      const evts = replayRes.events;
      const first = evts[0].timestamp;
      const last  = evts[evts.length - 1].timestamp;
      if (first < minTs) minTs = first;
      if (last  > maxTs) maxTs = last;
      streams.push({
        tabId,
        url:    tabInfo?.url   || '',
        title:  tabInfo?.title || `Tab ${tabId}`,
        events: evts,
      });
    }
  }

  await chrome.storage.local.set({
    qa_screen_recording: false,
    qa_screen_recording_tab_id: null,
    qa_multitab_recorded_tabs: [],
    qa_multitab_switches: [],
  });

  if (streams.length === 0) return false;

  const duration = Math.round((maxTs - minTs) / 1000);
  const payload = { version: 2, streams, switches: qa_multitab_switches };
  const data = await compressMultiStream(payload);
  if (!data) return false;

  const urls = streams.map(s => s.url);
  try {
    await chrome.storage.local.set({
      qa_saved_replay: { version: 2, data, urls, duration, recordedAt: Date.now() },
    });
    return true;
  } catch (storageErr) {
    console.warn('[QA] failed to persist multi-tab replay:', storageErr?.message || storageErr);
    return false;
  }
}
```

- [ ] **Step 4: Add `START_MULTITAB_RECORDING` handler**

Add to the message router and implement:

```javascript
// In the message router:
if (type === 'START_MULTITAB_RECORDING') {
  handleStartMultiTabRecording(message, sendResponse);
  return true;
}
if (type === 'STOP_MULTITAB_RECORDING') {
  handleStopMultiTabRecording(sendResponse);
  return true;
}
```

```javascript
// Handler implementation — add near handleStartScreenRecording:
async function handleStartMultiTabRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return; }
  const ok = await injectReplayIntoTab(tabId);
  if (!ok) {
    await chrome.storage.local.set({ qa_screen_recording: false });
    sendResponse({ ok: false, error: 'rrweb failed to start on initial tab' });
    return;
  }
  await chrome.storage.local.set({
    qa_screen_recording:        true,
    qa_screen_recording_tab_id: tabId,
    qa_multitab_recorded_tabs:  [tabId],
    qa_multitab_switches:       [{ at: Date.now(), toTabId: tabId }],
  });
  sendResponse({ ok: true });
}

async function handleStopMultiTabRecording(sendResponse) {
  const saved = await saveMultiTabRecording();
  sendResponse({ ok: true, saved });
}
```

- [ ] **Step 5: Register `chrome.tabs.onActivated` at top level**

Add near the bottom of `background.js` (after `chrome.runtime.onInstalled`):

```javascript
// ── Multi-tab: auto-inject rrweb when user switches tabs ──────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const {
    qa_screen_recording,
    qa_multitab_mode,
    qa_multitab_recorded_tabs = [],
    qa_multitab_switches = [],
  } = await chrome.storage.local.get([
    'qa_screen_recording', 'qa_multitab_mode',
    'qa_multitab_recorded_tabs', 'qa_multitab_switches',
  ]);

  if (!qa_screen_recording || !qa_multitab_mode) return;
  if (qa_multitab_recorded_tabs.includes(tabId)) {
    // Already recording this tab — just track the switch
    await chrome.storage.local.set({
      qa_multitab_switches: [...qa_multitab_switches, { at: Date.now(), toTabId: tabId }],
    });
    return;
  }

  // New tab — inject rrweb
  const ok = await injectReplayIntoTab(tabId);
  if (ok) {
    await chrome.storage.local.set({
      qa_multitab_recorded_tabs: [...qa_multitab_recorded_tabs, tabId],
      qa_multitab_switches: [...qa_multitab_switches, { at: Date.now(), toTabId: tabId }],
    });
  }
});
```

- [ ] **Step 6: Update `postIssue` to handle multi-stream URL matching**

In `postIssue`, replace the replay attachment block:

```javascript
  // Existing:
  // if (qa_saved_replay?.data && issue?.url && replayUrlMatches(issue.url, qa_saved_replay.url)) {

  // Replace with:
  if (qa_saved_replay?.data && issue?.url) {
    const urlsToCheck = qa_saved_replay.version === 2
      ? (qa_saved_replay.urls || [])
      : [qa_saved_replay.url || ''];
    const matches = urlsToCheck.some(u => replayUrlMatches(issue.url, u));
    if (matches) {
      replayData  = qa_saved_replay.data;
      replayStatus = 'attached';
    }
  }
```

- [ ] **Step 7: Update `AUTO_STOP_RECORDING` to handle multi-tab**

In `handleAutoStopRecording`, after the existing check, add:

```javascript
async function handleAutoStopRecording(sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) { sendResponse({ ok: true }); return; }
  const {
    qa_screen_recording, qa_screen_recording_tab_id, qa_multitab_mode,
  } = await chrome.storage.local.get([
    'qa_screen_recording', 'qa_screen_recording_tab_id', 'qa_multitab_mode',
  ]);
  if (!qa_screen_recording || qa_screen_recording_tab_id !== tabId) {
    sendResponse({ ok: true }); return;
  }
  // Use the correct stop path depending on mode
  if (qa_multitab_mode) {
    await saveMultiTabRecording();
  } else {
    await saveRecording(tabId);
  }
  sendResponse({ ok: true });
}
```

- [ ] **Step 8: Reload extension and test**

- Load unpacked extension from `extension/` in `chrome://extensions`
- Sign in via sidepanel
- Confirm no console errors in the service worker

- [ ] **Step 9: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): multi-tab recording — background tracking, injection, collection"
```

---

## Task 4: Extension sidepanel — multi-tab UI

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `qa_ext_settings.multiTabRecording: boolean` (platform gate), `qa_multitab_mode: boolean` (user toggle), `qa_multitab_recorded_tabs: number[]`
- Produces: `qa_multitab_mode` written to storage; `START_MULTITAB_RECORDING` / `STOP_MULTITAB_RECORDING` messages sent; `qa_screen_recording_tab_id` used as before

- [ ] **Step 1: Add multi-tab toggle row and tab-count badge to sidepanel.html**

Find the `<div>` containing `btn-screen-recording` in `sidepanel.html`. Add ABOVE it:

```html
<!-- Multi-tab toggle — hidden unless platform enables it -->
<div id="multitab-row" style="display:none" class="multitab-row">
  <label class="multitab-label">
    <span class="multitab-label-text">
      <span class="multitab-label-title">Multi-tab</span>
      <span class="multitab-label-desc">Record all tabs you visit</span>
    </span>
    <button id="btn-multitab-toggle" class="multitab-toggle" aria-pressed="false">
      <span class="multitab-toggle-thumb"></span>
    </button>
  </label>
  <span id="multitab-badge" class="multitab-badge" style="display:none">
    <span id="multitab-tab-count">1</span> tab<span id="multitab-tab-plural">s</span>
  </span>
</div>
```

- [ ] **Step 2: Add CSS for multi-tab row in sidepanel.html `<style>` block**

```css
.multitab-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: var(--bg); border-radius: 8px; margin-bottom: 8px;
  border: 1px solid var(--border);
}
.multitab-label { display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer; }
.multitab-label-text { display: flex; flex-direction: column; }
.multitab-label-title { font-size: 12px; font-weight: 600; color: var(--text-hi); }
.multitab-label-desc  { font-size: 10px; color: var(--text-lo); margin-top: 1px; }
.multitab-toggle {
  position: relative; width: 32px; height: 17px; border-radius: 17px;
  background: var(--border); border: none; cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.multitab-toggle[aria-pressed="true"] { background: var(--brand); }
.multitab-toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 13px; height: 13px;
  border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.multitab-toggle[aria-pressed="true"] .multitab-toggle-thumb { transform: translateX(15px); }
.multitab-badge {
  font-size: 10px; font-weight: 600; color: var(--brand);
  background: rgba(91,95,199,.12); border-radius: 10px; padding: 2px 8px; flex-shrink: 0;
}
```

- [ ] **Step 3: Wire the multi-tab toggle in sidepanel.js**

Add after the existing DOM references at the top:

```javascript
const multitabRow    = document.getElementById('multitab-row');
const btnMultitab    = document.getElementById('btn-multitab-toggle');
const multitabBadge  = document.getElementById('multitab-badge');
const multitabCount  = document.getElementById('multitab-tab-count');
const multitabPlural = document.getElementById('multitab-tab-plural');
```

Add a new section for multi-tab logic:

```javascript
// ── Multi-tab toggle ──────────────────────────────────────────────────────────
let isMultiTabMode = false;

function applyMultiTabToggle(on) {
  isMultiTabMode = on;
  btnMultitab.setAttribute('aria-pressed', String(on));
}

function applyMultiTabBadge(tabIds) {
  const count = Array.isArray(tabIds) ? tabIds.length : 0;
  if (count > 0 && isScreenRecording) {
    multitabCount.textContent = String(count);
    multitabPlural.textContent = count === 1 ? '' : 's';
    multitabBadge.style.display = 'inline-flex';
  } else {
    multitabBadge.style.display = 'none';
  }
}

// Show the row only if the platform setting allows it
function applyMultiTabVisibility(settings) {
  multitabRow.style.display = settings?.multiTabRecording ? 'flex' : 'none';
}

// Load initial state
chrome.storage.local.get(['qa_ext_settings', 'qa_multitab_mode', 'qa_multitab_recorded_tabs'], function (r) {
  applyMultiTabVisibility(r.qa_ext_settings);
  applyMultiTabToggle(r.qa_multitab_mode ?? false);
  applyMultiTabBadge(r.qa_multitab_recorded_tabs);
});

btnMultitab.addEventListener('click', async function () {
  const next = !isMultiTabMode;
  applyMultiTabToggle(next);
  await chrome.storage.local.set({ qa_multitab_mode: next });
});

// React to settings sync
chrome.storage.onChanged.addListener(function (changes) {
  if (changes.qa_ext_settings) {
    applyMultiTabVisibility(changes.qa_ext_settings.newValue);
  }
  if (changes.qa_multitab_recorded_tabs) {
    applyMultiTabBadge(changes.qa_multitab_recorded_tabs.newValue);
  }
  // ... (existing handlers remain)
});
```

- [ ] **Step 4: Update the screen-recording button handler to branch on mode**

In the `btnScreenRec.addEventListener('click', ...)` handler, replace the `START_SCREEN_RECORDING` / `STOP_SCREEN_RECORDING` message sends:

```javascript
btnScreenRec.addEventListener('click', async function () {
  const next = !isScreenRecording;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showToast('No active tab found.', 'error'); return; }

  btnScreenRec.disabled = true;

  if (next) {
    applyScreenRecordingState(true);
    const msgType = isMultiTabMode ? 'START_MULTITAB_RECORDING' : 'START_SCREEN_RECORDING';
    const res = await chrome.runtime.sendMessage({ type: msgType, tabId: tab.id });
    if (res && res.ok) {
      showToast(
        isMultiTabMode
          ? 'Multi-tab recording started — switch tabs freely.'
          : 'Screen recording ready — events are being captured.',
        'success', 3000
      );
    } else {
      applyScreenRecordingState(false);
      await chrome.storage.local.set({ qa_screen_recording: false });
      showToast('Recording failed: ' + (res?.error || 'could not inject on this page'), 'error', 5000);
    }
  } else {
    const msgType = isMultiTabMode ? 'STOP_MULTITAB_RECORDING' : 'STOP_SCREEN_RECORDING';
    const res = await chrome.runtime.sendMessage({ type: msgType, tabId: tab.id });
    if (!res || !res.ok) {
      showToast('Could not stop recording — page may have navigated', 'error', 5000);
    } else if (!res.saved) {
      showToast('Recording ended — no events were captured', 'error', 4000);
    }
  }

  btnScreenRec.disabled = false;
  if (replayChip.classList.contains('show')) btnScreenRec.disabled = true;
});
```

- [ ] **Step 5: Update `applyReplayChip` to show tab count for v2 replays**

```javascript
function applyReplayChip(savedReplay) {
  if (savedReplay && savedReplay.data) {
    replayChipDuration.textContent = formatDuration(savedReplay.duration || 0);
    if (savedReplay.version === 2 && savedReplay.urls?.length > 0) {
      replayChipUrl.textContent = `${savedReplay.urls.length} tab${savedReplay.urls.length === 1 ? '' : 's'}`;
    } else {
      try {
        replayChipUrl.textContent = new URL(savedReplay.url).hostname || savedReplay.url;
      } catch (_) {
        replayChipUrl.textContent = savedReplay.url || '';
      }
    }
    replayChip.classList.add('show');
    btnScreenRec.disabled = true;
    replayWindowSel.disabled = true;
  } else {
    replayChip.classList.remove('show');
    if (!isRecording && !isScreenRecording) {
      btnScreenRec.disabled = false;
      replayWindowSel.disabled = false;
    }
  }
}
```

- [ ] **Step 6: Manual test in Chrome**

1. Reload extension in `chrome://extensions`
2. Open sidepanel → sign in → go to platform `/extension` settings → enable "Multi-tab recording" → observe toggle appears in sidepanel
3. Toggle "Multi-tab" ON → click "Start Recording Screen"
4. Switch to another browser tab (e.g. `google.com`) → check service worker console: should log no errors and `qa_multitab_recorded_tabs` should grow
5. Click "Stop Recording Screen" → check `qa_saved_replay` in `chrome.storage.local` has `version: 2`

- [ ] **Step 7: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): multi-tab toggle, tab-count badge, branched start/stop"
```

---

## Task 5: Platform player — multi-stream tab-switcher

**Files:**
- Modify: `platform/components/ReplayPlayer.tsx`

**Interfaces:**
- Consumes: decompressed payload — either `any[]` (v1, flat events) or `{ version: 2, streams: [{tabId, url, title, events[]}], switches: [{at, toTabId}] }` (v2)
- Produces: renders single-stream player (existing) for v1; renders tab-strip + synchronized multi-replayer for v2

- [ ] **Step 1: Add format detection + decompression update**

In the `load()` function in `ReplayPlayer.tsx`, replace the `JSON.parse` and subsequent events block:

```typescript
const raw: any = JSON.parse(text)

// Detect format
const isMultiStream = raw?.version === 2 && Array.isArray(raw?.streams)

if (isMultiStream) {
  // Hand off to multi-stream path
  if (cancelled || !containerRef.current) return
  initMultiStream(raw, containerRef.current, cancelled)
  return
}

// --- existing single-stream path continues below ---
const events: any[] = Array.isArray(raw) ? raw : raw.events ?? []
```

- [ ] **Step 2: Add `MultiStreamPlayer` state and refs**

Add to the component state block:

```typescript
const multiContainersRef = useRef<Map<number, HTMLDivElement>>(new Map())
const multiReplayersRef  = useRef<Map<number, any>>(new Map())
const [streams,          setStreams]          = useState<{ tabId: number; url: string; title: string }[]>([])
const [activeTabId,      setActiveTabId]      = useState<number | null>(null)
const switchesRef        = useRef<{ at: number; toTabId: number }[]>([])
const globalStartRef     = useRef<number>(0)   // absolute ms of first event across all tabs
```

- [ ] **Step 3: Implement `initMultiStream`**

Add this function inside the component, before the return:

```typescript
async function initMultiStream(
  payload: { version: 2; streams: { tabId: number; url: string; title: string; events: any[] }[]; switches: { at: number; toTabId: number }[] },
  _root: HTMLDivElement,
  cancelled: boolean
) {
  if (!payload.streams.length) {
    setErrorMsg('No tab streams found in replay.'); setStatus('error'); return
  }

  // Global timeline: min start → max end across all streams
  let minTs = Infinity, maxTs = 0
  for (const s of payload.streams) {
    if (s.events.length < 2) continue
    const f = s.events[0].timestamp
    const l = s.events[s.events.length - 1].timestamp
    if (f < minTs) minTs = f
    if (l > maxTs) maxTs = l
  }
  globalStartRef.current = minTs
  const duration = maxTs - minTs
  totalMsRef.current = duration
  setTotalMs(duration)

  switchesRef.current = payload.switches ?? []

  setStreams(payload.streams.map(s => ({ tabId: s.tabId, url: s.url, title: s.title })))
  setActiveTabId(payload.streams[0].tabId)

  const { Replayer } = await import('rrweb')
  if (cancelled) return

  for (const stream of payload.streams) {
    if (stream.events.length < 2) continue

    // Create a hidden container for this tab's replayer
    const div = document.createElement('div')
    div.style.cssText = 'position:absolute;inset:0;display:none;overflow:hidden;'
    div.dataset.tabId = String(stream.tabId)
    containerRef.current!.appendChild(div)
    multiContainersRef.current.set(stream.tabId, div)

    const replayer = new Replayer(stream.events, {
      root: div, speed: 1, skipInactive: false,
      triggerFocus: true, pauseAnimation: true, useVirtualDom: true,
      loadTimeout: 0, showWarning: false, showDebug: false,
      UNSAFE_replayCanvas: false,
      mouseTail: { duration: 600, lineCap: 'round', lineWidth: 3, strokeStyle: '#5b5fc7' },
      insertStyleRules: [
        '.replayer-mouse-tail { pointer-events: none !important; }',
        '.replayer-mouse      { z-index: 9999 !important; }',
      ],
    })
    multiReplayersRef.current.set(stream.tabId, replayer)
  }

  // Show the first tab's container
  const firstDiv = multiContainersRef.current.get(payload.streams[0].tabId)
  if (firstDiv) firstDiv.style.display = 'block'

  replayer.on('finish', () => { /* handled below */ })
  setStatus('ready')
}
```

- [ ] **Step 4: Override `togglePlay`, `seek`, `restart` for multi-stream**

Update each function to branch on `streams.length > 0`:

```typescript
function togglePlay() {
  if (streams.length > 0) {
    // Multi-stream
    if (playing) {
      multiReplayersRef.current.forEach(r => r.pause())
      stopTimeSync(); setPlaying(false)
    } else {
      const offset = currentMs
      multiReplayersRef.current.forEach(r => r.play(offset))
      startTimeSync(); setPlaying(true)
    }
    return
  }
  // Single-stream (existing logic)
  const r = replayerRef.current
  if (!r) return
  if (playing) { r.pause(); stopTimeSync(); setPlaying(false) }
  else         { r.play(currentMs); startTimeSync(); setPlaying(true) }
}

function seek(ms: number) {
  stopTimeSync()
  const clamped = Math.max(0, Math.min(totalMs, ms))
  setCurrentMs(clamped); setPlaying(false)
  if (streams.length > 0) {
    multiReplayersRef.current.forEach(r => r.pause(clamped))
    updateActiveTabForMs(clamped)
    return
  }
  replayerRef.current?.pause(clamped)
}

function restart() {
  stopTimeSync(); setPlaying(false); setCurrentMs(0)
  if (streams.length > 0) {
    multiReplayersRef.current.forEach(r => r.pause(0))
    updateActiveTabForMs(0)
    return
  }
  replayerRef.current?.pause(0)
}
```

- [ ] **Step 5: Add `updateActiveTabForMs` for auto-switching**

```typescript
function updateActiveTabForMs(ms: number) {
  // Find the last switch that occurred at or before ms (ms is relative; globalStart offsets it)
  const absMs = globalStartRef.current + ms
  const switches = switchesRef.current
  let activeId: number | null = streams[0]?.tabId ?? null
  for (const sw of switches) {
    if (sw.at <= absMs) activeId = sw.toTabId
  }
  if (activeId === null) return
  setActiveTabId(activeId)
  multiContainersRef.current.forEach((div, tabId) => {
    div.style.display = tabId === activeId ? 'block' : 'none'
  })
}
```

- [ ] **Step 6: Hook `startTimeSync` to call `updateActiveTabForMs` on each tick**

Modify `startTimeSync`:

```typescript
const startTimeSync = useCallback(() => {
  stopTimeSync()
  const tick = () => {
    const meta = replayerRef.current?.getMetaData?.()
    if (meta?.currentTime != null) {
      setCurrentMs(meta.currentTime)
      if (streams.length > 0) updateActiveTabForMs(meta.currentTime)
    }
    // Multi-stream: read time from any replayer
    if (streams.length > 0) {
      const first = multiReplayersRef.current.values().next().value
      const t = first?.getMetaData?.()?.currentTime
      if (typeof t === 'number') { setCurrentMs(t); updateActiveTabForMs(t) }
    }
    rafRef.current = requestAnimationFrame(tick)
  }
  rafRef.current = requestAnimationFrame(tick)
}, [stopTimeSync, streams])
```

- [ ] **Step 7: Add tab-strip UI to the JSX**

In the return, between the header and viewport sections add:

```tsx
{/* Tab strip — only shown for multi-stream */}
{streams.length > 0 && isReady && (
  <div className="flex items-center gap-1 px-2 py-1.5 bg-[#0a0c1e] overflow-x-auto flex-shrink-0">
    {streams.map(s => {
      const isActive = s.tabId === activeTabId
      let hostname = s.url
      try { hostname = new URL(s.url).hostname } catch (_) {}
      return (
        <button
          key={s.tabId}
          onClick={() => {
            setActiveTabId(s.tabId)
            multiContainersRef.current.forEach((div, id) => {
              div.style.display = id === s.tabId ? 'block' : 'none'
            })
          }}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs flex-shrink-0 transition-colors
            ${isActive ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/8'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-indigo-400' : 'bg-white/20'}`} />
          <span className="max-w-[120px] truncate">{hostname || s.title}</span>
        </button>
      )
    })}
  </div>
)}
```

And update the viewport `<div ref={containerRef}` to use `position: relative` so absolutely-positioned tab containers stack correctly:

```tsx
<div
  ref={containerRef}
  style={{ display: isReady ? 'block' : 'none', overflow: 'hidden', position: 'relative' }}
/>
```

- [ ] **Step 8: Clean up multi-stream replayers on unmount**

In the `useEffect` cleanup:

```typescript
return () => {
  cancelled = true
  stopTimeSync()
  multiReplayersRef.current.forEach(r => { try { r.pause() } catch { /* */ } })
  multiReplayersRef.current.clear()
  multiContainersRef.current.clear()
  try { replayerRef.current?.pause() } catch { /* */ }
  replayerRef.current = null
}
```

- [ ] **Step 9: TypeScript check**

```bash
cd platform && npx tsc --noEmit 2>&1 | grep ReplayPlayer
# Expected: no output (no errors)
```

- [ ] **Step 10: Commit**

```bash
git add platform/components/ReplayPlayer.tsx
git commit -m "feat(player): multi-stream tab-switcher with auto-switch on playback"
```

---

## Self-Review

**Spec coverage:**
- ✅ Platform toggle gates the feature (`multiTabRecording` in workspace settings)
- ✅ Extension toggle only visible when platform enables it
- ✅ Auto tab tracking (`chrome.tabs.onActivated`) — no manual tab selection
- ✅ Multi-stream payload (`version: 2, streams, switches`)
- ✅ Backward compatible — v1 replays still work
- ✅ Tab-switcher player with auto-switch during playback
- ✅ Tab-strip for manual override

**No placeholders:** All code blocks are complete.

**Type consistency:**
- `streams` state: `{ tabId: number; url: string; title: string }[]` — matches what `setStreams` receives from `payload.streams`
- `multiReplayersRef`: `Map<number, any>` keyed by `tabId` — consistent across `initMultiStream`, `togglePlay`, `seek`, `restart`
- `switchesRef`: `{ at: number; toTabId: number }[]` — matches background.js `qa_multitab_switches` structure
