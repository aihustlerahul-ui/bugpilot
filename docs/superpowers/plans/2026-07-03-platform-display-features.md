# Platform Display Features (Track B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three previously-deferred display improvements — video thumbnail generation, an issue-list video indicator badge, and a resizable webcam overlay in the video player.

**Architecture:** Extension-side thumbnail capture (canvas frame grab) reuses the existing video/webcam upload pipeline end-to-end (extension → background.js → NestJS `/issues/upload-video` and `/issues/:id/video`), gaining a third parallel upload alongside the existing video/webcam ones. Backend gains one migration column and mirrors the existing `videoUrl`/`webcamUrl` signed-URL pattern for `thumbnailUrl`. Platform gains a badge column in the issue list table and a drag-resize handle on the existing webcam overlay in `VideoPlayer.tsx`, both additive to code paths already established in Track A.

**Tech Stack:** Vanilla JS extension (Canvas API for thumbnail capture), NestJS + Supabase Storage/Postgres backend, Next.js 14 + TypeScript + TailwindCSS platform, Jest for backend tests (no test framework exists for extension or platform — `node --check` / manual verification only).

## Global Constraints

- Thumbnail generation happens client-side in the extension at capture time (not a backend/ffmpeg step) — seek to 1s into the clip, or `duration / 2` for clips under 2s, draw to canvas, export as JPEG via `canvas.toBlob()`.
- Thumbnail generation is best-effort: any failure (tainted canvas, too-short clip, browser quirk) must be caught and silently skipped — it must never block or fail the underlying video upload/attach flow.
- Thumbnail storage: same `videos` Supabase bucket, path pattern `${userId}/${projectId}/${timestamp}-thumb.jpg`, mirroring the existing `-video.webm`/`-webcam.webm` path convention exactly.
- New DB column: `thumbnail_storage_path` (text, nullable) on `issues`, added via a new idempotent migration mirroring `backend/migrations/20260701_webcam_storage_path.sql`.
- New signed URL: `thumbnailUrl`, 1-hour expiry, generated in `findOne` exactly like `videoUrl`/`webcamUrl` (same bucket, same TTL).
- Issue list badge: pure presence indicator keyed on `issue.videoUrl` being truthy — no separate click target, row click-through to issue detail is unchanged. Hover shows a thumbnail preview lazily (not preloaded per row). Falls back to a generic icon if `thumbnailUrl` is absent even though `videoUrl` is present.
- Webcam resize: new `webcamSize` state (default `120`), persisted to a new localStorage key `qa-video-webcam-size` on drag-end only (not on every pointer-move), clamped to **80–200px**. Corner-snap logic (`corner`, `qa-video-webcam-corner`) is untouched and composes independently with resize.
- No automated test framework exists for the extension or the platform frontend — verification is `node --check` (extension) / TypeScript compilation + manual browser check (platform). The backend has a Jest suite (`backend/src/issues/issues.service.spec.ts`) — new backend logic gets unit tests following its existing mock patterns.

---

### Task 1: Backend — thumbnail storage path, migration, and signed URL

**Files:**
- Create: `backend/migrations/20260703_thumbnail_storage_path.sql`
- Modify: `backend/src/issues/dto/attach-video.dto.ts`
- Modify: `backend/src/issues/issues.service.ts`
- Test: `backend/src/issues/issues.service.spec.ts`

**Interfaces:**
- Consumes: existing `uploadVideo(base64, path)` private helper (`issues.service.ts:23-34`), existing `findOne`/`attachVideo` methods.
- Produces: `AttachVideoDto.thumbnailStoragePath?: string`; `IssuesService.findOne` return type gains `thumbnailUrl: string | null`; `attachVideo` persists `thumbnail_storage_path` when provided. Later tasks (extension, platform) consume `thumbnailUrl` on the issue object and the `thumbnailStoragePath` field on the attach payload.

- [ ] **Step 1: Write the migration file**

```sql
-- backend/migrations/20260703_thumbnail_storage_path.sql
-- Run this in Supabase SQL Editor for the QA Reporter project.
-- Video thumbnails: adds thumbnail_storage_path column to issues table to track
-- a JPEG frame grabbed client-side from the recorded video, stored in the same
-- private 'videos' Storage bucket as video_storage_path/webcam_storage_path.
-- Idempotent — safe to re-run.

-- ── issues.thumbnail_storage_path ────────────────────────────────────────────
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path text;
```

