# Media Permission Status, Mute, Level Meter & Webcam Preview — Design Spec

**Date:** 2026-07-01
**Status:** Approved

---

## Background

While testing the audio + webcam recording feature, a real usability gap surfaced: when microphone or camera permission is already in a `denied` state (blocked at the Chrome content-settings level, or the OS blocking Chrome entirely), `getUserMedia()` rejects instantly with `NotAllowedError` and **no visible prompt at all** — indistinguishable, from the user's point of view, from the extension silently doing nothing. The existing code (see `2026-07-01-video-audio-webcam-design.md`) only surfaces this after-the-fact via a toast once recording has already started.

This spec adds a small, always-visible status UI that shows real permission state *before* recording starts, lets the user re-trigger the native prompt when state is `prompt`, and adds live mic mute + level meter + webcam preview during recording.

---

## UI Placement & Visibility

A new **status row** appears in the sidepanel directly below the existing "Record Video" button (`#btn-video-recording`) — visible only when `captureAudioEnabled` or `captureWebcamEnabled` is `true` in `qa_ext_settings` (same gating pattern as `applyVideoRecordingVisibility`). It renders up to two chips, one per enabled capability:

- 🎤 **Mic chip** — shown when `captureAudioEnabled` is on
- 📷 **Camera chip** — shown when `captureWebcamEnabled` is on

Each chip follows the existing status-dot visual language (`.status-dot` pattern already used in `#status-bar`): a colored dot + short label.

---

## Permission State — Checking and Display

On sidepanel load, and whenever `qa_ext_settings` changes via `chrome.storage.onChanged` (mirroring the existing `applyMultiTabVisibility`/`applyVideoRecordingVisibility` listeners), call:

```js
const micStatus = await navigator.permissions.query({ name: 'microphone' });
const camStatus = await navigator.permissions.query({ name: 'camera' });
```

Each chip renders based on `.state`:

| State | Dot | Label | Click behavior |
|---|---|---|---|
| `granted` | green | "Ready" | none |
| `prompt` | grey | "Not yet granted" | clicking the chip calls `getUserMedia({audio:true})` / `{video:true}` directly — a real click is a user gesture, so Chrome's native permission popup appears |
| `denied` | red | "Blocked" | clicking opens `chrome://settings/content/microphone` or `.../camera` via `chrome.tabs.create({ url })` (chips are `<button>`s, not links, since `chrome://` URLs can't be plain `<a href>` targets from an extension page reliably) |

Each `PermissionStatus` object exposes `.onchange` — attach a listener on both so the chip updates live if the user fixes the block while the sidepanel is still open (e.g., they open `chrome://settings/content/camera` in another tab, flip it to Allow, and switch back — no manual refresh needed).

---

## Lifting Stream References to Module Scope

Currently `micStream` and `webcamStream` are `const`s local to their respective `try` blocks inside `startVideoRecording()` — inaccessible outside that function. This design adds two new module-level state variables, following the existing `activeAudioCtx` pattern:

```js
let activeMicStream = null;
let activeWebcamStream = null;
```

Both are set when their respective `getUserMedia()` calls succeed inside `startVideoRecording()`, and cleared (tracks stopped is already handled elsewhere; just null the reference) in `stopVideoRecording()`, alongside the existing `activeAudioCtx` cleanup.

---

## During-Recording Controls

Once `activeMicStream` is set, the mic chip upgrades in place to show:

- **Mute toggle button** — toggles `activeMicStream.getAudioTracks()[0].enabled`. This flips the track's enabled flag (silences it without stopping the hardware or requiring re-permission) — the icon swaps between a mic and a mic-with-slash.
- **Level meter** — a small animated horizontal bar. Implementation: a *second*, independent `AnalyserNode` is created off `activeMicStream` (separate from the `dest`-bound mixing graph already built for the recorder), read via `requestAnimationFrame` + `getByteFrequencyData` to drive the bar's width. This is deliberately independent of mute state — the meter keeps showing real mic input level even while muted, so the user can tell "I am muted but the mic itself is still picking up sound" versus "nothing is reaching the mic at all."

Once `activeWebcamStream` is set, the camera chip upgrades to show:

- **Live preview thumbnail** — a 60×60px circular `<video>` element, `muted`, `autoplay`, bound directly to `activeWebcamStream` via `srcObject`. Purely visual confirmation of framing; no additional controls (pause/mute don't apply to a silent recording-only feed).

If a stream was never created (capture disabled in settings, or `getUserMedia` failed per the existing `describeMediaError` handling), that chip's during-recording segment simply never renders — same graceful-degradation behavior already in place.

---

## Cleanup

`stopVideoRecording()` gains, alongside its existing `activeAudioCtx.close()`:

```js
activeMicStream = null;   // tracks are already stopped by existing cleanup paths
activeWebcamStream = null;
```

The level-meter `requestAnimationFrame` loop and both `PermissionStatus.onchange` listeners are torn down / stop reading data once their backing stream reference is nulled (loop checks `if (!activeMicStream) return;` each frame rather than being explicitly cancelled — matches the lightweight-polling style already used by `updateVideoTimer`'s `setInterval`, though the meter uses rAF instead of setInterval for smoothness).

---

## Effort Estimate

| Area | Est |
|------|-----|
| Permission status chips (query + render + onchange) | 2h |
| `prompt`-state click-to-request wiring | 1h |
| `denied`-state click-to-open-settings wiring | 0.5h |
| Lift mic/webcam streams to module scope + null on stop | 0.5h |
| Mute toggle | 1h |
| Level meter (AnalyserNode + rAF loop) | 2h |
| Webcam live preview thumbnail | 1h |
| Sidepanel HTML/CSS for the new status row + chips | 2h |
| **Total** | **~10h / ~1.5 days** |

---

## Out of Scope (this iteration)

- Device selection (choosing among multiple mics/cameras) — uses browser default, same as the base feature.
- Persisting mute state across recording sessions.
- Any change to the *after-recording* `describeMediaError` toast messaging — that stays as-is, this spec only adds the *before/during* status UI.
