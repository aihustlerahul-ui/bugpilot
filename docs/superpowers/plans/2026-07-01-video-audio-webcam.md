# Video Recording — Audio + Webcam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in mic+tab audio mixing and a separate silent webcam recording to the existing video screen recording feature, with playback-time overlay in the platform dashboard.

**Architecture:** Audio is mixed into the existing screen `MediaRecorder`'s source stream via the Web Audio API (`AudioContext` + `MediaStreamAudioDestinationNode`) — no new recorder needed. Webcam is a second, independent `MediaRecorder` started/stopped in lockstep with the screen recorder, producing a silent second WebM blob. Both blobs reuse the existing `POST /issues/upload-video` endpoint; a new `webcam_storage_path` column and `webcamUrl` field parallel the existing `video_storage_path`/`videoUrl`. Platform issue detail page renders webcam as a synced, muted, circular overlay on top of the existing screen `<video>`.

**Tech Stack:** Chrome MV3 (`getUserMedia`, `AudioContext`, `MediaRecorder`), NestJS + Supabase Storage, Next.js 14 + TypeScript.

## Global Constraints

- Both new toggles (`captureAudioEnabled`, `captureWebcamEnabled`) default to `false` and are independent of each other.
- Both only take effect when `videoRecordingEnabled` is also `true` — no additional UI-level graying/disabling needed (same pattern as the existing `multiTabRecording` toggle).
- No new `manifest.json` permissions — mic/camera access uses standard `getUserMedia`, browser-prompted per-origin, not a declared Chrome extension permission (unlike `tabCapture`).
- Webcam video is recorded **silent** (no audio track) — the screen recording's (possibly audio-mixed) track is the only audio source, avoiding two competing audio tracks on playback.
- Webcam resolution: 320×240 (`getUserMedia({ video: { width: 320, height: 240 } })`).
- Storage bucket: same `videos` bucket used by the existing `video_storage_path`, same signed-URL 1-hour TTL pattern.
- Permission denial (mic or camera) must degrade gracefully: screen recording proceeds without that piece, with a one-time toast telling the user what was skipped — never blocks or aborts the recording.
- Follow existing code conventions: `qa_`-prefixed storage keys are not needed here (no new persisted flags beyond what's already in `qa_ext_settings`), `ToggleRow` component for platform settings UI, plain `<video>` elements (no new player library) for playback.

---

### Task 1: Database migration — `webcam_storage_path` column

**Files:**
- Create: `backend/migrations/20260701_webcam_storage_path.sql`

**Interfaces:**
- Produces: `issues.webcam_storage_path` column (nullable `text`), used by Task 2 (backend service) and Task 5 (platform detail page).

- [ ] **Step 1: Write the migration SQL**

```sql
-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Webcam recording: adds webcam_storage_path column to issues table to track
-- the silent webcam video recorded alongside the screen recording, stored in
-- the same private 'videos' Storage bucket as video_storage_path.
-- Idempotent — safe to re-run.

-- ── issues.webcam_storage_path ───────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS webcam_storage_path text;
```

Save this exact content to `backend/migrations/20260701_webcam_storage_path.sql`.

- [ ] **Step 2: Verify the file matches the existing migration style**

Run: `diff <(head -5 backend/migrations/20260630_video_storage_path.sql) <(head -5 backend/migrations/20260701_webcam_storage_path.sql)`
Expected: both files start with the same `-- Run this in Supabase SQL Editor...` header pattern (content differs after line 1, that's fine — just confirm the file was created and is valid SQL by eye).

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/20260701_webcam_storage_path.sql
git commit -m "feat(backend): add webcam_storage_path column to issues"
```

Note: as with the prior video migration, this SQL is NOT auto-applied — it must be run manually in the Supabase SQL Editor by the project owner (no live DB credentials are available to any automated process in this repo's dev setup).

---

### Task 2: Backend — `webcamStoragePath` on attach + `webcamUrl` on findOne

**Files:**
- Modify: `backend/src/issues/dto/attach-video.dto.ts`
- Modify: `backend/src/issues/issues.service.ts`
- Test: `backend/src/issues/issues.service.spec.ts`

**Interfaces:**
- Consumes: `issues.webcam_storage_path` column (Task 1).
- Produces: `AttachVideoDto.webcamStoragePath?: string`, `IssuesService.attachVideo()` now also persists `webcam_storage_path` when present, `IssuesService.findOne()` now also returns `webcamUrl: string | null` — consumed by Task 4 (background.js relay) and Task 6 (platform detail page).

- [ ] **Step 1: Write the failing test for `attachVideo` with webcam**

```typescript
// backend/src/issues/issues.service.spec.ts — add this describe block at the end of the file:

describe('IssuesService.attachVideo with webcam', () => {
  it('persists webcam_storage_path alongside video_storage_path when both are provided', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm', webcam_storage_path: 'user-1/p/1-webcam.webm' },
      error: null,
    })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    const result = await service.attachVideo('user-1', 'issue-1', {
      videoStoragePath: 'user-1/p/1-video.webm',
      webcamStoragePath: 'user-1/p/1-webcam.webm',
    })

    expect(result.webcam_storage_path).toBe('user-1/p/1-webcam.webm')
    expect(update).toHaveBeenCalledWith({
      video_storage_path: 'user-1/p/1-video.webm',
      webcam_storage_path: 'user-1/p/1-webcam.webm',
    })
  })

  it('omits webcam_storage_path from the update when not provided', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm' },
      error: null,
    })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    await service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/p/1-video.webm' })

    expect(update).toHaveBeenCalledWith({ video_storage_path: 'user-1/p/1-video.webm' })
  })
})