- [ ] **Step 2: Add `thumbnailStoragePath` to the attach DTO**

```typescript
// backend/src/issues/dto/attach-video.dto.ts — replace the full file:
import { IsOptional, IsString } from 'class-validator'

export class AttachVideoDto {
  @IsString()
  videoStoragePath: string

  @IsOptional()
  @IsString()
  webcamStoragePath?: string

  @IsOptional()
  @IsString()
  thumbnailStoragePath?: string
}
```

- [ ] **Step 3: Write the failing test for `attachVideo` persisting the thumbnail path**

```typescript
// backend/src/issues/issues.service.spec.ts — add this new describe block
// at the end of the file, after the existing "IssuesService.findOne with webcam" block:

describe('IssuesService.attachVideo with thumbnail', () => {
  it('persists thumbnail_storage_path alongside video_storage_path when provided', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm', thumbnail_storage_path: 'user-1/p/1-thumb.jpg' },
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
      thumbnailStoragePath: 'user-1/p/1-thumb.jpg',
    })

    expect(result.thumbnail_storage_path).toBe('user-1/p/1-thumb.jpg')
    expect(update).toHaveBeenCalledWith({
      video_storage_path: 'user-1/p/1-video.webm',
      thumbnail_storage_path: 'user-1/p/1-thumb.jpg',
    })
  })

  it('omits thumbnail_storage_path from the update when not provided', async () => {
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

describe('IssuesService.findOne with thumbnail', () => {
  it('returns a signed thumbnailUrl when thumbnail_storage_path is set', async () => {
    const singleIssue = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm', thumbnail_storage_path: 'user-1/p/1-thumb.jpg' },
      error: null,
    })
    const createSignedUrl = jest.fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://signed/video.webm' } })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://signed/thumb.jpg' } })
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

    expect(result.thumbnailUrl).toBe('https://signed/thumb.jpg')
    expect(createSignedUrl).toHaveBeenCalledWith('user-1/p/1-thumb.jpg', 60 * 60)
  })

  it('returns null thumbnailUrl when thumbnail_storage_path is absent', async () => {
    const singleIssue = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/p/1-video.webm' },
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

    expect(result.thumbnailUrl).toBeNull()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && npx jest issues.service.spec.ts`
Expected: FAIL — `thumbnail_storage_path`/`thumbnailUrl` not implemented yet (3 new tests fail, existing tests still pass).

- [ ] **Step 5: Implement `thumbnailUrl` in `findOne` and thumbnail persistence in `attachVideo`**

```typescript
// backend/src/issues/issues.service.ts — replace the full findOne method:
  async findOne(userId: string, issueId: string) {
    const { data, error } = await this.supabase.db
      .from('issues')
      .select('*')
      .eq('id', issueId)
      .eq('reporter_id', userId)
      .single()
    if (error) throw new NotFoundException('Issue not found')

    let replayUrl: string | null = null;
    if (data.replay_storage_path) {
      const { data: signed } = await this.supabase.db.storage
        .from('qa-replays')
        .createSignedUrl(data.replay_storage_path, 60 * 60); // 1 hour
      replayUrl = signed?.signedUrl ?? null;
    }

    let videoUrl: string | null = null;
    if (data.video_storage_path) {
      const { data: signedVideo } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.video_storage_path, 60 * 60); // 1 hour
      videoUrl = signedVideo?.signedUrl ?? null;
    }

    let webcamUrl: string | null = null;
    if (data.webcam_storage_path) {
      const { data: signedWebcam } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.webcam_storage_path, 60 * 60); // 1 hour
      webcamUrl = signedWebcam?.signedUrl ?? null;
    }

    let thumbnailUrl: string | null = null;
    if (data.thumbnail_storage_path) {
      const { data: signedThumbnail } = await this.supabase.db.storage
        .from('videos')
        .createSignedUrl(data.thumbnail_storage_path, 60 * 60); // 1 hour
      thumbnailUrl = signedThumbnail?.signedUrl ?? null;
    }

    return { ...data, replayUrl, videoUrl, webcamUrl, thumbnailUrl };
  }
```

