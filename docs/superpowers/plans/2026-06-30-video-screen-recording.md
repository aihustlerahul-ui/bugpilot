# Video Screen Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real WebM video screen recording to the QA Reporter extension, gated by a workspace settings toggle, with the ability to attach the recorded video to a new or existing issue.

**Architecture:** Sidepanel owns the `MediaRecorder` lifecycle (it's the only long-lived DOM context in the extension). Background service worker brokers `chrome.tabCapture` stream IDs and performs the Supabase Storage upload + backend API calls. Backend adds a `video_storage_path` column to `issues` and a `PATCH /issues/:id` endpoint; `POST /issues` gains an optional `videoStoragePath` field. Platform issue detail page renders a `<video>` element when a video is attached.

**Tech Stack:** Chrome MV3 (`chrome.tabCapture`, `getDisplayMedia`, `MediaRecorder`), NestJS + Supabase Storage, Next.js 14 + TypeScript.

## Global Constraints

- Video format: WebM, codec `vp9` (`video/webm;codecs=vp9`) — matches design spec.
- Storage bucket: new `videos` bucket in Supabase Storage (separate from `screenshots` / `qa-replays`), private, signed URLs only, 1 hour TTL for playback, matching existing `qa-replays` signed URL pattern in `backend/src/issues/issues.service.ts`.
- Manifest permission `tabCapture` required for single-tab capture path.
- Feature must be fully inert (button hidden, no permission prompts) when `videoRecordingEnabled` is `false` in workspace settings.
- Follow existing code style: `qa_`-prefixed `chrome.storage.local` keys, message-type router pattern in `background.js`, `!important`/`qa-` prefix not required here (sidepanel/platform only, no content-script injection for video).
- All new backend routes must go through `SupabaseAuthGuard` and scope by `reporter_id`/workspace ownership, matching `IssuesService`/`WorkspacesService` patterns.

---

### Task 1: Database migration — `video_storage_path` column + `videos` bucket

**Files:**
- Create: `backend/supabase/migrations/<timestamp>_add_video_storage_path.sql` (use existing migrations folder naming convention if one exists; otherwise create `backend/supabase/migrations/`)
- Modify: none (manual bucket creation documented in step 3)

**Interfaces:**
- Produces: `issues.video_storage_path` column (nullable `text`), used by Task 2 (backend service) and Task 6 (platform detail page).

- [ ] **Step 1: Write the migration SQL**

```sql
-- backend/supabase/migrations/20260630000000_add_video_storage_path.sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS video_storage_path TEXT;
```

- [ ] **Step 2: Apply the migration**

Run: `cd backend && npx supabase migration up` (or run the SQL directly against the project's Supabase instance via the SQL editor if `supabase` CLI isn't linked locally).
Expected: migration applies with no errors; `issues` table now has `video_storage_path` column.

- [ ] **Step 3: Create the `videos` Storage bucket**

In Supabase dashboard (or via `supabase storage` CLI), create a new **private** bucket named `videos` — same visibility settings as the existing `qa-replays` bucket.
Expected: bucket `videos` exists and is not public.

- [ ] **Step 4: Verify column exists**

Run: `cd backend && node -e "require('dotenv').config(); const {createClient}=require('@supabase/supabase-js'); const c=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); c.from('issues').select('video_storage_path').limit(1).then(r=>console.log(r))"`
Expected: no error, returns `{ data: [...], error: null }`.

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260630000000_add_video_storage_path.sql
git commit -m "feat(backend): add video_storage_path column to issues"
```

---

### Task 2: Backend — video upload helper + `POST /issues` videoStoragePath + `PATCH /issues/:id`

**Files:**
- Modify: `backend/src/issues/issues.service.ts`
- Modify: `backend/src/issues/issues.controller.ts`
- Modify: `backend/src/issues/dto/create-issue.dto.ts`
- Create: `backend/src/issues/dto/attach-video.dto.ts`
- Test: `backend/src/issues/issues.service.spec.ts` (create if it doesn't already exist)

**Interfaces:**
- Consumes: `SupabaseService.db` (existing, `backend/src/supabase/supabase.service.ts`), `CreateIssueDto` (existing).
- Produces: `IssuesService.uploadVideo(base64: string, path: string): Promise<string | null>`, `IssuesService.attachVideo(userId: string, issueId: string, dto: AttachVideoDto): Promise<Issue>`, `CreateIssueDto.videoStoragePath?: string`.

- [ ] **Step 1: Write the failing test for `attachVideo`**

```typescript
// backend/src/issues/issues.service.spec.ts
import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { IssuesService } from './issues.service'
import { SupabaseService } from '../supabase/supabase.service'

describe('IssuesService.attachVideo', () => {
  function buildMockSupabase(overrides: Partial<Record<string, any>> = {}) {
    const single = jest.fn().mockResolvedValue({ data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/project-1/1700-video.webm' }, error: null })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const from = jest.fn().mockReturnValue({ update })
    return { db: { from, ...overrides } } as unknown as SupabaseService
  }

  it('throws NotFoundException when issue does not belong to user', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    await expect(
      service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' }),
    ).rejects.toThrow(NotFoundException)
  })

  it('updates video_storage_path and returns the issue', async () => {
    const supabase = buildMockSupabase()
    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    const result = await service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' })

    expect(result.video_storage_path).toBe('user-1/project-1/1700-video.webm')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest issues.service.spec.ts`
Expected: FAIL with `service.attachVideo is not a function`.

- [ ] **Step 3: Create `AttachVideoDto`**

```typescript
// backend/src/issues/dto/attach-video.dto.ts
import { IsString } from 'class-validator'

export class AttachVideoDto {
  @IsString()
  videoStoragePath: string
}
```

- [ ] **Step 4: Add `videoStoragePath` to `CreateIssueDto`**

```typescript
// backend/src/issues/dto/create-issue.dto.ts
// add below the existing `replay_data` field:

  @IsOptional()
  @IsString()
  videoStoragePath?: string
```

- [ ] **Step 5: Implement `uploadVideo` and `attachVideo` in `IssuesService`**

```typescript
// backend/src/issues/issues.service.ts
// add alongside uploadReplay/uploadScreenshot as a private method:

  private async uploadVideo(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(base64.replace(/^data:video\/\w+;base64,/, ''), 'base64')
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, buffer, { contentType: 'video/webm', upsert: false })
      if (error) return null
      return path
    } catch {
      return null
    }
  }

// add as a public method, near createReplayToken:

  async attachVideo(userId: string, issueId: string, dto: AttachVideoDto) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .update({ video_storage_path: dto.videoStoragePath })
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .select()
      .single()

    if (error || !data) throw new NotFoundException('Issue not found')
    return data
  }
```

Add the import at the top of the file:

```typescript
import { AttachVideoDto } from './dto/attach-video.dto'
```

- [ ] **Step 6: Wire `videoStoragePath` into `create()`**

`dto.videoStoragePath` is already-uploaded by the time `create()` runs — the extension calls `POST /issues/upload-video` (Step 7 below) first to get a storage path, then passes that path along with the rest of the issue fields to `POST /issues`. So `create()` does not upload anything for video; it just persists the path. Add a single field to the existing `.insert({...})` object in `IssuesService.create()`:

```typescript
// backend/src/issues/issues.service.ts — in the .insert({...}) object inside create(),
// add this line alongside the existing replay_storage_path line:
        video_storage_path: dto.videoStoragePath ?? null,
```

No changes to the `Promise.all` in `create()` are needed.

- [ ] **Step 7: Add `POST /issues/upload-video` endpoint for the actual binary upload**

```typescript
// backend/src/issues/issues.service.ts — add public method:

  async uploadVideoFile(userId: string, projectId: string, base64: string): Promise<{ storagePath: string }> {
    const timestamp = Date.now()
    const path = `${userId}/${projectId}/${timestamp}-video.webm`
    const storagePath = await this.uploadVideo(base64, path)
    if (!storagePath) throw new Error('Video upload failed')
    return { storagePath }
  }
```

```typescript
// backend/src/issues/dto/upload-video.dto.ts (new file)
import { IsString } from 'class-validator'

export class UploadVideoDto {
  @IsString()
  project_id: string

  @IsString()
  video: string // base64-encoded webm blob
}
```

```typescript
// backend/src/issues/issues.controller.ts — add:
import { UploadVideoDto } from './dto/upload-video.dto'
import { AttachVideoDto } from './dto/attach-video.dto'

  @Post('upload-video')
  uploadVideo(@CurrentUser() user: AuthUser, @Body() dto: UploadVideoDto) {
    return this.issues.uploadVideoFile(user.id, dto.project_id, dto.video)
  }

  @Patch(':id/video')
  attachVideo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttachVideoDto) {
    return this.issues.attachVideo(user.id, id, dto)
  }
```

Add `Patch` to the `@nestjs/common` import list in `issues.controller.ts`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && npx jest issues.service.spec.ts`
Expected: PASS (both tests green).

- [ ] **Step 9: Manual smoke test**

Run: `cd backend && npm run start:dev`, then in another terminal:
```bash
curl -X POST http://localhost:4000/api/issues/upload-video \
  -H "Authorization: Bearer <valid_jwt>" -H "Content-Type: application/json" \
  -d '{"project_id":"<real-project-id>","video":"AAAA"}'
```
Expected: `{ "storagePath": "<userId>/<projectId>/<timestamp>-video.webm" }` (or a clean error if base64 is invalid — either confirms the route + auth guard work).

- [ ] **Step 10: Commit**

```bash
git add backend/src/issues/
git commit -m "feat(backend): add video upload and attach-to-issue endpoints"
```

---

### Task 3: Backend — surface `videoUrl` on issue read

**Files:**
- Modify: `backend/src/issues/issues.service.ts` (`findOne`)
- Test: `backend/src/issues/issues.service.spec.ts`

**Interfaces:**
- Consumes: `issue.video_storage_path` (Task 1/2).
- Produces: `Issue.videoUrl?: string | null` in the `findOne()` response, consumed by Task 6 (platform detail page).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/issues/issues.service.spec.ts — add:

describe('IssuesService.findOne', () => {
  it('returns a signed videoUrl when video_storage_path is set', async () => {
    const singleIssue = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/proj/1-video.webm' },
      error: null,
    })
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/video.webm' } })
    const supabase = {
      db: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: singleIssue }) }) }),
        }),
        storage: { from: jest.fn().mockReturnValue({ createSignedUrl }) },
      },
    } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    const result = await service.findOne('user-1', 'issue-1')

    expect(result.videoUrl).toBe('https://signed/video.webm')
    expect(createSignedUrl).toHaveBeenCalledWith('user-1/proj/1-video.webm', 60 * 60)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest issues.service.spec.ts -t "findOne"`
Expected: FAIL — `result.videoUrl` is `undefined`.

- [ ] **Step 3: Implement in `findOne()`**

```typescript
// backend/src/issues/issues.service.ts — inside findOne(), after the existing replayUrl block:

    let videoUrl: string | null = null;
    if (data.video_storage_path) {
      const { data: signedVideo } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.video_storage_path, 60 * 60); // 1 hour
      videoUrl = signedVideo?.signedUrl ?? null;
    }

    return { ...data, replayUrl, videoUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest issues.service.spec.ts -t "findOne"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/issues/issues.service.ts backend/src/issues/issues.service.spec.ts
git commit -m "feat(backend): return signed videoUrl from findOne"
```

---

### Task 4: Manifest + background.js — `tabCapture` permission and video message handlers

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `chrome.tabCapture` (Chrome API), existing `chrome.storage.local` pattern, existing message router at `background.js:287`.
- Produces: message handlers `START_VIDEO_RECORDING` (returns `{ ok, streamId }`), `UPLOAD_AND_ATTACH_VIDEO` (accepts `{ base64, projectId, issueId }`, returns `{ ok, storagePath }`) — consumed by Task 5 (sidepanel).

- [ ] **Step 1: Add `tabCapture` permission**

```json
// extension/manifest.json — modify "permissions" array:
"permissions": ["storage", "unlimitedStorage", "activeTab", "scripting", "tabs", "sidePanel", "tabCapture"],
```

- [ ] **Step 2: Add `handleStartVideoRecording`**

```javascript
// extension/background.js — add near handleStartScreenRecording:

async function handleStartVideoRecording(message, sendResponse) {
  const tabId = message.tabId;
  if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); return; }
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    sendResponse({ ok: true, streamId });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'tabCapture failed' });
  }
}
```

- [ ] **Step 3: Add `handleUploadAndAttachVideo`**

```javascript
// extension/background.js — add near handleSubmitIssue:

async function handleUploadAndAttachVideo(message, sendResponse) {
  const { base64, projectId, issueId } = message;
  if (!base64 || !projectId) { sendResponse({ ok: false, error: 'Missing base64 or projectId' }); return; }
  try {
    const { qa_token } = await chrome.storage.local.get(['qa_token']);
    const uploadRes = await fetch(`${API_BASE_URL}/api/issues/upload-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${qa_token}` },
      body: JSON.stringify({ project_id: projectId, video: base64 }),
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    const { storagePath } = await uploadRes.json();

    if (issueId) {
      const attachRes = await fetch(`${API_BASE_URL}/api/issues/${issueId}/video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${qa_token}` },
        body: JSON.stringify({ videoStoragePath: storagePath }),
      });
      if (!attachRes.ok) throw new Error(`Attach failed: ${attachRes.status}`);
    }

    sendResponse({ ok: true, storagePath });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Video upload failed' });
  }
}
```

Check the top of `background.js` for the existing base URL constant (used by other `fetch` calls to the backend, e.g. in `handleGetProjects` or `handleSubmitIssue`) and reuse that constant name instead of `API_BASE_URL` if it differs — match existing naming exactly.

- [ ] **Step 4: Register both message types in the router**

```javascript
// extension/background.js — inside chrome.runtime.onMessage.addListener, add after the STOP_MULTITAB_RECORDING block:

  if (type === 'START_VIDEO_RECORDING') {
    handleStartVideoRecording(message, sendResponse);
    return true;
  }
  if (type === 'UPLOAD_AND_ATTACH_VIDEO') {
    handleUploadAndAttachVideo(message, sendResponse);
    return true;
  }