describe('IssuesService.findOne with webcam', () => {
  it('returns a signed webcamUrl when webcam_storage_path is set', async () => {
    const singleIssue = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm', webcam_storage_path: 'user-1/p/1-webcam.webm' },
      error: null,
    })
    const createSignedUrl = jest.fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://signed/video.webm' } })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://signed/webcam.webm' } })
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

    expect(result.webcamUrl).toBe('https://signed/webcam.webm')
    expect(createSignedUrl).toHaveBeenCalledWith('user-1/p/1-webcam.webm', 60 * 60)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest issues.service.spec.ts -t "webcam"`
Expected: FAIL — `webcamStoragePath` does not exist on the DTO type / `result.webcamUrl` is `undefined`.

- [ ] **Step 3: Add `webcamStoragePath` to `AttachVideoDto`**

```typescript
// backend/src/issues/dto/attach-video.dto.ts — full file:
import { IsOptional, IsString } from 'class-validator'

export class AttachVideoDto {
  @IsString()
  videoStoragePath: string

  @IsOptional()
  @IsString()
  webcamStoragePath?: string
}
```

- [ ] **Step 4: Update `attachVideo()` to conditionally include `webcam_storage_path`**

```typescript
// backend/src/issues/issues.service.ts — replace the existing attachVideo method:

  async attachVideo(userId: string, issueId: string, dto: AttachVideoDto) {
    const patch: { video_storage_path: string; webcam_storage_path?: string } = {
      video_storage_path: dto.videoStoragePath,
    }
    if (dto.webcamStoragePath) patch.webcam_storage_path = dto.webcamStoragePath

    const { data, error } = await this.supabase.db
      .from('issues')
      .update(patch)
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .select()
      .single()

    if (error || !data) throw new NotFoundException('Issue not found')
    return data
  }
```

- [ ] **Step 5: Update `findOne()` to also sign `webcam_storage_path`**

```typescript
// backend/src/issues/issues.service.ts — inside findOne(), after the existing videoUrl block, before `return { ...data, replayUrl, videoUrl };`:

    let webcamUrl: string | null = null;
    if (data.webcam_storage_path) {
      const { data: signedWebcam } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.webcam_storage_path, 60 * 60); // 1 hour
      webcamUrl = signedWebcam?.signedUrl ?? null;
    }

    return { ...data, replayUrl, videoUrl, webcamUrl };
```

Replace the existing `return { ...data, replayUrl, videoUrl };` line with the block above (it both adds the `webcamUrl` computation and updates the final return statement — do not leave the old return line in place).

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx jest issues.service.spec.ts`
Expected: PASS — full file passes (existing tests + 3 new ones = 10 total).

- [ ] **Step 7: Commit**

```bash
git add backend/src/issues/dto/attach-video.dto.ts backend/src/issues/issues.service.ts backend/src/issues/issues.service.spec.ts
git commit -m "feat(backend): persist and sign webcam_storage_path alongside video_storage_path"
```

---

### Task 3: Backend — `videoRecordingEnabled` sibling toggles in workspace settings

**Files:**
- Modify: `backend/src/workspaces/workspaces.service.ts`

**Interfaces:**
- Produces: `ExtensionSettings.captureAudioEnabled: boolean`, `ExtensionSettings.captureWebcamEnabled: boolean` — consumed by Task 4 (sidepanel visibility/behavior) and Task 7 (platform toggle UI).

- [ ] **Step 1: Add both fields to the `ExtensionSettings` interface**

```typescript
// backend/src/workspaces/workspaces.service.ts — replace this block:
  // Session Replay
  captureNavHistory: boolean
  multiTabRecording: boolean
  videoRecordingEnabled: boolean
}

// with:
  // Session Replay
  captureNavHistory: boolean
  multiTabRecording: boolean
  videoRecordingEnabled: boolean
  captureAudioEnabled: boolean
  captureWebcamEnabled: boolean
}
```

- [ ] **Step 2: Add both fields to `DEFAULT_SETTINGS`**

```typescript
// backend/src/workspaces/workspaces.service.ts — replace this block:
  captureNavHistory: true,
  multiTabRecording: false,
  videoRecordingEnabled: false,
}

// with:
  captureNavHistory: true,
  multiTabRecording: false,
  videoRecordingEnabled: false,
  captureAudioEnabled: false,
  captureWebcamEnabled: false,
}
```

- [ ] **Step 3: Type-check the backend**

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add backend/src/workspaces/workspaces.service.ts
git commit -m "feat(backend): add captureAudioEnabled and captureWebcamEnabled workspace settings"
```

---

### Task 4: Extension — mic+tab audio mixing and webcam MediaRecorder in sidepanel

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `qa_ext_settings.captureAudioEnabled`, `qa_ext_settings.captureWebcamEnabled` (Task 3, synced via the existing `SYNC_SETTINGS` flow already wired in `sidepanel.js`), the existing `videoMediaRecorder`/`videoBlob`/`startVideoRecording`/`stopVideoRecording` functions (unmodified signatures, extended bodies).
- Produces: a second in-memory blob `webcamBlob: Blob | null` (type `video/webm`, silent), consumed by Task 5 (upload/attach wiring) and Task 6 (content.js attach-on-create flow, which only needs to know a `webcamBlob` exists — no new content.js changes required per the spec, since the checkbox already just says "attach recorded video").

- [ ] **Step 1: Add webcam state variables**

```javascript
// extension/sidepanel.js — add directly after the existing video state block (after line 56, `let videoRecTimerInterval = null;`):
let webcamMediaRecorder = null;
let webcamChunks = [];
let webcamBlob = null;
```

- [ ] **Step 2: Extend `startVideoRecording()` to mix audio and start the webcam recorder**

```javascript
// extension/sidepanel.js — replace the full startVideoRecording function (originally lines 588-621):

async function startVideoRecording() {
  const { qa_multitab_mode, qa_ext_settings } = await chrome.storage.local.get(['qa_multitab_mode', 'qa_ext_settings']);
  const settings = qa_ext_settings || {};
  let stream;
  try {
    if (qa_multitab_mode) {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: !!settings.captureAudioEnabled });
    } else {
      const tab = await getActiveTab();
      const res = await chrome.runtime.sendMessage({ type: 'START_VIDEO_RECORDING', tabId: tab.id });
      if (!res || !res.ok) throw new Error(res?.error || 'Failed to start tab capture');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } },
        audio: settings.captureAudioEnabled
          ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } }
          : false,
      });
    }
  } catch (err) {
    showToast(`Could not start video recording: ${err.message}`, 'error', 4000);
    return;
  }

  if (settings.captureAudioEnabled) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(micStream).connect(dest);
      const tabAudioTracks = stream.getAudioTracks();
      if (tabAudioTracks.length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream([tabAudioTracks[0]])).connect(dest);
      }
      dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    } catch (err) {
      showToast('Microphone access denied — recording without audio.', 'error', 4000);
    }
  }

  if (settings.captureWebcamEnabled) {
    try {
      const webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      webcamChunks = [];
      webcamMediaRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm;codecs=vp9' });
      webcamMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) webcamChunks.push(e.data); };
      webcamMediaRecorder.onstop = () => {
        webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
        webcamStream.getTracks().forEach(t => t.stop());
      };
      webcamMediaRecorder.start();
    } catch (err) {
      showToast('Camera access denied — recording without webcam.', 'error', 4000);
    }
  }

  videoChunks = [];
  videoMediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
  videoMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
  videoMediaRecorder.onstop = () => {
    videoBlob = new Blob(videoChunks, { type: 'video/webm' });
    stream.getTracks().forEach(t => t.stop());
    chrome.storage.local.set({ qa_video_recording_pending: true });
    showVideoAttachRow();
  };
  videoMediaRecorder.start();
  videoRecStartedAt = Date.now();
  btnVideoRecording.textContent = 'Stop Video';
  videoRecTimerRow.style.display = '';
  videoRecTimerInterval = setInterval(updateVideoTimer, 1000);
}
```

Note: `showVideoAttachRow()` is called from `videoMediaRecorder.onstop`, which fires asynchronously after `MediaRecorder.stop()` — by the time it fires, `webcamMediaRecorder.onstop` (triggered in `stopVideoRecording`, Step 3 below) has very likely also already fired since both `.stop()` calls happen back-to-back synchronously and `onstop` firing order is not guaranteed but both complete within the same event loop turn in practice for short in-memory blobs. `webcamBlob` is read at attach time (Task 5), not at `onstop` time, so this ordering does not matter for correctness — only that both recorders have stopped before the user clicks "Attach to issue" or submits a bug, which the UI already gates on (the attach dropdown only appears after `stopVideoRecording` has been called).

- [ ] **Step 3: Extend `stopVideoRecording()` to also stop the webcam recorder**

```javascript
// extension/sidepanel.js — replace the existing stopVideoRecording function (originally lines 629-636):

