# Video Screen Recording — Design Spec

**Date:** 2026-06-30  
**Status:** Approved  

---

## Overview

Add real video screen recording to the QA Reporter Chrome extension. Unlike the existing rrweb DOM-replay recording, this captures actual video (WebM) of the screen or tab. The feature is gated behind a workspace settings toggle and integrates with the existing issue workflow — video can be attached at issue creation or linked to an existing issue.

---

## Feature Toggle

- New boolean field `videoRecordingEnabled` (default: `false`) stored in the `settings` JSONB column on the `workspaces` table.
- Managed from the platform extension settings page alongside `screenshotMode`.
- Extension syncs it via existing `SYNC_SETTINGS` message flow → cached in `qa_ext_settings`.
- When `false`, the video record button in the sidepanel is hidden entirely.

---

## Capture Strategy

| Mode | API Used | Trigger |
|------|----------|---------|
| Single-tab (default) | `chrome.tabCapture.getMediaStreamId()` → `getUserMedia` in sidepanel | Seamless, no picker |
| Multi-tab | `getDisplayMedia()` called directly from sidepanel | User picks screen/window once |

Multi-tab mode is detected from existing `qa_multitab_mode` flag in `chrome.storage.local`.

**Manifest change:** add `"tabCapture"` to the `permissions` array.

---

## Recording Flow

```
User clicks "Record Video" in sidepanel
  ├─ multi-tab ON  → sidepanel calls getDisplayMedia()
  └─ single-tab    → sidepanel sends START_VIDEO_RECORDING to background
                       → background calls chrome.tabCapture.getMediaStreamId({ targetTabId })
                       → returns { streamId } to sidepanel
                       → sidepanel calls getUserMedia({ video: { mandatory: {
                             chromeMediaSource: 'tab',
                             chromeMediaSourceId: streamId } } })

MediaRecorder created: mimeType = 'video/webm;codecs=vp9'
Blobs accumulated in sidepanel memory on dataavailable

User clicks "Stop Video"
  → MediaRecorder.stop()
  → Blob assembled from chunks (type: 'video/webm')
  → Blob held in sidepanel state (not uploaded yet)
  → Sidepanel shows "Attach to Issue" options
```

---

## Sidepanel UI

**Button:** `btn-video-recording` — positioned below existing rrweb recording controls. Independent of rrweb recording (can run simultaneously or standalone).

**States:**
- **Idle:** "Record Video" (grey, camera icon) — hidden when `videoRecordingEnabled` is false
- **Recording:** "Stop Video" (red, pulsing dot + elapsed timer)
- **Stopped / pending attach:** "Attach to Issue ↓" (dropdown) + "Discard"
- **Uploading:** spinner + "Uploading…" (button disabled)
- **Done:** success toast with issue link

---

## Issue Attachment — Two Flows

### Flow A — New Issue (attach on creation)

```
Recorded video blob sits in sidepanel memory
User captures bug element → issue submit modal opens
Modal shows: "Attach recorded video? [Yes / No]"
On submit (Yes):
  → background uploads blob to Supabase Storage → returns storagePath
  → POST /api/issues { ...issueFields, videoStoragePath }
  → backend saves videoStoragePath on issue row
  → sidepanel clears video blob from memory
```

### Flow B — Existing Issue

```
After recording stops, sidepanel shows "Attach to Issue" dropdown
Dropdown fetches last 10 issues for current project (GET /api/issues?projectId=X&limit=10)
User selects an issue
  → background uploads blob to Supabase Storage → returns storagePath
  → PATCH /api/issues/:id { videoStoragePath }
  → backend saves path; sidepanel shows success toast
```

---

## Backend Changes

### Database Migration

```sql
ALTER TABLE issues ADD COLUMN video_storage_path TEXT;
```

### POST /api/issues

Accept optional `videoStoragePath: string` in request body. If present, save to `issues.video_storage_path`.

### PATCH /api/issues/:id

New endpoint (or extend existing if present). Accepts `{ videoStoragePath: string }`. Validates JWT, verifies issue belongs to user's workspace, updates `video_storage_path`.

### Video Upload

No separate upload endpoint needed. Upload happens inside the background service worker before calling either issue endpoint:

```
background receives UPLOAD_AND_ATTACH_VIDEO message
  → fetch blob from sidepanel (passed as ArrayBuffer via message)
  → supabase.storage.from('videos').upload(`${workspaceId}/${issueId || Date.now()}.webm`, blob)
  → returns { storagePath }
```

Videos stored in Supabase Storage under `videos/` path (same bucket as screenshots, or separate `videos` bucket — prefer separate for quota clarity).

---

## Platform Dashboard

- Issue detail page: if `video_storage_path` is set, fetch a signed URL and render `<video controls>` element.
- Signed URL TTL: 1 hour (same as screenshot pattern).
- No changes to issue list view (v1).

---

## Background Message Handlers

| Message type | Handler | Description |
|---|---|---|
| `START_VIDEO_RECORDING` | `handleStartVideoRecording` | Gets `tabCapture` stream ID, returns it to sidepanel |
| `UPLOAD_VIDEO` | `handleUploadVideo` | Receives ArrayBuffer, uploads to Storage, returns storagePath |

MediaRecorder runs entirely in sidepanel (DOM context) — no offscreen document needed.

---

## Effort Estimate

| Area | Est |
|------|-----|
| Manifest: add tabCapture permission | 0.5h |
| Sidepanel: button, timer, state machine | 3h |
| Background: `START_VIDEO_RECORDING` + `UPLOAD_VIDEO` handlers | 2h |
| MediaRecorder logic in sidepanel | 3h |
| Multi-tab: `getDisplayMedia` path | 2h |
| Backend: `video_storage_path` migration + PATCH endpoint | 3h |
| Platform: video player in issue detail | 2h |
| Settings toggle (platform + sync to extension) | 1h |
| **Total** | **~16.5h / ~2.5 days** |

---

## Out of Scope (v1)

- Video trimming or editing
- Video thumbnail generation
- Attaching multiple videos to one issue
- Video playback inside the extension sidepanel
- Issue list showing video indicator badge