```

- [ ] **Step 5: Manual verification — load unpacked extension**

Open `chrome://extensions`, reload QA Reporter unpacked extension.
Expected: no manifest errors; extension loads with `tabCapture` permission listed under "Permissions" in the extension details page.

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/background.js
git commit -m "feat(extension): add tabCapture permission and video recording message handlers"
```

---

### Task 5: Sidepanel — video recording UI, MediaRecorder, multi-tab getDisplayMedia path

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `START_VIDEO_RECORDING` / `UPLOAD_AND_ATTACH_VIDEO` messages (Task 4), `qa_ext_settings.videoRecordingEnabled` (Task 7), `qa_multitab_mode` (existing storage key).
- Produces: in-memory `videoBlob` (Blob, type `video/webm`) available to the issue-submit flow in `content.js`/`sidepanel.js` for Task 6's "attach to issue" wiring. Function `getRecordedVideoBlob(): Blob | null` exported onto `window` for cross-script access is NOT needed — this stays local to `sidepanel.js` since attach happens from the sidepanel dropdown (Flow B) or is read at submit time via `chrome.storage.local` session-only key `qa_pending_video_meta` (metadata only — the blob itself never leaves sidepanel memory until upload).

- [ ] **Step 1: Add video recording button markup to `sidepanel.html`**

```html
<!-- extension/sidepanel.html — insert after the existing screen-rec-timer-row div (after line 551), before the replay-chip div: -->
<div class="video-rec-row" id="video-rec-row" style="display:none">
  <button class="btn btn-screen-rec btn-full" id="btn-video-recording">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
    Record Video
  </button>