function stopVideoRecording() {
  if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
    videoMediaRecorder.stop();
  }
  if (webcamMediaRecorder && webcamMediaRecorder.state !== 'inactive') {
    webcamMediaRecorder.stop();
  }
  clearInterval(videoRecTimerInterval);
  videoRecTimerRow.style.display = 'none';
  btnVideoRecording.textContent = 'Record Video';
}
```

- [ ] **Step 4: Manual test — audio mixing (single-tab)**

Enable "Capture Audio" in platform extension settings (added in Task 7 — for this manual test, use `curl` to PATCH the setting directly if Task 7 isn't done yet: `curl -X PATCH http://localhost:4000/api/workspaces/settings -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"captureAudioEnabled": true}'`). Load the unpacked extension, click "Record Video" on a page playing audio (e.g. a YouTube tab) while narrating out loud, click "Stop Video", then inspect the resulting blob by downloading it via the browser's dev tools (or proceed to Task 5's upload flow and play it back from the platform issue detail page once Task 6 is done).
Expected: no console errors from `AudioContext`; if a mic permission prompt appears, granting it allows recording to proceed; the resulting video (once played back) has both narration and tab audio audible.

- [ ] **Step 5: Manual test — webcam recording**

With "Capture Webcam" enabled the same way, click "Record Video", grant the camera permission prompt, record for a few seconds, click "Stop Video".
Expected: no console errors; `webcamBlob` is populated (verify via the sidepanel's dev tools console: `webcamBlob.size > 0` after recording stops).

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): mix mic+tab audio into screen recording and record webcam alongside it"
```

---

### Task 5: Extension — upload and attach the webcam blob alongside the video blob

**Files:**
- Modify: `extension/sidepanel.js`
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `webcamBlob` (Task 4), the existing `UPLOAD_AND_ATTACH_VIDEO` background message handler (`handleUploadAndAttachVideo`).
- Produces: `UPLOAD_AND_ATTACH_VIDEO` message now accepts an optional `webcamBase64` field; `handleUploadAndAttachVideo` uploads it (reusing the existing `POST /issues/upload-video` endpoint) and includes `webcamStoragePath` in the `PATCH /issues/:id/video` call.

- [ ] **Step 1: Update the three call sites in `sidepanel.js` that send `UPLOAD_AND_ATTACH_VIDEO` to also send `webcamBase64`**

There are three places `UPLOAD_AND_ATTACH_VIDEO` is sent: the `videoAttachSelect` change handler, and the `VIDEO_ATTACH_REQUESTED` listener. Update both.

```javascript
// extension/sidepanel.js — replace the videoAttachSelect change handler:

videoAttachSelect.addEventListener('change', async () => {
  const issueId = videoAttachSelect.value;
  if (!issueId || !videoBlob) return;
  const projectId = projectSelect.value;
  videoAttachSelect.disabled = true;
  const base64 = await blobToBase64(videoBlob);
  const webcamBase64 = webcamBlob ? await blobToBase64(webcamBlob) : undefined;
  const res = await chrome.runtime.sendMessage({
    type: 'UPLOAD_AND_ATTACH_VIDEO',
    base64,
    webcamBase64,
    projectId,
    issueId,
  });
  videoAttachSelect.disabled = false;
  if (res && res.ok) {
    videoAttachRow.style.display = 'none';
    videoBlob = null;
    videoChunks = [];
    webcamBlob = null;
    webcamChunks = [];
    chrome.storage.local.set({ qa_video_recording_pending: false });
  } else {
    showToast(`Failed to attach video: ${res?.error || 'unknown error'}`, 'error', 4000);
  }
});
```

```javascript
// extension/sidepanel.js — replace the VIDEO_ATTACH_REQUESTED listener body's inner async function:

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'VIDEO_ATTACH_REQUESTED') {
    (async () => {
      if (!videoBlob) {
        chrome.storage.local.set({ qa_video_recording_pending: false });
        return;
      }
      const projectId = projectSelect.value;
      const base64 = await blobToBase64(videoBlob);
      const webcamBase64 = webcamBlob ? await blobToBase64(webcamBlob) : undefined;
      const res = await chrome.runtime.sendMessage({
        type: 'UPLOAD_AND_ATTACH_VIDEO',
        base64,
        webcamBase64,
        projectId,
        issueId: message.issueId,
      });
      chrome.storage.local.set({ qa_video_recording_pending: false });
      if (res && res.ok) {
        videoBlob = null;
        videoChunks = [];
        webcamBlob = null;
        webcamChunks = [];
        videoAttachRow.style.display = 'none';
        showToast('Recorded video attached to the issue ✓', 'success', 3500);
      } else {
        showToast(`Video attach failed: ${res?.error || 'unknown error'} — use the Attach dropdown to retry`, 'error', 5000);
      }
    })();
  }
});
```

- [ ] **Step 2: Update `handleUploadAndAttachVideo` in `background.js` to upload the webcam blob and include it in the attach PATCH**

```javascript
// extension/background.js — replace the full handleUploadAndAttachVideo function:

async function handleUploadAndAttachVideo(message, sendResponse) {
  const { base64, webcamBase64, projectId, issueId } = message;
  if (!base64 || !projectId) { sendResponse({ ok: false, error: 'Missing base64 or projectId' }); return; }
  try {
    let { qa_token: token } = await chrome.storage.local.get(['qa_token']);
    const headers = () => {
      const h = { 'Content-Type': 'application/json' };
      if (token) h['Authorization'] = `Bearer ${token}`;
      return h;
    };

    let uploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ project_id: projectId, video: base64 }),
    });
    if (uploadRes.status === 401) {
      token = await tryRefreshToken();
      uploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ project_id: projectId, video: base64 }),
      });
    }
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    const { storagePath } = await uploadRes.json();

    let webcamStoragePath;
    if (webcamBase64) {
      let webcamUploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ project_id: projectId, video: webcamBase64 }),
      });
      if (webcamUploadRes.status === 401) {
        token = await tryRefreshToken();
        webcamUploadRes = await fetch(`${API_URL}/api/issues/upload-video`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ project_id: projectId, video: webcamBase64 }),
        });
      }
      if (webcamUploadRes.ok) {
        webcamStoragePath = (await webcamUploadRes.json()).storagePath;
      }
      // Webcam upload failure is non-fatal — the screen video still attaches without it.
    }

    if (issueId) {
      const patchBody = { videoStoragePath: storagePath };
      if (webcamStoragePath) patchBody.webcamStoragePath = webcamStoragePath;
      let attachRes = await fetch(`${API_URL}/api/issues/${issueId}/video`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(patchBody),
      });
      if (attachRes.status === 401) {
        token = await tryRefreshToken();
        attachRes = await fetch(`${API_URL}/api/issues/${issueId}/video`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify(patchBody),
        });
      }
      if (!attachRes.ok) throw new Error(`Attach failed: ${attachRes.status} (video uploaded to ${storagePath} but not linked — retry attach from the sidepanel)`);
    }

    sendResponse({ ok: true, storagePath, webcamStoragePath });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Video upload failed' });
  }
}
```

- [ ] **Step 3: Syntax-check both files**

Run: `node --check extension/sidepanel.js && node --check extension/background.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Manual test — combined upload**

