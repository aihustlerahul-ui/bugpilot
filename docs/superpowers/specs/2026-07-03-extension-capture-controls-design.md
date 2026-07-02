# Extension Capture Controls Design Spec

**Date:** 2026-07-03
**Status:** Approved

---

## Background

Three gaps identified after the video/audio/webcam recording features shipped:

1. `captureAudioEnabled`/`captureWebcamEnabled` are workspace-wide settings pulled from the platform — there's no way for a tester to skip audio or webcam for a single recording without changing the team-wide setting.
2. Mid-recording, mic has a mute toggle (via a `GainNode`), but webcam has no equivalent — once webcam capture starts, it runs unpaused until the recording stops.
3. The media setup page (`setup.html`) already lets a tester pick a specific mic/camera device to *test*, but that choice is never persisted or read by the real recording code — `startVideoRecording()` in `sidepanel.js` always requests the browser's default device.

This spec closes all three gaps. Extension-only — no backend or platform changes.

---

## Pre-Recording Toggle (Per-Recording Override)

Two checkboxes, "Audio" and "Webcam", render inline in the `#media-status-row` alongside the existing mic/camera permission chips — each only visible when its corresponding workspace setting (`captureAudioEnabled`/`captureWebcamEnabled`) is `true`. Default checked state: matches the workspace setting (checked, since the row only shows when the setting is on). Unchecking is a one-recording-only override — it does not call `PATCH /workspaces/settings` or touch the workspace-level toggle in any way.

`startVideoRecording()` changes its gating condition from directly reading `settings.captureAudioEnabled`/`settings.captureWebcamEnabled` to reading the checkbox states (falling back to the workspace setting value if the row isn't rendered, i.e. recording triggered via some path that bypasses the UI — not expected today, but keeps the function safe if called directly).

---

## Mid-Recording Webcam Pause

Mirrors the existing mic mute UI and placement exactly (a small icon-button next to the webcam preview thumbnail in the sidepanel, matching `micMuteIcon`'s existing position and style), but toggles `webcamStream.getVideoTracks()[0].enabled` directly — unlike mic mute, which is routed through a `GainNode` specifically to keep the level meter's `AnalyserNode` reading real input while muted. Webcam has no equivalent meter dependency, so `track.enabled = false` is the correct, simpler tool here: per the [MediaStreamTrack spec](https://www.w3.org/TR/mediastream-recording/), a disabled video track outputs black frames to its consumers — meaning the recorded webcam clip will contain a black/frozen span for the paused duration, which is expected and sufficient per the approved design.

State variable `webcamPaused` (boolean, default `false`) resets alongside the existing `micMuted` reset in `stopVideoRecording()`'s cleanup block.

---

## Device Selection Wired Into Recording

### Persisting the choice (`setup.html` / `setup.js`)

On `change` of either device `<select>`, save the chosen `deviceId` to `localStorage` under two new keys — `qa-video-mic-device` and `qa-video-cam-device` — following the exact persistence pattern already established for `qa-video-webcam-corner` (plain string value, no JSON wrapper, read with a straightforward `localStorage.getItem`/`setItem`). Only the `deviceId` string is stored, not the device label (labels aren't guaranteed stable across browser sessions).

### Using the choice (`sidepanel.js`)

`startVideoRecording()` reads `qa-video-mic-device` / `qa-video-cam-device` from `localStorage` before calling `getUserMedia`. If a value exists, it's validated against a fresh `navigator.mediaDevices.enumerateDevices()` call (the saved device must still be present in the current `deviceId` list); if valid, `getUserMedia` is called with `{ deviceId: { exact: savedId } }` instead of the current unconstrained `{ audio: true }` / default-camera request. If no saved value exists, or the saved device is no longer present, recording falls back to the existing unconstrained default request — a missing/removed device must never block or fail a recording.

---

## Testing

No automated test framework exists for extension code (established in prior features in this project) — verification is `node --check` on both modified files (`extension/sidepanel.js`, `extension/setup.js`) plus a manual test checklist:

- Pre-recording checkboxes appear only when their workspace setting is on, and only before recording starts.
- Unchecking a box actually skips that capture for the recording (verified by checking the resulting issue has no audio track / no webcam attachment).
- Checking/unchecking does not change the workspace-level setting (verified via the platform settings page staying unchanged).
- Mid-recording webcam pause produces a visibly frozen/black span in the resulting webcam clip's playback, and resuming continues normally.
- Selecting a specific device on the setup page, then starting a real recording, actually captures from that device (verified by device indicator LEDs / OS-level device-in-use indicators, or by testing with two distinct devices and confirming the correct one activates).
- Unplugging the previously-selected device before recording falls back gracefully to the default device without error.

---

## Out of Scope (this iteration)

- Persisting the pre-recording checkbox state across sessions (each recording session defaults back to matching the workspace setting).
- A "pause audio entirely" mid-recording control beyond the existing mute (mute already achieves silence; a separate pause/resume-capture concept was not requested).
- Any platform/backend changes — this is purely an extension-side change.