</div>
<div class="video-rec-timer-row" id="video-rec-timer-row" style="display:none">
  <span class="screen-rec-timer-dot"></span><span id="video-rec-timer">0:00</span> recording
</div>
<div class="video-attach-row" id="video-attach-row" style="display:none">
  <select class="replay-window-select" id="video-attach-select">
    <option value="">Attach to issue…</option>
  </select>
  <button class="btn-delete-replay" id="btn-discard-video">Discard</button>
</div>
```

- [ ] **Step 2: Add DOM refs and state in `sidepanel.js`**

```javascript
// extension/sidepanel.js — add near the top with other const btn* declarations (after btnMultitab at line 39):
const videoRecRow        = document.getElementById('video-rec-row');
const btnVideoRecording  = document.getElementById('btn-video-recording');
const videoRecTimerRow   = document.getElementById('video-rec-timer-row');
const videoRecTimer      = document.getElementById('video-rec-timer');
const videoAttachRow     = document.getElementById('video-attach-row');
const videoAttachSelect  = document.getElementById('video-attach-select');
const btnDiscardVideo    = document.getElementById('btn-discard-video');

let videoMediaRecorder = null;
let videoChunks = [];
let videoBlob = null;
let videoRecStartedAt = null;
let videoRecTimerInterval = null;
```

- [ ] **Step 3: Add `videoRecordingEnabled` visibility toggle**

```javascript
// extension/sidepanel.js — add function near applyMultiTabVisibility:
function applyVideoRecordingVisibility(settings) {
  const enabled = !!(settings && settings.videoRecordingEnabled);
  videoRecRow.style.display = enabled ? '' : 'none';
}
```

Call it wherever `applyMultiTabVisibility(settings)` is already called (both in the initial load path around line 268 and in the `chrome.storage.onChanged` listener at line 506) — add `applyVideoRecordingVisibility(settings)` / `applyVideoRecordingVisibility(changes.qa_ext_settings.newValue)` right next to each existing call.

- [ ] **Step 4: Implement start/stop recording logic**

```javascript
// extension/sidepanel.js — add new section near the screen-recording toggle logic:

async function startVideoRecording() {
  const { qa_multitab_mode } = await chrome.storage.local.get(['qa_multitab_mode']);
  let stream;
  try {
    if (qa_multitab_mode) {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } else {
      const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
      const res = await chrome.runtime.sendMessage({ type: 'START_VIDEO_RECORDING', tabId: tab.id });
      if (!res || !res.ok) throw new Error(res?.error || 'Failed to start tab capture');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } },
      });
    }
  } catch (err) {
    alert(`Could not start video recording: ${err.message}`);
    return;
  }

  videoChunks = [];
  videoMediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  videoMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
  videoMediaRecorder.onstop = () => {
    videoBlob = new Blob(videoChunks, { type: 'video/webm' });
    stream.getTracks().forEach(t => t.stop());
    showVideoAttachRow();
  };
  videoMediaRecorder.start();
  videoRecStartedAt = Date.now();
  btnVideoRecording.textContent = 'Stop Video';
  videoRecTimerRow.style.display = '';
  videoRecTimerInterval = setInterval(updateVideoTimer, 1000);
}

function updateVideoTimer() {
  const sec = Math.floor((Date.now() - videoRecStartedAt) / 1000);
  const m = Math.floor(sec / 60), s = sec % 60;
  videoRecTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function stopVideoRecording() {
  if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
    videoMediaRecorder.stop();
  }
  clearInterval(videoRecTimerInterval);
  videoRecTimerRow.style.display = 'none';
  btnVideoRecording.textContent = 'Record Video';
}

function showVideoAttachRow() {
  videoAttachRow.style.display = '';
  populateVideoAttachDropdown();
}

btnVideoRecording.addEventListener('click', () => {
  if (videoMediaRecorder && videoMediaRecorder.state === 'recording') {
    stopVideoRecording();
  } else {
    startVideoRecording();
  }
});