```typescript
// backend/src/issues/issues.service.ts — replace the full attachVideo method:
  async attachVideo(userId: string, issueId: string, dto: AttachVideoDto) {
    const patch: { video_storage_path: string; webcam_storage_path?: string; thumbnail_storage_path?: string } = {
      video_storage_path: dto.videoStoragePath,
    }
    if (dto.webcamStoragePath) patch.webcam_storage_path = dto.webcamStoragePath
    if (dto.thumbnailStoragePath) patch.thumbnail_storage_path = dto.thumbnailStoragePath

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

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest issues.service.spec.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/20260703_thumbnail_storage_path.sql backend/src/issues/dto/attach-video.dto.ts backend/src/issues/issues.service.ts backend/src/issues/issues.service.spec.ts
git commit -m "feat(backend): add thumbnail_storage_path column, signed thumbnailUrl, and attachVideo support"
```

---

### Task 2: Extension — client-side thumbnail capture and upload

**Files:**
- Modify: `extension/sidepanel.js`
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: Task 1's `AttachVideoDto.thumbnailStoragePath` field and the existing `POST /api/issues/upload-video` endpoint (reused as-is — a thumbnail JPEG is uploaded the same way a video is, since the endpoint just stores whatever `video` base64 payload it's given at the storage path it generates... **note:** the current `upload-video` endpoint always names the file `${timestamp}-video.webm` and always sets `contentType: 'video/webm'` regardless of what's actually uploaded — seenext step for why this is fine to reuse as-is for now, and what changes).
- Produces: `thumbnailBlob` module-level variable in `sidepanel.js`, populated in `videoMediaRecorder.onstop`; `UPLOAD_AND_ATTACH_VIDEO` message gains an optional `thumbnailBase64` field; `handleUploadAndAttachVideo` in `background.js` gains a third parallel upload and passes `thumbnailStoragePath` into the attach PATCH body.

**Design note on reusing `upload-video`:** the existing endpoint hardcodes `.webm` extension and `video/webm` content type (`backend/src/issues/issues.service.ts` `uploadVideoFile`/`uploadVideo`). Rather than uploading the thumbnail through that endpoint (which would mislabel a JPEG as a `.webm` video file — wrong content-type, wrong extension, and would break `<img>` rendering on the platform side), this task adds a **dedicated thumbnail upload path** in the backend reusing the same authentication/upload plumbing but with correct JPEG typing. This is a necessary correction to the design's "reuse the existing pipeline" intent — the intent (share auth, share DTO shape, share bucket) is preserved; the literal single endpoint is not reused for content-type-incompatible reasons.

- [ ] **Step 1: Add a dedicated thumbnail upload endpoint on the backend (small addition, precedes the extension work in this task since the extension calls it)**

```typescript
// backend/src/issues/dto/upload-thumbnail.dto.ts — new file:
import { IsString, MaxLength } from 'class-validator'

// JPEG thumbnails are small (single video frame) — 5MB base64 is generous headroom.
const MAX_THUMBNAIL_BASE64_LENGTH = 5 * 1024 * 1024

export class UploadThumbnailDto {
  @IsString()
  project_id: string

  @IsString()
  @MaxLength(MAX_THUMBNAIL_BASE64_LENGTH, { message: 'Thumbnail too large' })
  thumbnail: string
}
```

```typescript
// backend/src/issues/issues.service.ts — add this new private helper directly
// after the existing `uploadVideo` private method (issues.service.ts:23-34):
  private async uploadThumbnail(base64: string, path: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      const { error } = await this.supabase.db.storage
        .from('videos')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: false })
      if (error) return null
      return path
    } catch {
      return null
    }
  }

  async uploadThumbnailFile(userId: string, projectId: string, base64: string): Promise<{ storagePath: string }> {
    const timestamp = Date.now()
    const path = `${userId}/${projectId}/${timestamp}-thumb.jpg`
    const storagePath = await this.uploadThumbnail(base64, path)
    if (!storagePath) throw new Error('Thumbnail upload failed')
    return { storagePath }
  }
```

