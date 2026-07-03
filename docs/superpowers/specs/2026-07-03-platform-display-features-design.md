# Platform Display Features Design Spec (Track B)

**Date:** 2026-07-03
**Status:** Approved

---

## Background

Track A (extension capture controls — pre-recording toggles, mid-recording webcam pause, device selection wiring) shipped and merged first, per explicit user ordering. This spec covers the three remaining approved items from the original batch of five, all platform/backend-facing rather than extension-facing:

1. Video thumbnail generation
2. Issue list video indicator badge
3. Webcam circle resize in the video player

Three independent-but-related display improvements, bundled into a single build cycle at the user's request ("let's close these").

---

## 1. Thumbnail Generation (Extension)

When `startVideoRecording()`'s `onstop` handler fires in `extension/sidepanel.js` (where `videoBlob` is currently created), render the recorded video into an offscreen `<video>` element, seek to 1 second in (or `duration / 2` if the clip is shorter than 2 seconds), draw the current frame to a `<canvas>`, and export it as a JPEG blob via `canvas.toBlob()`.

This thumbnail blob is attached to the same submission payload as the video/webcam clips (base64-encoded, same pattern as the existing clips) and uploaded to the existing `videos` Supabase Storage bucket under `${userId}/${projectId}/${timestamp}-thumb.jpg`.

**Backend:**
- New migration adds `thumbnail_storage_path` (text, nullable) to `issues`, mirroring the existing `video_storage_path`/`webcam_storage_path` columns.
- `findOne` in `issues.service.ts` generates a 1-hour signed URL for `thumbnailUrl` from the `videos` bucket, alongside the existing `videoUrl`/`webcamUrl` generation, following the identical pattern (lines ~144-158 in the current service).
- The upload/create DTO gains an optional `thumbnailStoragePath?: string` field, mirroring `videoStoragePath`.

**Failure handling:** Thumbnail generation is best-effort and must never block or fail the video upload. If canvas rendering fails (tainted canvas, video too short, browser quirk), the extension catches the error, skips the thumbnail, and submits the issue with `thumbnailStoragePath` omitted — exactly as issues already work today without a thumbnail.

---

## 2. Issue List Video Indicator Badge

On the issue list table (`platform/app/(dashboard)/projects/[id]/page.tsx`, current columns: index, description, route, status badge, created date, arrow link), add a small video-camera icon badge in a new column inserted directly after the existing status badge column, shown only for rows where `issue.videoUrl` is present.

- Pure presence indicator — no separate click target. The row's existing click-through to issue detail is unchanged.
- Hovering the icon shows a small thumbnail preview in a tooltip/popover. The signed `thumbnailUrl` is fetched lazily on hover, not preloaded for every row on page load (avoids a burst of signed-URL requests for long issue lists).
- If a video exists but no thumbnail does (older issues recorded before this feature shipped, or thumbnail generation failed silently at capture time), the badge still renders — the hover tooltip falls back to a generic video icon instead of a preview frame. The badge's presence is driven by `videoUrl`, not by `thumbnailUrl`.

---

## 3. Webcam Circle Resize (VideoPlayer)

In `platform/components/VideoPlayer.tsx`, the webcam overlay's size (currently a hardcoded `120px` constant, referenced at the drag-calculation site and the inline circle style) becomes component state (`webcamSize`, default `120`), loaded on mount from a new localStorage key `qa-video-webcam-size` — mirroring how the existing corner position is loaded via `loadSavedCorner()` from `qa-video-webcam-corner`.

- A small drag handle renders at the circle's edge, visible on hover — same visibility pattern as the existing drag-to-reposition interaction.
- Dragging the handle adjusts `webcamSize` continuously, clamped to an **80px–200px** range.
- The final size is persisted to `qa-video-webcam-size` on drag-end (pointer-up), not on every pointer-move — matching the existing corner-drag's persist-on-release pattern, avoiding write-spam to localStorage.
- Resize and reposition (corner-snap) are independent, composable interactions on the same overlay element — the existing corner-snap logic is untouched by this change.

---

## Testing

No automated test framework exists for the extension (established convention). The platform has no existing frontend test suite for `VideoPlayer.tsx` or the issue list page either (confirmed: no `.test.tsx` files reference these components) — this spec does not introduce one, consistent with existing project conventions. The backend has a Jest suite; any new backend logic (thumbnail signed-URL generation) should get unit test coverage matching the existing `videoUrl`/`webcamUrl` test patterns in `issues.service.spec.ts` if such tests exist there, or a new focused test otherwise.

Manual verification checklist:
- Recording a video and submitting an issue produces a visible thumbnail in Supabase Storage and a working `thumbnailUrl` on the issue detail fetch.
- A very short recording (under 1 second) still submits successfully, with or without a thumbnail.
- The issue list shows the video badge only on rows with a video, and hovering shows the correct preview (or graceful fallback icon for videos without a thumbnail).
- Dragging the webcam resize handle smoothly scales the circle within 80–200px, and the size persists across a page reload.
- Resizing and repositioning (corner-drag) both still work independently after this change, with no regression to the existing corner-snap behavior.

---

## Out of Scope (this iteration)

- Retroactively generating thumbnails for issues submitted before this feature ships (existing videos without a thumbnail simply show the fallback icon in the badge tooltip, per section 2).
- Any change to video/webcam recording, mid-recording controls, or device selection (all covered by the already-shipped Track A).
- Automated test suite creation for `VideoPlayer.tsx` or the issue list page (matches existing project convention of no frontend test coverage here).