With both audio and webcam capture enabled, record a video, attach it to an existing issue via the sidepanel dropdown.
Expected: no errors in the sidepanel or background service worker console; two separate objects appear in the `videos` Supabase Storage bucket (one `-video.webm`, one shortly after with a later timestamp — both under the same `${userId}/${projectId}/` prefix).

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.js extension/background.js
git commit -m "feat(extension): upload and attach the webcam blob alongside the screen video"
```

---

### Task 6: Platform — `captureAudioEnabled`/`captureWebcamEnabled` toggles in Extension Settings

**Files:**
- Modify: `platform/app/(dashboard)/extension/page.tsx`

**Interfaces:**
- Consumes: `ExtensionSettings.captureAudioEnabled`, `ExtensionSettings.captureWebcamEnabled` (Task 3), the existing `ToggleRow` component and `set()` helper already used on this page.
- Produces: two new toggle rows in the "Session Replay" section, synced to the extension via the existing `SYNC_SETTINGS` flow.

- [ ] **Step 1: Add both fields to the local `ExtensionSettings` interface**

```typescript
// platform/app/(dashboard)/extension/page.tsx — replace:
  multiTabRecording: boolean
  videoRecordingEnabled: boolean
  formExpectedResult: boolean

// with:
  multiTabRecording: boolean
  videoRecordingEnabled: boolean
  captureAudioEnabled: boolean
  captureWebcamEnabled: boolean
  formExpectedResult: boolean
```

- [ ] **Step 2: Add two `ToggleRow`s below the existing "Video Recording" toggle**

```tsx
{/* platform/app/(dashboard)/extension/page.tsx — replace: */}
          <ToggleRow
            label="Video Recording"
            description="Record actual screen video (WebM) instead of relying only on DOM replay — useful for pages replay can't render faithfully (e.g. spreadsheets, canvas apps)."
            enabled={s?.videoRecordingEnabled ?? false}
            onChange={v => set('videoRecordingEnabled', v)}
          />
        </>}
      </Section>

{/* with: */}
          <ToggleRow
            label="Video Recording"
            description="Record actual screen video (WebM) instead of relying only on DOM replay — useful for pages replay can't render faithfully (e.g. spreadsheets, canvas apps)."
            enabled={s?.videoRecordingEnabled ?? false}
            onChange={v => set('videoRecordingEnabled', v)}
          />
          <ToggleRow
            label="Capture Audio"
            description="Record microphone and tab audio alongside the screen video."
            enabled={s?.captureAudioEnabled ?? false}
            onChange={v => set('captureAudioEnabled', v)}
          />
          <ToggleRow
            label="Capture Webcam"
            description="Record a small webcam video overlay alongside the screen video."
            enabled={s?.captureWebcamEnabled ?? false}
            onChange={v => set('captureWebcamEnabled', v)}
          />
        </>}
      </Section>
```

- [ ] **Step 3: Type-check the platform**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"` then compare against the pre-existing error count on `main` before this change (`git stash && npx tsc --noEmit 2>&1 | grep -c "error TS"; git stash pop`) — the count must be identical (this page already has pre-existing, unrelated `ReactNode` type errors further down the file; this task must not add new ones).
Expected: same error count before and after.

- [ ] **Step 4: Manual test**

Run `cd platform && npm run dev` and `cd backend && npm run start:dev`. Open `/extension` settings page, toggle "Capture Audio" and "Capture Webcam" on, reload the page.
Expected: both toggles persist as on after reload.

- [ ] **Step 5: Commit**

```bash
git add "platform/app/(dashboard)/extension/page.tsx"
git commit -m "feat(platform): add Capture Audio and Capture Webcam toggles"
```

---

### Task 7: Platform — webcam overlay player on issue detail page

**Files:**
- Modify: `platform/lib/types.ts`
- Modify: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`

**Interfaces:**
- Consumes: `Issue.videoUrl` (existing), `Issue.webcamUrl` (Task 2's backend change, needs a matching type field here).
- Produces: a synced, muted, circular webcam overlay rendered on top of the existing screen `<video>` when `issue.webcamUrl` is present; unchanged plain-video behavior when it is absent.

- [ ] **Step 1: Add `webcamUrl` to the `Issue` type**

```typescript
// platform/lib/types.ts — replace:
  replayUrl?: string | null
  videoUrl?: string | null
}