```typescript
// backend/src/issues/issues.controller.ts — add this new route directly after
// the existing `uploadVideo` handler (issues.controller.ts:40-43):
  @Post('upload-thumbnail')
  uploadThumbnail(@CurrentUser() user: AuthUser, @Body() dto: UploadThumbnailDto) {
    return this.issues.uploadThumbnailFile(user.id, dto.project_id, dto.thumbnail)
  }
```

Also add the import at the top of `issues.controller.ts`, alongside the existing `UploadVideoDto`/`AttachVideoDto` imports:

```typescript
import { UploadThumbnailDto } from './dto/upload-thumbnail.dto'
```

- [ ] **Step 2: Run backend syntax/type check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Add thumbnail capture to `videoMediaRecorder.onstop` in the extension**

```javascript
// extension/sidepanel.js — replace the existing videoMediaRecorder.onstop assignment
// (currently at line ~929) with this version that also captures a thumbnail:
  videoMediaRecorder.onstop = () => {
    videoBlob = new Blob(videoChunks, { type: 'video/webm' });
    stream.getTracks().forEach(t => t.stop());
    captureVideoThumbnail(videoBlob)
      .then((blob) => { thumbnailBlob = blob; })
      .catch(() => { thumbnailBlob = null; })
      .finally(() => {
        chrome.storage.local.set({ qa_video_recording_pending: true });
        showVideoAttachRow();
      });
  };
```

```javascript
// extension/sidepanel.js — add this new module-level variable near the other
// recording state variables (alongside `let videoBlob = null;` / `let webcamBlob = null;`):
let thumbnailBlob = null;
```

```javascript
// extension/sidepanel.js — add this new function near blobToBase64 (it will be
// used alongside it in the submission flow):
function captureVideoThumbnail(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const seekTime = video.duration >= 2 ? 1 : video.duration / 2;
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((thumbBlob) => {
          cleanup();
          if (thumbBlob) resolve(thumbBlob);
          else reject(new Error('canvas.toBlob returned null'));
        }, 'image/jpeg', 0.8);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Thumbnail source video failed to load'));
    };
  });
}
```

- [ ] **Step 4: Reset `thumbnailBlob` alongside the other recording state resets**

```javascript
// extension/sidepanel.js — in the existing btnDiscardVideo click listener,
// add thumbnailBlob = null; alongside the existing resets:
btnDiscardVideo.addEventListener('click', () => {
  videoBlob = null;
  videoChunks = [];
  webcamBlob = null;
  webcamChunks = [];
  thumbnailBlob = null;
  videoAttachRow.style.display = 'none';
  chrome.storage.local.set({ qa_video_recording_pending: false });
});
```

- [ ] **Step 5: Include the thumbnail in the attach submission**

```javascript
// extension/sidepanel.js — replace the existing videoAttachSelect 'change' listener:
videoAttachSelect.addEventListener('change', async () => {
  const issueId = videoAttachSelect.value;
  if (!issueId || !videoBlob) return;
  const projectId = projectSelect.value;
  videoAttachSelect.disabled = true;
  const base64 = await blobToBase64(videoBlob);
  const webcamBase64 = webcamBlob ? await blobToBase64(webcamBlob) : undefined;
  const thumbnailBase64 = thumbnailBlob ? await blobToBase64(thumbnailBlob) : undefined;
  const res = await chrome.runtime.sendMessage({
    type: 'UPLOAD_AND_ATTACH_VIDEO',
    base64,
    webcamBase64,
    thumbnailBase64,
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
    thumbnailBlob = null;
    chrome.storage.local.set({ qa_video_recording_pending: false });
  } else {
    showToast(`Failed to attach video: ${res?.error || 'unknown error'}`, 'error', 4000);
  }
});
```

- [ ] **Step 6: Handle the thumbnail upload in `background.js`'s `handleUploadAndAttachVideo`**

