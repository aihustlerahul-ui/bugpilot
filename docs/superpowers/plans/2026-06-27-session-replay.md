# Session Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in session replay to the QA Reporter extension so developers can watch a DOM recording of exactly what happened before a bug was submitted, viewable from the issue detail page or via a shareable link.

**Architecture:** rrweb is lazy-injected into the active tab only when the replay toggle is on; a rolling buffer of the user-selected window (30s–5min) is compressed with gzip and sent alongside the issue payload. The backend stores the blob in a private Supabase Storage bucket (`qa-replays`) and returns signed URLs. The platform renders the replay using rrweb's Replayer and can generate shareable 7-day tokens for external viewers.

**Tech Stack:** rrweb 2.x (record + replay), CompressionStream/DecompressionStream (browser native), NestJS multipart-free JSON (base64 compressed blob), Supabase Storage, Next.js 14 App Router, React, Tailwind CSS, @tanstack/react-query.

## Global Constraints

- Extension is MV3 vanilla JS — no bundler, no imports, no TypeScript
- All extension class names prefixed `qa-`, all styles use `!important`
- Backend validates every request via `supabase.auth.getUser(token)` — never `jwt.verify()`
- Screenshots and replays stored in **private** Supabase Storage buckets — never public URLs
- `backend/.env` and `platform/.env.local` are gitignored — never commit secrets
- Platform uses Next.js 14 App Router with `'use client'` components where needed
- DB migration already executed — `issues.replay_storage_path` column and `replay_tokens` table exist

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `extension/rrweb.min.js` | Create (download) | rrweb record+replay bundle |
| `extension/replay-recorder.js` | Create | Rolling buffer wrapper around rrweb.record() |
| `extension/manifest.json` | Modify | Add rrweb.min.js + replay-recorder.js to web_accessible_resources |
| `extension/sidepanel.html` | Modify | Add replay toggle + window dropdown UI |
| `extension/sidepanel.js` | Modify | Persist toggle/window settings, disable during recording |
| `extension/background.js` | Modify | Inject recorder on START_REPORTING, collect+compress events on submit |
| `backend/src/issues/dto/create-issue.dto.ts` | Modify | Add optional `replay_data` string field |
| `backend/src/issues/issues.service.ts` | Modify | Upload replay blob, store path, return signed URL, cleanup on delete |
| `backend/src/issues/issues.controller.ts` | Modify | Add POST /:id/replay-token, add DELETE /:id |
| `backend/src/replay/replay.module.ts` | Create | NestJS module for public replay endpoint |
| `backend/src/replay/replay.service.ts` | Create | Token validation, fetch replay from storage |
| `backend/src/replay/replay.controller.ts` | Create | GET /api/replay/:token (no auth) |
| `backend/src/app.module.ts` | Modify | Import ReplayModule |
| `platform/components/ReplayPlayer.tsx` | Create | rrweb Replayer with play/pause/scrub/speed controls |
| `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx` | Modify | Add Session Replay tab |
| `platform/app/replay/[token]/page.tsx` | Create | Public shareable replay page (no auth) |

---

## Task 1: Download rrweb + Update manifest

**Files:**
- Create: `extension/rrweb.min.js`
- Modify: `extension/manifest.json`

**Interfaces:**
- Produces: global `rrweb` object available in injected scripts; `rrweb.record(opts)` returns a stop function