// with:
  replayUrl?: string | null
  videoUrl?: string | null
  webcamUrl?: string | null
}
```

- [ ] **Step 2: Replace the plain `<video>` block with a synced overlay when webcam is present**

```tsx
{/* platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx — replace the existing
    "Screen Recording (video)" block: */}

{/* Screen Recording (video) */}
{issue.videoUrl && (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Screen Recording</h2>
    </div>
    <div className="relative w-full rounded-lg overflow-hidden ring-1 ring-gray-200 bg-black" style={{ maxHeight: '480px' }}>
      <video
        controls
        src={issue.videoUrl}
        className="w-full block"
        style={{ maxHeight: '480px' }}
        onPlay={e => {
          const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
          webcam?.play().catch(() => {})
        }}
        onPause={e => {
          const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
          webcam?.pause()
        }}
        onSeeked={e => {
          const webcam = (e.currentTarget.parentElement?.querySelector('video[data-webcam]') as HTMLVideoElement | null)
          if (webcam) webcam.currentTime = e.currentTarget.currentTime
        }}
      />
      {issue.webcamUrl && (
        <video
          data-webcam
          src={issue.webcamUrl}
          muted
          className="absolute bottom-3 right-3 rounded-full ring-2 ring-white shadow-lg"
          style={{ width: '120px', height: '120px', objectFit: 'cover' }}
        />
      )}
    </div>
  </div>
)}
```

Note: this uses direct DOM queries (`querySelector`) rather than React refs deliberately, matching the simplicity level of the rest of this file (which already uses direct DOM/browser APIs elsewhere, e.g. `document.body.style.overflow` in the `Lightbox` component above). If `issue.webcamUrl` is absent, the `querySelector` calls simply find nothing and the optional-chaining/null-check no-ops — the screen video plays exactly as it did before this task.

- [ ] **Step 3: Type-check the platform**

Run: `cd platform && npx tsc --noEmit 2>&1 | grep -c "error TS"` and compare against the same pre-existing baseline count established in Task 6 Step 3.
Expected: same error count as after Task 6 (no new errors introduced).

- [ ] **Step 4: Manual test**

Using the extension with both video and webcam capture enabled, record and attach a video to a real issue, then open that issue's detail page in the platform.
Expected: the screen recording plays with a circular webcam video floating bottom-right; playing/pausing/seeking the main video mirrors the same state onto the webcam video; the webcam video is silent (no audio from it, only from the main video if audio capture was also on).

- [ ] **Step 5: Commit**

```bash
git add platform/lib/types.ts "platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx"
git commit -m "feat(platform): render synced webcam overlay on issue detail page"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full happy-path test — audio + webcam together**

With `captureAudioEnabled: true` and `captureWebcamEnabled: true`, record a video while narrating and facing the camera, on a page playing tab audio. Stop, attach to an existing issue via the dropdown.
Expected: issue detail page shows the screen video with audible narration + tab audio, and a synced silent webcam circle overlay.

- [ ] **Step 2: Permission-denial test — deny mic**

With `captureAudioEnabled: true`, click "Record Video" and deny the microphone permission prompt when it appears.
Expected: a toast reads "Microphone access denied — recording without audio."; the screen recording still proceeds and completes normally (video-only, no audio track).

- [ ] **Step 3: Permission-denial test — deny camera**

With `captureWebcamEnabled: true`, click "Record Video" and deny the camera permission prompt.
Expected: a toast reads "Camera access denied — recording without webcam."; the screen recording still proceeds; no `webcamBlob` is produced, so no webcam overlay appears on the resulting issue's detail page.

- [ ] **Step 4: Independent-toggle test**

With `captureAudioEnabled: true` and `captureWebcamEnabled: false`, record and attach a video.
Expected: resulting issue has audio but no webcam overlay. Repeat with the toggles flipped (webcam on, audio off): resulting issue has a webcam overlay but the main video is silent.

- [ ] **Step 5: Run full backend test suite**

Run: `cd backend && npx jest`
Expected: all tests pass, including the new cases added in Task 2 (10 total, up from the prior feature's 7).

- [ ] **Step 6: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