```javascript
// extension/background.js — replace the full handleUploadAndAttachVideo function:
async function handleUploadAndAttachVideo(message, sendResponse) {
  const { base64, webcamBase64, thumbnailBase64, projectId, issueId } = message;
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
      // Webcam upload failure (network error or non-OK response) is non-fatal —
      // the screen video still attaches without it.
      try {
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
      } catch (_) {}
    }

    let thumbnailStoragePath;
    if (thumbnailBase64) {
      // Thumbnail upload failure is non-fatal — the video still attaches without a preview.
      try {
        let thumbnailUploadRes = await fetch(`${API_URL}/api/issues/upload-thumbnail`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ project_id: projectId, thumbnail: thumbnailBase64 }),
        });
        if (thumbnailUploadRes.status === 401) {
          token = await tryRefreshToken();
          thumbnailUploadRes = await fetch(`${API_URL}/api/issues/upload-thumbnail`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ project_id: projectId, thumbnail: thumbnailBase64 }),
          });
        }
        if (thumbnailUploadRes.ok) {
          thumbnailStoragePath = (await thumbnailUploadRes.json()).storagePath;
        }
      } catch (_) {}
    }

    if (issueId) {
      const patchBody = { videoStoragePath: storagePath };
      if (webcamStoragePath) patchBody.webcamStoragePath = webcamStoragePath;
      if (thumbnailStoragePath) patchBody.thumbnailStoragePath = thumbnailStoragePath;
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

    sendResponse({ ok: true, storagePath, webcamStoragePath, thumbnailStoragePath });
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Video upload failed' });
  }
}
```

- [ ] **Step 7: Syntax-check**

Run: `node --check extension/sidepanel.js && node --check extension/background.js`
Expected: no output (clean)

- [ ] **Step 8: Commit**

```bash
git add backend/src/issues/dto/upload-thumbnail.dto.ts backend/src/issues/issues.service.ts backend/src/issues/issues.controller.ts extension/sidepanel.js extension/background.js
git commit -m "feat(extension): capture and upload a video thumbnail on recording stop"
```

---

### Task 3: Platform — issue-list video indicator badge

**Files:**
- Modify: `platform/lib/types.ts`
- Modify: `platform/app/(dashboard)/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `Issue.videoUrl`/`Issue.thumbnailUrl` (the latter added by this task to the `Issue` type, populated by Task 1's backend change).
- Produces: `Issue.thumbnailUrl?: string | null` field — no other task consumes this beyond this task's own rendering.

- [ ] **Step 1: Add `thumbnailUrl` to the `Issue` type**

```typescript
// platform/lib/types.ts — replace the Issue interface's trailing optional fields
// (currently lines 49-51) with:
  replayUrl?: string | null
  videoUrl?: string | null
  webcamUrl?: string | null
  thumbnailUrl?: string | null
```

- [ ] **Step 2: Add a video badge column to the issue list table**

```typescript
// platform/app/(dashboard)/projects/[id]/page.tsx — replace the table <thead> row
// (currently lines 151-157) to insert a new narrow header cell after "Status":
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-10">#</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Route</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="w-8" />
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
                        <th className="w-10" />
                      </tr>
