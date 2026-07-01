# Video Recording — Audio + Webcam Design Spec

**Date:** 2026-07-01
**Status:** Approved

---

## Overview

Extend the existing video screen recording feature (see [2026-06-30-video-screen-recording-design.md](2026-06-30-video-screen-recording-design.md)) with two independent, opt-in additions: mixed mic + tab audio on the screen recording, and a separate silent webcam recording. Both are gated behind their own workspace-settings toggles, default off, and only appear when the base `videoRecordingEnabled` setting is on.

---

## Toggles (extension settings)

Two new boolean fields on `ExtensionSettings`, both default `false`:

- `captureAudioEnabled` — mixes microphone + tab/system audio into the screen recording's audio track.
- `captureWebcamEnabled` — records a small separate silent webcam video alongside the screen recording.

Independent of each other. Both hidden in the sidepanel UI when `videoRecordingEnabled` is `false` (same visibility gating pattern as the existing video-record button).

---

## Audio Flow

No second `MediaRecorder` for audio — the existing screen `MediaRecorder` simply gets an extra mixed audio track added to its source `MediaStream` before recording starts.

```
startVideoRecording() (existing, per 2026-06-30 plan)
  screenStream = tabCapture stream (single-tab) or getDisplayMedia stream (multi-tab)
                 — request { audio: true } in both cases so tab/system audio is available

  if captureAudioEnabled:
    micStream = await getUserMedia({ audio: true })
    audioCtx = new AudioContext()
    dest = audioCtx.createMediaStreamDestination()
    audioCtx.createMediaStreamSource(micStream).connect(dest)
    if screenStream has an audio track:
      audioCtx.createMediaStreamSource(new MediaStream([screenStream audio track])).connect(dest)
    screenStream.addTrack(dest.stream.getAudioTracks()[0])

  MediaRecorder(screenStream, { mimeType: 'video/webm;codecs=vp9,opus' })
```

If `captureAudioEnabled` is off, behavior is unchanged from the existing plan (video-only, no audio track requested).

**Permission handling:** `getUserMedia({ audio: true })` prompts the user for mic access the first time. If the user denies it, audio capture is skipped silently (screen recording proceeds video-only) and a one-time toast informs them: "Microphone access denied — recording without audio."

---

## Webcam Flow

A second, independent `MediaRecorder` records the webcam feed as its own silent WebM blob, started and stopped in lockstep with the screen recorder (same button, same timer).

```
if captureWebcamEnabled:
  webcamStream = await getUserMedia({ video: { width: 320, height: 240 } })  // no audio requested
  webcamMediaRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm;codecs=vp9' })
  webcamMediaRecorder.start()  // starts alongside the screen recorder in startVideoRecording()
  // stops alongside the screen recorder in stopVideoRecording()
```

If the user denies camera access, webcam capture is skipped silently (screen recording proceeds without it) with the same one-time toast pattern as audio denial: "Camera access denied — recording without webcam."

Two blobs result from one recording session:
- `videoBlob` — screen video, with mixed audio track if `captureAudioEnabled` was on.
- `webcamBlob` — silent webcam video, only present if `captureWebcamEnabled` was on and permission was granted.

---

## Upload & Attach

Both blobs upload and attach to the same issue in the same request flow already built (Flow A: attach-at-creation; Flow B: attach-to-existing-issue dropdown). The existing `UPLOAD_AND_ATTACH_VIDEO` background message gains an optional `webcamBase64` field:

```
sidepanel sends: { type: 'UPLOAD_AND_ATTACH_VIDEO', base64, webcamBase64?, projectId, issueId }
background:
  uploads base64 → POST /issues/upload-video → storagePath
  if webcamBase64: uploads webcamBase64 → POST /issues/upload-video (same endpoint, video field) → webcamStoragePath
  PATCH /issues/:id/video { videoStoragePath, webcamStoragePath? }
```

### Backend changes

- DB migration: `ALTER TABLE issues ADD COLUMN IF NOT EXISTS webcam_storage_path TEXT;` (same idempotent style as `video_storage_path`'s migration).
- `AttachVideoDto` gains optional `webcamStoragePath?: string`.
- `IssuesService.attachVideo()` sets `webcam_storage_path` on the update when present.
- `IssuesService.findOne()` additionally signs `webcam_storage_path` (same `videos` bucket, same 1-hour TTL pattern as `video_storage_path`) into a `webcamUrl` field on the response.
- `POST /issues/upload-video` is reused as-is for both the screen video and webcam blob — no new endpoint needed, since both are just WebM blobs uploaded to the same `videos` bucket under the same path convention (`${userId}/${projectId}/${timestamp}-video.webm` vs `${timestamp}-webcam.webm`).

---

## Playback (Platform Issue Detail Page)

The issue detail page's existing `<video>` element (added in the prior video-recording feature) is replaced with a small `WebcamOverlayPlayer` component when `issue.webcamUrl` is present:

- Screen `<video>` fills the existing frame (unchanged).
- Webcam `<video>` is absolutely positioned bottom-right, circular (`border-radius: 50%`), ~120px diameter, `muted` (screen video carries all audio).
- A single set of play/pause/seek controls drives both `<video>` elements: `onPlay`/`onPause`/`onSeeked` on the screen video are mirrored onto the webcam video's `currentTime`/`play()`/`pause()`.
- If `issue.webcamUrl` is absent (webcam wasn't recorded, or permission was denied at capture time), render just the existing plain screen `<video>` — no behavior change from the prior feature.

No new player library — plain HTML5 `<video>` elements with a thin sync wrapper, matching the project's existing preference for lightweight, dependency-free components (per `ReplayPlayer` precedent).

---

## Settings UI (Platform Extension Settings Page)

Two new `ToggleRow`s added to the existing "Session Replay" section, directly below the "Video Recording" toggle added in the prior feature:

- **Capture Audio** — "Record microphone and tab audio alongside the screen video."
- **Capture Webcam** — "Record a small webcam video overlay alongside the screen video."

Both only meaningfully take effect when "Video Recording" is also on — no UI-level graying/disabling is required (same pattern as `multiTabRecording` not being gated by `videoRecordingEnabled` in the UI; the extension itself gates on read).

---

## Permissions

No new `manifest.json` permissions required. `getUserMedia({ audio: true })` and `getUserMedia({ video: true })` for mic/webcam are standard Web APIs available to any extension page (sidepanel), gated by the browser's own per-origin permission prompt — not a Chrome extension permission. This differs from `tabCapture`, which does require a manifest permission (already added in the prior feature).

---

## Effort Estimate

| Area | Est |
|------|-----|
| Audio: AudioContext mixing in `startVideoRecording` | 2h |
| Webcam: second `MediaRecorder` lifecycle wired to existing start/stop | 2h |
| Permission-denial handling (toasts, graceful fallback) for both | 1.5h |
| Backend: `webcam_storage_path` migration + DTO + service wiring | 2h |
| Platform: `WebcamOverlayPlayer` component + sync logic | 3h |
| Settings toggles (platform UI + sync) | 1h |
| **Total** | **~11.5h / ~1.5 days** |

---

## Out of Scope (this iteration)

- True canvas-compositing (single merged file with webcam baked into the video pixels) — rejected in favor of playback-time overlay for lower implementation risk; may be revisited later if a downloadable "burned-in" file is needed.
- Choosing which camera/mic device when multiple are available (uses browser default).
- Webcam shape/position customization (fixed bottom-right circle for v1).
- Audio level meter / mute-mid-recording controls.