btnDiscardVideo.addEventListener('click', () => {
  videoBlob = null;
  videoChunks = [];
  videoAttachRow.style.display = 'none';
});
```

- [ ] **Step 5: Add a `GET_RECENT_ISSUES` background handler**

```javascript
// extension/background.js — add handler near handleGetProjects:
async function handleGetRecentIssues(message, sendResponse) {
  const { qa_token } = await chrome.storage.local.get(['qa_token']);
  try {
    const res = await fetch(`${API_BASE_URL}/api/issues/project/${message.projectId}`, {
      headers: { Authorization: `Bearer ${qa_token}` },
    });
    const issues = await res.json();
    sendResponse({ ok: true, issues: issues.slice(0, 10) });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
```

```javascript
// extension/background.js — router case, add alongside START_VIDEO_RECORDING/UPLOAD_AND_ATTACH_VIDEO from Task 4:
  if (type === 'GET_RECENT_ISSUES') {
    handleGetRecentIssues(message, sendResponse);
    return true;
  }
```

Use the same base-URL constant identified in Task 4 Step 3 (`API_BASE_URL` is a placeholder name — replace with whatever constant `handleGetProjects` already uses).

- [ ] **Step 6: Populate the attach-to-issue dropdown and wire upload**

```javascript
// extension/sidepanel.js — add:

async function populateVideoAttachDropdown() {
  const { qa_current_project_id } = await chrome.storage.local.get(['qa_current_project_id']);
  if (!qa_current_project_id) return;
  videoAttachSelect.length = 1; // keep the placeholder "Attach to issue…" option, drop the rest
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_RECENT_ISSUES', projectId: qa_current_project_id });
    if (res && res.ok) {
      for (const issue of res.issues) {
        const opt = document.createElement('option');
        opt.value = issue.id;
        opt.textContent = issue.title || issue.description?.slice(0, 40) || issue.id;
        videoAttachSelect.appendChild(opt);
      }
    }
  } catch (_) {}
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

videoAttachSelect.addEventListener('change', async () => {
  const issueId = videoAttachSelect.value;
  if (!issueId || !videoBlob) return;
  const { qa_current_project_id } = await chrome.storage.local.get(['qa_current_project_id']);
  videoAttachSelect.disabled = true;
  const base64 = await blobToBase64(videoBlob);
  const res = await chrome.runtime.sendMessage({
    type: 'UPLOAD_AND_ATTACH_VIDEO',
    base64,
    projectId: qa_current_project_id,
    issueId,
  });
  videoAttachSelect.disabled = false;
  if (res && res.ok) {
    videoAttachRow.style.display = 'none';
    videoBlob = null;
    videoChunks = [];
  } else {
    alert(`Failed to attach video: ${res?.error || 'unknown error'}`);
  }
});
```

- [ ] **Step 7: Manual test — single-tab recording**

Load unpacked extension, open sidepanel on any page, ensure `videoRecordingEnabled: true` is set in workspace settings (see Task 7). Click "Record Video".
Expected: Chrome shows no picker (tab capture is seamless), timer starts counting, clicking "Stop Video" reveals the attach dropdown populated with recent issues.

- [ ] **Step 8: Manual test — multi-tab recording**

Toggle multi-tab ON in sidepanel, click "Record Video".
Expected: native `getDisplayMedia` picker appears (screen/window/tab choice), recording proceeds after selection, stop produces the same attach dropdown.

- [ ] **Step 9: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js extension/background.js
git commit -m "feat(extension): add video recording UI, MediaRecorder, and issue attach flow"
```

---

### Task 6: Extension — attach video at issue-creation time (Flow A)

**Files:**
- Modify: `extension/content.js`

**Interfaces:**
- Consumes: `videoBlob` state — since `content.js` runs in the page context and `sidepanel.js` runs in the sidepanel, the blob cannot be shared directly. Instead, on `CAPTURE_SCREENSHOT`/modal-open, `content.js` checks `qa_video_recording_pending` (a boolean flag set by `sidepanel.js` when a `videoBlob` exists) via `chrome.storage.local`, and if true, shows the "Attach recorded video?" prompt; on confirm, `content.js` sends `SUBMIT_ISSUE` as normal, then separately sends `ATTACH_PENDING_VIDEO_TO_LAST_ISSUE` which the sidepanel picks up (since only the sidepanel holds the blob).

- [ ] **Step 1: Set the pending-video flag from sidepanel.js when recording stops**

```javascript
// extension/sidepanel.js — inside videoMediaRecorder.onstop (Task 5 Step 4), after showVideoAttachRow():
chrome.storage.local.set({ qa_video_recording_pending: true });
```

And clear it in the discard handler and after a successful attach:

```javascript
// btnDiscardVideo click handler — add:
chrome.storage.local.set({ qa_video_recording_pending: false });

// videoAttachSelect change handler, inside `if (res && res.ok)` block — add:
chrome.storage.local.set({ qa_video_recording_pending: false });
```

- [ ] **Step 2: Show the attach prompt in the issue modal**

```javascript
// extension/content.js — locate the function that builds/opens the issue submit modal
// (search for the existing screen-recording attach section referenced in CLAUDE.md:
// "content.js modal shows replay section when screenRecordingActive"). Add a sibling
// block for video:

async function maybeShowVideoAttachPrompt(modalEl) {
  const { qa_video_recording_pending } = await chrome.storage.local.get(['qa_video_recording_pending']);
  if (!qa_video_recording_pending) return;

  const row = document.createElement('div');
  row.className = 'qa-video-attach-prompt';
  row.innerHTML = `
    <label class="qa-video-attach-label">
      <input type="checkbox" id="qa-attach-video-checkbox" checked />
      Attach recorded video to this bug
    </label>
  `;
  modalEl.appendChild(row);
}
```

Call `maybeShowVideoAttachPrompt(modalEl)` from wherever the modal is constructed (same place the existing replay-attach section is added, per `CLAUDE.md`'s "Attach Replay to Bug Mid-Recording" section).

- [ ] **Step 3: Wire submit to request the attach after issue creation**

```javascript
// extension/content.js — in the issue submit handler, after SUBMIT_ISSUE succeeds and
// the created issue's id is known (check how the existing replay-attach flow gets the
// new issue id post-submit, and mirror it):

const attachVideoChecked = document.getElementById('qa-attach-video-checkbox')?.checked;
if (attachVideoChecked && createdIssue?.id) {
  chrome.runtime.sendMessage({ type: 'REQUEST_VIDEO_ATTACH', issueId: createdIssue.id });
}
```

- [ ] **Step 4: Handle `REQUEST_VIDEO_ATTACH` — background relays to sidepanel**

Since only the sidepanel holds `videoBlob` in memory, and `content.js`/`background.js` cannot access it directly, the sidepanel must poll or listen for this request:

```javascript
// extension/sidepanel.js — add a chrome.runtime.onMessage listener (sidepanel can receive
// messages same as any extension page):
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'REQUEST_VIDEO_ATTACH' && videoBlob) {
    (async () => {
      const { qa_current_project_id } = await chrome.storage.local.get(['qa_current_project_id']);
      const base64 = await blobToBase64(videoBlob);
      const res = await chrome.runtime.sendMessage({
        type: 'UPLOAD_AND_ATTACH_VIDEO',
        base64,
        projectId: qa_current_project_id,
        issueId: message.issueId,
      });
      if (res && res.ok) {
        videoBlob = null;
        videoChunks = [];
        videoAttachRow.style.display = 'none';
        chrome.storage.local.set({ qa_video_recording_pending: false });
      }
    })();
  }
});
```

Note: `chrome.runtime.sendMessage` from `content.js` broadcasts to the background service worker, not directly to the sidepanel. Change `content.js`'s `REQUEST_VIDEO_ATTACH` send to instead have `background.js` forward it:

```javascript
// extension/background.js — router case:
  if (type === 'REQUEST_VIDEO_ATTACH') {
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
```

This re-broadcasts the message so any open sidepanel's `onMessage` listener (Step 4 above) receives it.

- [ ] **Step 5: Manual test — Flow A end to end**

Start video recording, stop it (attach dropdown appears but leave it), then click an element to file a bug through the normal content.js modal.
Expected: modal shows "Attach recorded video to this bug" checkbox, checked by default; submitting creates the issue and the video is uploaded + attached in the background; sidepanel's attach row disappears once done.

- [ ] **Step 6: Commit**

```bash
git add extension/content.js extension/sidepanel.js extension/background.js
git commit -m "feat(extension): attach recorded video at issue-creation time"
```

---

### Task 7: Platform — `videoRecordingEnabled` settings toggle

**Files:**
- Modify: `backend/src/workspaces/workspaces.service.ts`
- Modify: `platform/app/(dashboard)/extension/page.tsx`

**Interfaces:**
- Consumes: `ExtensionSettings` interface (existing), `PATCH /workspaces/settings` (existing).
- Produces: `ExtensionSettings.videoRecordingEnabled: boolean`, synced to extension via existing `SYNC_SETTINGS` flow, consumed by Task 5's `applyVideoRecordingVisibility`.

- [ ] **Step 1: Add the field to `ExtensionSettings` and defaults**

```typescript
// backend/src/workspaces/workspaces.service.ts — add to the ExtensionSettings interface,
// under the "Session Replay" section:
  captureNavHistory: boolean
  multiTabRecording: boolean
  videoRecordingEnabled: boolean

// add to DEFAULT_SETTINGS:
  captureNavHistory: true,
  multiTabRecording: false,
  videoRecordingEnabled: false,
```

- [ ] **Step 2: Add the toggle UI to the extension settings page**

Find the existing multi-tab-recording toggle block in `platform/app/(dashboard)/extension/page.tsx` (it patches `multiTabRecording` via the `set()` helper already used for `screenshotMode`) and add a sibling toggle:

```tsx
{/* Video Recording toggle — place directly after the existing multi-tab recording toggle block */}
<div className="flex items-center justify-between py-3">
  <div>
    <p className="text-sm font-medium text-gray-900">Video Recording</p>
    <p className="text-xs text-gray-500">Record actual screen video (WebM) instead of relying only on DOM replay — useful for pages replay can't render faithfully (e.g. spreadsheets, canvas apps).</p>
  </div>
  <button
    role="switch"
    aria-checked={!!s?.videoRecordingEnabled}
    onClick={() => set('videoRecordingEnabled', !s?.videoRecordingEnabled)}
    className={`relative w-10 h-6 rounded-full transition-colors ${s?.videoRecordingEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${s?.videoRecordingEnabled ? 'translate-x-4' : ''}`} />
  </button>
</div>
```

Match the exact `set()` helper signature already used elsewhere on this page (verify it accepts `(key: keyof ExtensionSettings, value: any)` before pasting).

- [ ] **Step 3: Manual test**

Run: `cd platform && npm run dev` and `cd backend && npm run start:dev`. Open `/extension` settings page, toggle Video Recording on, reload the page.
Expected: toggle stays on after reload (confirms `PATCH /workspaces/settings` persisted it); reload the extension sidepanel — the video record button (Task 5) becomes visible.

- [ ] **Step 4: Commit**

```bash
git add backend/src/workspaces/workspaces.service.ts "platform/app/(dashboard)/extension/page.tsx"
git commit -m "feat: add videoRecordingEnabled workspace setting and toggle UI"
```

---

### Task 8: Platform — render attached video on issue detail page

**Files:**
- Modify: `platform/lib/types.ts`
- Modify: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`

**Interfaces:**
- Consumes: `Issue.videoUrl` (Task 3).
- Produces: rendered `<video>` element on the issue detail page.

- [ ] **Step 1: Add `videoUrl` to the `Issue` type**

```typescript
// platform/lib/types.ts — add alongside replayUrl:
  replayUrl?: string | null
  videoUrl?: string | null
```

- [ ] **Step 2: Render the video player**

```tsx
{/* platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx — insert directly
    after the closing </div> of the "Session Replay" block (after the ReplayPlayer usage): */}

{issue.videoUrl && (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screen Recording</h2>
    </div>
    <video
      controls
      src={issue.videoUrl}
      className="w-full rounded-lg ring-1 ring-gray-200 bg-black"
      style={{ maxHeight: '480px' }}
    />
  </div>
)}
```

- [ ] **Step 3: Manual test**

Using the extension, record a video, attach it to a real issue (Flow A or B), then open that issue's detail page in the platform.
Expected: "Screen Recording" section appears with a playable `<video>` element; playback works and controls (play/pause/seek/volume) function.

- [ ] **Step 4: Commit**

```bash
git add platform/lib/types.ts "platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx"
git commit -m "feat(platform): render attached video on issue detail page"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full happy-path test — single tab, Flow A**

With `videoRecordingEnabled: true`, open a page, click "Record Video" (no multi-tab), interact with the page for ~10s, click "Stop Video", leave attach dropdown alone, then click an element to file a bug and check "Attach recorded video" in the modal, submit.
Expected: issue appears in platform with a playable video matching what was on screen during recording.

- [ ] **Step 2: Full happy-path test — multi-tab, Flow B**

Enable multi-tab toggle, click "Record Video", pick "Entire Screen" in the native picker, switch between 2-3 tabs, click "Stop Video", use the attach dropdown to pick an existing issue.
Expected: video uploads and attaches; issue detail page shows the full-screen recording including the tab switches.

- [ ] **Step 3: Disabled-feature test**

Toggle `videoRecordingEnabled` off in platform settings, reload the extension sidepanel.
Expected: "Record Video" button and all video UI is hidden; no `tabCapture`/`getDisplayMedia` calls are triggered by any other button.

- [ ] **Step 4: Run full backend test suite**

Run: `cd backend && npx jest`
Expected: all tests pass, including the new `issues.service.spec.ts` cases from Tasks 2 and 3.

- [ ] **Step 5: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