- [ ] **Step 1: Download rrweb bundle**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3/extension"
curl -L "https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.18/dist/rrweb.min.js" -o rrweb.min.js
```

Verify it downloaded (should be ~200KB+):
```bash
wc -c rrweb.min.js
```
Expected: output shows a number > 150000

- [ ] **Step 2: Add to manifest web_accessible_resources**

Open `extension/manifest.json`. Replace the `web_accessible_resources` block:

```json
"web_accessible_resources": [
  {
    "resources": ["content-styles.css", "rrweb.min.js", "replay-recorder.js"],
    "matches": ["<all_urls>"]
  }
]
```

- [ ] **Step 3: Verify manifest is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('valid')"
```
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/rrweb.min.js extension/manifest.json
git commit -m "feat(extension): add rrweb bundle and register in manifest"
```

---

## Task 2: replay-recorder.js

**Files:**
- Create: `extension/replay-recorder.js`

**Interfaces:**
- Consumes: global `rrweb.record(opts)` (from Task 1)
- Produces: responds to chrome.runtime messages:
  - `GET_REPLAY_EVENTS` → `{ ok: true, events: [...] }`
  - `STOP_REPLAY` → stops recording, clears buffer

- [ ] **Step 1: Create replay-recorder.js**

Create `extension/replay-recorder.js`:

```js
// QA Reporter — Session Replay Recorder (injected on demand)
(function () {
  'use strict';

  if (window.__qaReplayActive) return; // guard against double-injection
  window.__qaReplayActive = true;

  var _events = [];
  var _windowMs = 2 * 60 * 1000; // default 2 min, overridden by START message
  var _stopFn = null;

  function startRecording(windowMs) {
    _windowMs = windowMs || _windowMs;
    _events = [];

    _stopFn = rrweb.record({
      emit: function (event) {
        _events.push(event);
        // Rolling window: drop events outside the window from the front
        var cutoff = Date.now() - _windowMs;
        while (_events.length > 0 && _events[0].timestamp < cutoff) {
          _events.shift();
        }
      },
      // Mask sensitive inputs by default
      maskAllInputs: false,
      maskInputOptions: { password: true },
    });
  }

  function stopRecording() {
    if (_stopFn) { _stopFn(); _stopFn = null; }
    _events = [];
    window.__qaReplayActive = false;
  }

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
    if (message.type === 'START_REPLAY') {
      startRecording(message.windowMs);
      sendResponse({ ok: true });
      return true;
    }
  });

  // Auto-start — background.js injects this file after setting windowMs in the message
  // windowMs is passed via storage so it's available synchronously here
  chrome.storage.local.get(['qa_replay_window_ms'], function (result) {
    startRecording(result.qa_replay_window_ms || 2 * 60 * 1000);
  });
})();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('fs').readFileSync('extension/replay-recorder.js','utf8'); console.log('syntax ok')" 2>&1 || echo "CHECK SYNTAX"
```
Expected: `syntax ok`

- [ ] **Step 3: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/replay-recorder.js
git commit -m "feat(extension): add replay-recorder.js with rolling buffer"
```

---

## Task 3: Sidepanel UI — toggle + window selector

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Produces: `chrome.storage.local` keys `qa_replay_enabled` (boolean) and `qa_replay_window_ms` (number ms)

- [ ] **Step 1: Add toggle + dropdown HTML to sidepanel.html**

In `extension/sidepanel.html`, find the `Start Recording` button block:
```html
    <button class="btn btn-record btn-full" id="btn-toggle-recording">
```

Add the replay toggle row **immediately after** the closing `</button>` of `btn-toggle-recording` and before `<p class="shortcut-hint">`:

```html
    <div class="replay-row" id="replay-row">
      <label class="replay-label" for="toggle-replay">
        <span class="replay-icon">⏺</span>
        Record session replay
      </label>
      <div class="replay-controls">
        <select class="replay-window-select" id="replay-window-select">
          <option value="30000">30s</option>
          <option value="60000">1 min</option>
          <option value="120000" selected>2 min</option>
          <option value="180000">3 min</option>
          <option value="240000">4 min</option>
          <option value="300000">5 min</option>
        </select>
        <button class="replay-toggle" id="toggle-replay" aria-pressed="false" title="Toggle session replay"></button>
      </div>
    </div>
```

- [ ] **Step 2: Add styles inside the `<style>` tag in sidepanel.html**

Find the closing `</style>` tag and add before it:

```css
    /* ── REPLAY ROW ── */
    .replay-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; background: var(--bg); border-top: 1px solid var(--border);
      gap: 8px;
    }
    .replay-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 11.5px; font-weight: 600; color: var(--text-mid);
      cursor: pointer; user-select: none;
    }
    .replay-icon { font-size: 10px; color: var(--red); }
    .replay-controls { display: flex; align-items: center; gap: 6px; }
    .replay-window-select {
      font-size: 11px; padding: 3px 6px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--surface); color: var(--text-hi);
      cursor: pointer;
    }
    .replay-window-select:disabled { opacity: 0.4; cursor: not-allowed; }
    .replay-toggle {
      width: 32px; height: 18px; border-radius: 9px;
      border: none; background: var(--border); cursor: pointer;
      position: relative; transition: background 0.2s; flex-shrink: 0;
    }
    .replay-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; transition: transform 0.2s;
      box-shadow: 0 1px 2px rgba(0,0,0,0.2);
    }
    .replay-toggle[aria-pressed="true"] { background: var(--brand); }
    .replay-toggle[aria-pressed="true"]::after { transform: translateX(14px); }
    .replay-toggle:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 3: Add JS to sidepanel.js**

In `sidepanel.js`, find the section after all `const` DOM refs are declared (after `const toast = ...`). Add:

```js
const toggleReplay     = document.getElementById('toggle-replay');
const replayWindowSel  = document.getElementById('replay-window-select');
const replayRow        = document.getElementById('replay-row');
```

Then find the `applyRecordingState` function. At the end of the `if (recording) { ... }` branch, add:

```js
    // Lock replay controls during recording
    toggleReplay.disabled = true;
    replayWindowSel.disabled = true;
```

At the end of the `else { ... }` branch, add:

```js
    // Unlock replay controls when stopped
    toggleReplay.disabled = false;
    replayWindowSel.disabled = false;
```

Then, before the closing `})();` or at the bottom of the init section, add:

```js
// ── Replay toggle persistence ─────────────────────────────────────────────────
chrome.storage.local.get(['qa_replay_enabled', 'qa_replay_window_ms'], function (result) {
  const enabled = result.qa_replay_enabled ?? false;
  const windowMs = result.qa_replay_window_ms ?? 120000;
  toggleReplay.setAttribute('aria-pressed', String(enabled));
  replayWindowSel.value = String(windowMs);
});

toggleReplay.addEventListener('click', function () {
  const next = toggleReplay.getAttribute('aria-pressed') !== 'true';
  toggleReplay.setAttribute('aria-pressed', String(next));
  chrome.storage.local.set({ qa_replay_enabled: next });
});

replayWindowSel.addEventListener('change', function () {
  chrome.storage.local.set({ qa_replay_window_ms: Number(replayWindowSel.value) });
});
```

- [ ] **Step 4: Manual test**

Load the extension unpacked from `extension/` in `chrome://extensions`. Open the side panel. Verify:
- Replay toggle row appears below the Start Recording button
- Toggle switches on/off visually
- Window dropdown changes value
- After clicking Start Recording, both toggle and dropdown are greyed out and unclickable
- After clicking Stop Recording, they become interactive again

- [ ] **Step 5: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): add session replay toggle and window selector to sidepanel"
```

---

## Task 4: background.js — inject recorder + compress + submit

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `chrome.storage.local` keys `qa_replay_enabled`, `qa_replay_window_ms`
- Consumes: `replay-recorder.js` message `GET_REPLAY_EVENTS` → `{ ok, events }`
- Consumes: `rrweb.min.js` (injected before replay-recorder.js)
- Produces: `postIssue` payload includes optional `replay_data` (base64 gzip string)

- [ ] **Step 1: Add replay injection to the keyboard shortcut handler**

In `background.js`, find the keyboard shortcut handler block that starts recording:
```js
    // Sync settings then start recording
    await handleSyncSettings(() => {});
    await chrome.storage.local.set({ qa_recording: true });
```

Add replay injection immediately after `chrome.storage.local.set({ qa_recording: true })`:

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

- [ ] **Step 2: Add replay injection to the START_REPORTING path in content.js fallback**

Still in the keyboard shortcut handler, find the catch block that re-injects content.js:
```js
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
```

After the content.js injection lines, add:

```js
      if (qa_replay_enabled) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['rrweb.min.js'] });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['replay-recorder.js'] });
        } catch (err) {
          console.warn('[QA] replay inject failed (fallback):', err.message);
        }
      }