```

```typescript
// platform/app/(dashboard)/projects/[id]/page.tsx — replace the row rendering
// (currently lines 159-208) to insert a new <td> cell after the status <td>:
                      {filtered.map((issue, i) => {
                        const st = STATUS_CONFIG[issue.sync_status] ?? STATUS_CONFIG.pending
                        const titleLine = issue.description.split('\n')[0]
                        const subLine   = issue.description.split('\n').slice(1).join(' ').trim()
                        return (
                          <tr key={issue.id} className="hover:bg-gray-50/60 transition-colors group">
                            <td className="px-5 py-4 text-xs text-gray-300 font-mono tabular-nums">{i + 1}</td>
                            <td className="px-5 py-4">
                              <Link href={`/projects/${params.id}/issues/${issue.id}`} className="block">
                                <span className="text-gray-900 font-medium group-hover:text-blue-600 transition-colors line-clamp-1 leading-snug">
                                  {titleLine}
                                </span>
                                {subLine && (
                                  <span className="text-gray-400 text-xs mt-0.5 line-clamp-1 block">
                                    {subLine}
                                  </span>
                                )}
                              </Link>
                            </td>
                            <td className="px-5 py-4 hidden md:table-cell">
                              <span className="text-gray-400 font-mono text-xs truncate max-w-[180px] block">
                                {issue.route ?? issue.url ?? '—'}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="px-1 py-4">
                              {issue.videoUrl && <VideoBadge thumbnailUrl={issue.thumbnailUrl} />}
                            </td>
                            <td className="px-5 py-4 hidden lg:table-cell text-xs text-gray-400 whitespace-nowrap">
                              {formatDate(issue.created_at)}
                            </td>
                            <td className="px-3 py-4">
                              <Link href={`/projects/${params.id}/issues/${issue.id}`}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-blue-500 text-base">
                                →
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
```

- [ ] **Step 3: Create the `VideoBadge` component**

```typescript
// platform/components/VideoBadge.tsx — new file:
'use client'

import { useState } from 'react'

interface VideoBadgeProps {
  thumbnailUrl?: string | null
}

export function VideoBadge({ thumbnailUrl }: VideoBadgeProps) {
  const [hovering, setHovering] = useState(false)

  return (
    <span
      className="relative inline-flex items-center justify-center"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-50 text-blue-500 text-xs"
        title="Video attached"
      >
        🎥
      </span>
      {hovering && (
        <span className="absolute z-10 left-1/2 -translate-x-1/2 bottom-full mb-2 rounded-lg shadow-lg border border-gray-200 bg-white p-1">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Video preview"
              className="w-28 h-16 object-cover rounded"
            />
          ) : (
            <span className="flex items-center justify-center w-28 h-16 rounded bg-gray-50 text-gray-300 text-2xl">
              🎥
            </span>
          )}
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Import `VideoBadge` in the issue list page**

```typescript
// platform/app/(dashboard)/projects/[id]/page.tsx — add near the top imports,
// alongside the existing component imports:
import { VideoBadge } from '@/components/VideoBadge'
```

- [ ] **Step 5: TypeScript check**

Run: `cd platform && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add platform/lib/types.ts platform/components/VideoBadge.tsx "platform/app/(dashboard)/projects/[id]/page.tsx"
git commit -m "feat(platform): add issue list video indicator badge"
```

---

### Task 4: Platform — webcam circle resize in VideoPlayer

**Files:**
- Modify: `platform/components/VideoPlayer.tsx`

**Interfaces:**
- Consumes: existing `corner`/`CORNER_CLASSES`/`dragPosition`/`dragging` state and `handleWebcamPointerDown` (untouched by this task).
- Produces: `webcamSize` state (number, default `120`) and `loadSavedWebcamSize()` — no other task consumes these.

- [ ] **Step 1: Add the webcam size localStorage key and loader function**

```typescript
// platform/components/VideoPlayer.tsx — add directly after the existing
// loadSavedCorner() function (lines 17-21):
const WEBCAM_SIZE_KEY = 'qa-video-webcam-size'
const MIN_WEBCAM_SIZE = 80
const MAX_WEBCAM_SIZE = 200
const DEFAULT_WEBCAM_SIZE = 120

function loadSavedWebcamSize(): number {
  if (typeof window === 'undefined') return DEFAULT_WEBCAM_SIZE
  const saved = Number(window.localStorage.getItem(WEBCAM_SIZE_KEY))
  if (!saved || Number.isNaN(saved)) return DEFAULT_WEBCAM_SIZE
  return Math.max(MIN_WEBCAM_SIZE, Math.min(MAX_WEBCAM_SIZE, saved))
}
```

- [ ] **Step 2: Add `webcamSize` state**

```typescript
// platform/components/VideoPlayer.tsx — add directly after the existing
// `const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)`
// state declaration:
  const [webcamSize, setWebcamSize] = useState<number>(() => loadSavedWebcamSize())
  const [resizing, setResizing] = useState(false)
```

- [ ] **Step 3: Use `webcamSize` (instead of the hardcoded local constant) in the drag calculation**

```typescript
// platform/components/VideoPlayer.tsx — replace this line inside handleWebcamPointerDown:
//   const webcamSize = 120
// with: (remove the line entirely — the function now closes over the component's
// `webcamSize` state instead of redeclaring a local constant of the same name)
```

The rest of `handleWebcamPointerDown` is unchanged — it already references `webcamSize` by name in its `onMove` calculation (`rect.width - webcamSize`, `rect.height - webcamSize`), so removing the local shadowing declaration makes it correctly read the component's live `webcamSize` state instead.

- [ ] **Step 4: Add the resize handle pointer handler**

```typescript
// platform/components/VideoPlayer.tsx — add directly after handleWebcamPointerDown
// (which ends with the closing `}, [])` around line 206):
  const handleResizeHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const wrapper = wrapperRef.current
    if (!wrapper) return
    ;(e.target as HTMLDivElement).setPointerCapture(e.pointerId)
    setResizing(true)

    const rect = wrapper.getBoundingClientRect()
    const startSize = webcamSize

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - (rect.left + rect.width)
      const dy = ev.clientY - (rect.top + rect.height)
      const delta = Math.max(dx, dy)
      const next = Math.max(MIN_WEBCAM_SIZE, Math.min(MAX_WEBCAM_SIZE, startSize + delta))
      setWebcamSize(next)
    }

    const onUp = () => {
      setResizing(false)
      setWebcamSize((current) => {
        window.localStorage.setItem(WEBCAM_SIZE_KEY, String(current))
        return current
      })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [webcamSize])
```

- [ ] **Step 5: Render the resize handle and use `webcamSize` in the webcam overlay's style**

```typescript
// platform/components/VideoPlayer.tsx — replace the webcam video element block
// (currently lines 247-262):
        {webcamUrl && (
          <div
            className={`absolute group/webcam ${
              dragPosition ? '' : CORNER_CLASSES[corner]
            } ${dragging || resizing ? 'transition-none' : 'transition-[top,left,right,bottom] duration-150'}`}
            style={
              dragPosition
                ? { width: `${webcamSize}px`, height: `${webcamSize}px`, left: dragPosition.x, top: dragPosition.y }
                : { width: `${webcamSize}px`, height: `${webcamSize}px` }
            }
          >
            <video
              ref={webcamRef}
              src={webcamUrl}
              muted
              onPointerDown={handleWebcamPointerDown}
              className="w-full h-full rounded-full ring-2 ring-white shadow-lg cursor-grab active:cursor-grabbing object-cover"
            />
            <div
              onPointerDown={handleResizeHandlePointerDown}
              className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-white ring-1 ring-gray-300 shadow cursor-nwse-resize opacity-0 group-hover/webcam:opacity-100 transition-opacity"
              title="Drag to resize"
            />
          </div>
        )}
```

- [ ] **Step 6: TypeScript check**

Run: `cd platform && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Manual test**

Start the platform dev server (`cd platform && npm run dev`), open an issue with a video+webcam attached, hover the webcam circle to reveal the resize handle at its bottom-right edge, drag it to grow/shrink the circle between roughly 80px and 200px, confirm it clamps at both ends, release, reload the page, and confirm the size persisted. Then drag the webcam circle itself (not the handle) to a different corner and confirm resize and reposition both still work independently.

- [ ] **Step 8: Commit**

```bash
git add platform/components/VideoPlayer.tsx
git commit -m "feat(platform): add drag-to-resize handle for the webcam overlay"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full regression check**

Run: `cd backend && npx jest && npx tsc --noEmit && cd ../platform && npx tsc --noEmit && cd ../ && node --check extension/sidepanel.js && node --check extension/background.js && echo OK`
Expected: `OK`, all backend tests passing (13/13 — 10 original + 3 new thumbnail tests).

- [ ] **Step 2: Full manual walkthrough**

1. Record a video (with webcam) in the extension, attach it to an issue, confirm the extension submits without error and a `-thumb.jpg` file lands in the `videos` bucket at the same `${userId}/${projectId}/` prefix as the video/webcam clips.
2. Record and submit a very short clip (under 2 seconds) — confirm it still submits successfully even if the thumbnail capture logic uses the `duration / 2` branch.
3. Open the project's issue list on the platform — confirm the video badge (🎥) appears only on rows with a video, and hovering shows the correct thumbnail preview.
4. Find or create an issue with a video but no thumbnail (e.g. by manually clearing `thumbnail_storage_path` in the DB, or an issue from before this feature) — confirm the badge still shows and the hover falls back to the generic icon.
5. Open that issue's detail page, confirm the webcam resize handle works as described in Task 4 Step 7.

- [ ] **Step 3: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