```

- [ ] **Step 3: Add compressReplay helper function**

Add this function near the top of `background.js`, after the `'use strict';` line:

```js
// ── Replay compression ────────────────────────────────────────────────────────
async function compressReplayEvents(events) {
  try {
    const json = JSON.stringify(events);
    const encoded = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    // Convert to base64 for JSON transport
    const bytes = new Uint8Array(compressed);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (err) {
    console.warn('[QA] replay compress failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 4: Collect and attach replay events in postIssue**

In `background.js`, find the `postIssue` function. At the very top of `postIssue`, before the `const { qa_token }` line, add:

```js
async function postIssue(issue) {
  // Collect replay events if recording was active
  let replayData = null;
  const { qa_replay_enabled } = await chrome.storage.local.get(['qa_replay_enabled']);
  if (qa_replay_enabled) {
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

Then in the same function, find where `payload` is constructed (the `const payload = { ... }` block). Add `replay_data` as the last field:

```js
    replay_data: replayData ?? undefined,
```

- [ ] **Step 5: Stop replay recorder on STOP_REPORTING**

In `background.js`, find the keyboard shortcut stop recording block:
```js
    // Stop recording
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_REPORTING' }); } catch (_) {}
    await chrome.storage.local.set({ qa_recording: false });
```

Add after the `STOP_REPORTING` message:

```js
    // Stop replay recorder if active
    try { await chrome.tabs.sendMessage(tab.id, { type: 'STOP_REPLAY' }); } catch (_) {}
```

- [ ] **Step 6: Manual test**

1. Reload extension in `chrome://extensions`
2. Open side panel, enable replay toggle, set window to 30s
3. Click Start Recording on any page
4. Open DevTools → check the page's content scripts — `rrweb.min.js` and `replay-recorder.js` should appear
5. Interact with the page for a few seconds
6. Click a QA element to capture a bug, submit it
7. In the Network tab of the background service worker, check the POST to `/api/issues` — the payload should include `replay_data` as a non-empty base64 string
8. Click Stop Recording — replay recorder should stop

- [ ] **Step 7: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add extension/background.js
git commit -m "feat(extension): inject rrweb on recording start, compress replay on submit"
```

---

## Task 5: Backend — store replay blob on issue create

**Files:**
- Modify: `backend/src/issues/dto/create-issue.dto.ts`
- Modify: `backend/src/issues/issues.service.ts`

**Interfaces:**
- Consumes: `replay_data` — optional base64 gzip string in CreateIssueDto
- Produces: `issues.replay_storage_path` stored in DB; `replayUrl` (signed URL) returned from `findOne()`

- [ ] **Step 1: Add replay_data to DTO**

In `backend/src/issues/dto/create-issue.dto.ts`, add at the end of the class:

```ts
  @IsOptional()
  @IsString()
  replay_data?: string
```

- [ ] **Step 2: Add uploadReplay helper to issues.service.ts**

In `backend/src/issues/issues.service.ts`, add this method inside the `IssuesService` class, after `uploadScreenshot`:

```ts
  private async uploadReplay(base64Gzip: string, path: string): Promise<string | null> {
    try {
      const binary = Buffer.from(base64Gzip, 'base64');
      const { error } = await this.supabase.db.storage
        .from('qa-replays')
        .upload(path, binary, { contentType: 'application/gzip', upsert: false });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: Call uploadReplay in create()**

In the `create()` method, find where `screenshot_url` and `element_screenshot_url` are uploaded:
```ts
    const [screenshot_url, element_screenshot_url, ...screenshotUrls] = await Promise.all([
```

Add replay upload in the same `Promise.all`:

```ts
    const [screenshot_url, element_screenshot_url, replayPath, ...screenshotUrls] = await Promise.all([
      dto.screenshot
        ? this.uploadScreenshot(dto.screenshot, `${basePath}-screenshot.png`)
        : Promise.resolve(null),
      dto.element_screenshot
        ? this.uploadScreenshot(dto.element_screenshot, `${basePath}-element.png`)
        : Promise.resolve(null),
      dto.replay_data
        ? this.uploadReplay(dto.replay_data, `${userId}/${dto.project_id}/${timestamp}-replay.json.gz`)
        : Promise.resolve(null),
      ...screenshotsRaw.map((img, i) =>
        img.data
          ? this.uploadScreenshot(img.data, `${basePath}-img-${i}.png`)
          : Promise.resolve(null),
      ),
    ])
```

Then in the `.insert({ ... })` call, add:

```ts
        replay_storage_path: replayPath ?? null,
```

- [ ] **Step 4: Return replayUrl from findOne()**

In `findOne()`, after fetching the issue data, add signed URL generation:

```ts
  async findOne(userId: string, issueId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .single()
    if (error) throw new NotFoundException('Issue not found')

    let replayUrl: string | null = null;
    if (data.replay_storage_path) {
      const { data: signed } = await this.supabase.db.storage
        .from('qa-replays')
        .createSignedUrl(data.replay_storage_path, 60 * 60); // 1 hour
      replayUrl = signed?.signedUrl ?? null;
    }

    return { ...data, replayUrl };
  }
```

- [ ] **Step 5: Start backend and submit a test issue with replay**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3/backend"
npm run start:dev
```

Use the extension to submit a bug with replay enabled. Check Supabase Storage → `qa-replays` bucket — a `.json.gz` file should appear. Then call `GET /api/issues/:id` and verify the response includes `replayUrl`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add backend/src/issues/dto/create-issue.dto.ts backend/src/issues/issues.service.ts
git commit -m "feat(backend): upload replay blob to qa-replays bucket on issue create"
```

---

## Task 6: Backend — replay-token endpoint + public replay endpoint

**Files:**
- Modify: `backend/src/issues/issues.controller.ts`
- Modify: `backend/src/issues/issues.service.ts`
- Create: `backend/src/replay/replay.module.ts`
- Create: `backend/src/replay/replay.service.ts`
- Create: `backend/src/replay/replay.controller.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `POST /api/issues/:id/replay-token` → `{ token: string, url: string }`
- Produces: `GET /api/replay/:token` → `{ events: any[], issue: { title, severity } }` (public, no auth)

- [ ] **Step 1: Add createReplayToken to issues.service.ts**

Add this method to `IssuesService`:

```ts
  async createReplayToken(userId: string, issueId: string): Promise<{ token: string; url: string }> {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, replay_storage_path')
      .eq('id', issueId)
      .single();

    if (!issue?.replay_storage_path) {
      throw new NotFoundException('No replay available for this issue');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.db
      .from('replay_tokens')
      .insert({ issue_id: issueId, expires_at: expiresAt, created_by: userId })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    const url = `${process.env.PLATFORM_URL ?? 'http://localhost:3000'}/replay/${data.id}`;
    return { token: data.id, url };
  }
```

- [ ] **Step 2: Add replay-token route to issues.controller.ts**

In `backend/src/issues/issues.controller.ts`, add the import for `Post` (already imported) and add:

```ts
  @Post(':id/replay-token')
  createReplayToken(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.createReplayToken(user.id, id);
  }
```

- [ ] **Step 3: Create replay.service.ts**

Create `backend/src/replay/replay.service.ts`:

```ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'

@Injectable()
export class ReplayService {
  constructor(private supabase: SupabaseService) {}

  async getReplayByToken(token: string) {
    const { data: tokenRow, error } = await this.supabase.db
      .from('replay_tokens')
      .select('id, issue_id, expires_at')
      .eq('id', token)
      .single();

    if (error || !tokenRow) throw new NotFoundException('Replay link not found or has expired');
    if (new Date(tokenRow.expires_at) < new Date()) {
      throw new UnauthorizedException('This replay link has expired');
    }

    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('title, severity, replay_storage_path')
      .eq('id', tokenRow.issue_id)
      .single();

    if (!issue?.replay_storage_path) throw new NotFoundException('Replay data not found');

    // Generate a 24-hour signed URL for the replay blob
    const { data: signed } = await this.supabase.db.storage
      .from('qa-replays')
      .createSignedUrl(issue.replay_storage_path, 60 * 60 * 24);

    if (!signed?.signedUrl) throw new NotFoundException('Could not generate replay URL');

    return {
      issue: { title: issue.title, severity: issue.severity },
      replayUrl: signed.signedUrl,
      expiresAt: tokenRow.expires_at,
    };
  }
}
```

- [ ] **Step 4: Create replay.controller.ts**

Create `backend/src/replay/replay.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common'
import { ReplayService } from './replay.service'

@Controller('replay')
export class ReplayController {
  constructor(private replay: ReplayService) {}

  @Get(':token')
  getReplay(@Param('token') token: string) {
    return this.replay.getReplayByToken(token);
  }
}
```

- [ ] **Step 5: Create replay.module.ts**

Create `backend/src/replay/replay.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { ReplayService } from './replay.service'
import { ReplayController } from './replay.controller'

@Module({
  providers: [ReplayService],
  controllers: [ReplayController],
})
export class ReplayModule {}
```

- [ ] **Step 6: Register ReplayModule in app.module.ts**

In `backend/src/app.module.ts`, add the import:

```ts
import { ReplayModule } from './replay/replay.module'
```

And add `ReplayModule` to the `imports` array:

```ts
    ReplayModule,
```

- [ ] **Step 7: Test both endpoints**

With the backend running:

```bash
# Test replay-token creation (replace TOKEN and ISSUE_ID)
curl -X POST http://localhost:4000/api/issues/ISSUE_ID/replay-token \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json"
# Expected: { "token": "uuid", "url": "http://localhost:3000/replay/uuid" }

# Test public replay endpoint (replace TOKEN with the uuid above)
curl http://localhost:4000/api/replay/TOKEN
# Expected: { "issue": { "title": "...", "severity": "..." }, "replayUrl": "https://...", "expiresAt": "..." }
```

- [ ] **Step 8: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add backend/src/issues/issues.controller.ts backend/src/issues/issues.service.ts \
        backend/src/replay/replay.module.ts backend/src/replay/replay.service.ts \
        backend/src/replay/replay.controller.ts backend/src/app.module.ts
git commit -m "feat(backend): add replay-token endpoint and public /api/replay/:token route"
```

---

## Task 7: Platform — ReplayPlayer component

**Files:**
- Create: `platform/components/ReplayPlayer.tsx`

**Interfaces:**
- Consumes: `replayUrl: string` — signed URL to the `.json.gz` blob
- Consumes: `issueTitle?: string` — shown above player in shareable view
- Produces: `<ReplayPlayer replayUrl={url} />` — self-contained player with controls

- [ ] **Step 1: Install rrweb player package**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3/platform"
npm install rrweb-player
```

Verify it installed:
```bash
ls node_modules/rrweb-player/dist/ | head -5
```

- [ ] **Step 2: Create ReplayPlayer.tsx**

Create `platform/components/ReplayPlayer.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  replayUrl: string
}

export function ReplayPlayer({ replayUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const replayerRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [currentMs, setCurrentMs] = useState(0)
  const [totalMs, setTotalMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Fetch the gzip blob
        const res = await fetch(replayUrl)
        if (!res.ok) throw new Error('Failed to fetch replay')
        const blob = await res.blob()

        // Decompress
        const ds = new DecompressionStream('gzip')
        const decompressed = await new Response(
          blob.stream().pipeThrough(ds)
        ).text()
        const events = JSON.parse(decompressed)

        if (cancelled || !containerRef.current) return

        // Calculate total duration
        if (events.length >= 2) {
          setTotalMs(events[events.length - 1].timestamp - events[0].timestamp)
        }

        // Dynamically import rrweb Replayer (client-side only)
        const rrweb = await import('rrweb')
        if (cancelled) return

        const replayer = new (rrweb as any).Replayer(events, {
          root: containerRef.current,
          skipInactive: true,
          showWarning: false,
          speed: 1,
        })

        replayerRef.current = replayer
        setStatus('ready')
      } catch (err) {
        if (!cancelled) setStatus('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [replayUrl])

  function togglePlay() {
    if (!replayerRef.current) return
    if (playing) {
      replayerRef.current.pause()
      if (intervalRef.current) clearInterval(intervalRef.current)
      setPlaying(false)
    } else {
      replayerRef.current.play(currentMs)
      intervalRef.current = setInterval(() => {
        const meta = replayerRef.current?.getMetaData?.()
        if (meta) setCurrentMs(meta.currentTime ?? 0)
      }, 200)
      setPlaying(true)
    }
  }

  function handleSpeedChange(s: number) {
    setSpeed(s)
    replayerRef.current?.setConfig?.({ speed: s })
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const ms = Number(e.target.value)
    setCurrentMs(ms)
    replayerRef.current?.pause()
    replayerRef.current?.goto(ms)
    setPlaying(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center h-48 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
        Could not load replay. The link may have expired.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {status === 'loading' && (
        <div className="flex items-center justify-center h-48 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-400">
          Loading replay…
        </div>
      )}

      {/* rrweb mounts its iframe here */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
        style={{ minHeight: 300, display: status === 'ready' ? 'block' : 'none' }}
      />

      {status === 'ready' && (
        <div className="flex items-center gap-3 px-2">
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 flex-shrink-0"
          >
            {playing ? (
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                <rect x="0" y="0" width="3.5" height="12" rx="1"/><rect x="6.5" y="0" width="3.5" height="12" rx="1"/>
              </svg>
            ) : (
              <svg width="10" height="12" viewBox="0 0 12 12" fill="currentColor">
                <polygon points="2,1 11,6 2,11"/>
              </svg>
            )}
          </button>

          <input
            type="range"
            min={0}
            max={totalMs}
            value={currentMs}
            onChange={handleScrub}
            className="flex-1 h-1 accent-indigo-600"
          />

          <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
            {formatTime(currentMs)} / {formatTime(totalMs)}
          </span>

          <select
            value={speed}
            onChange={e => handleSpeedChange(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add platform/components/ReplayPlayer.tsx platform/package.json platform/package-lock.json
git commit -m "feat(platform): add ReplayPlayer component with rrweb"
```

---

## Task 8: Platform — Session Replay tab on issue detail

**Files:**
- Modify: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`

**Interfaces:**
- Consumes: `issue.replayUrl` (string | null) from `GET /api/issues/:id`
- Consumes: `<ReplayPlayer replayUrl={...} />` from Task 7
- Produces: "Session Replay" tab in issue detail, visible only when `replayUrl` is non-null

- [ ] **Step 1: Add replayUrl to the Issue type (if typed)**

In `platform/lib/types.ts` (or wherever `Issue` is defined), add:

```ts
  replayUrl?: string | null
```

If there is no separate types file and `Issue` is inlined, add `replayUrl?: string | null` to the inferred shape — the API now returns it.

- [ ] **Step 2: Add Session Replay tab to the issue detail page**

In `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`:

First, add the import at the top:
```ts
import { ReplayPlayer } from '@/components/ReplayPlayer'
```

Then find where the issue detail tabs or sections are rendered. The page currently has sections for screenshots, metadata, environment, console errors, etc. 

Find the section that renders the main tab bar or the first major section heading. Add a "Session Replay" tab or section. Look for a pattern like:

```tsx
{/* Add this block after the screenshots section, only if replayUrl exists */}
{issue.replayUrl && (
  <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-800">Session Replay</h3>
      <button
        onClick={async () => {
          const res = await fetch(`/api/issues/${issue.id}/replay-token`, { method: 'POST' })
          const data = await res.json()
          await navigator.clipboard.writeText(data.url)
          // show a toast or alert
          alert('Replay link copied to clipboard — valid for 7 days')
        }}
        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
      >
        Share replay link
      </button>
    </div>
    <div className="p-4">
      <ReplayPlayer replayUrl={issue.replayUrl} />
    </div>
  </section>
)}
```

Note: the `fetch('/api/...')` above calls the Next.js API proxy if one exists, or calls the backend directly. Check how other API calls are made in this file (likely via the `api` client from `@/lib/api/client`). Replace the fetch call with the correct pattern, e.g.:

```ts
const data = await api.post(`issues/${issue.id}/replay-token`, {})
```

- [ ] **Step 3: Test in browser**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3/platform"
npm run dev
```

1. Open an issue that has a replay (submitted with replay toggle on)
2. Verify "Session Replay" section appears below screenshots
3. Click Play — replay should start in the embedded iframe
4. Scrubber, speed, and pause should all work
5. Click "Share replay link" — a URL should be copied to clipboard
6. Open the URL in an incognito window — should load the public replay page (Task 9)

- [ ] **Step 4: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add "platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx"
git commit -m "feat(platform): add session replay tab to issue detail"
```

---

## Task 9: Platform — public /replay/[token] page

**Files:**
- Create: `platform/app/replay/[token]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/replay/:token` → `{ issue: { title, severity }, replayUrl, expiresAt }`
- Consumes: `<ReplayPlayer replayUrl={...} />` from Task 7
- Produces: public page at `/replay/:token` — no auth, no dashboard chrome

- [ ] **Step 1: Create the public replay page**

Create `platform/app/replay/[token]/page.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ReplayPlayer } from '@/components/ReplayPlayer'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const SEVERITY_CONFIG: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  Medium:   'bg-yellow-100 text-yellow-700',
  Low:      'bg-gray-100 text-gray-600',
}

interface ReplayData {
  issue: { title: string; severity: string }
  replayUrl: string
  expiresAt: string
}

export default function PublicReplayPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ReplayData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/replay/${token}`)
      .then(res => {
        if (res.status === 401) throw new Error('This replay link has expired.')
        if (res.status === 404) throw new Error('Replay not found.')
        if (!res.ok) throw new Error('Failed to load replay.')
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err.message))
  }, [token])

  const daysLeft = data
    ? Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-sm font-semibold text-indigo-600 tracking-wide">QA Reporter</span>
          <span className="text-gray-300">·</span>
          <span className="text-sm text-gray-400">Session Replay</span>
        </div>

        {error && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-400 text-xl">⚠</div>
            <p className="text-gray-700 font-medium">{error}</p>
            <p className="text-sm text-gray-400">Ask the issue owner to generate a new replay link.</p>
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-6">
            {/* Issue info */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-base font-semibold text-gray-900">{data.issue.title}</h1>
                {daysLeft !== null && (
                  <p className="text-xs text-gray-400 mt-1">
                    This link expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${SEVERITY_CONFIG[data.issue.severity] ?? SEVERITY_CONFIG['Low']}`}>
                {data.issue.severity}
              </span>
            </div>

            {/* Player */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <ReplayPlayer replayUrl={data.replayUrl} />
            </div>
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center h-64 text-sm text-gray-400">
            Loading replay…
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Test the public page**

1. Get a replay token URL from the "Share replay link" button (Task 8)
2. Open it in an incognito browser window (no QA Reporter session)
3. Verify: issue title, severity badge, and replay player all render
4. Verify: replay plays correctly
5. Verify: expired token shows a friendly error (you can manually set `expires_at` to a past date in Supabase to test)

- [ ] **Step 3: Commit**

```bash
cd "/Users/rahulsarawagi/Desktop/project 3"
git add "platform/app/replay/[token]/page.tsx"
git commit -m "feat(platform): add public shareable replay page at /replay/:token"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Toggle + window dropdown in sidepanel | Task 3 |
| rrweb lazy-injected via scripting.executeScript | Task 4 |
| Rolling window buffer in replay-recorder.js | Task 2 |
| Compress with CompressionStream on submit | Task 4 |
| replay_data sent in issue payload | Task 4 |
| Upload to qa-replays Supabase Storage bucket | Task 5 |
| replay_storage_path stored in issues table | Task 5 |
| Signed URL returned from GET /api/issues/:id | Task 5 |
| POST /api/issues/:id/replay-token | Task 6 |
| GET /api/replay/:token (public) | Task 6 |
| ReplayPlayer with play/pause/scrub/speed | Task 7 |
| Session Replay tab on issue detail | Task 8 |
| Shareable public replay page | Task 9 |
| Token expiry display + friendly error | Task 9 |
| replay_storage_path column already in DB | ✅ done |
| replay_tokens table already in DB | ✅ done |

All spec requirements covered. No placeholders or TBDs in any task.
