# Media Permission Status, Mute, Level Meter & Webcam Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible mic/camera permission status row to the sidepanel — showing real state before recording, letting the user re-trigger the native prompt or jump to browser settings when blocked, and adding a mute toggle, live level meter, and webcam preview during recording.

**Architecture:** All changes are confined to `extension/sidepanel.html` (new status-row markup + CSS) and `extension/sidepanel.js` (permission querying via the Permissions API, module-level stream references lifted out of `startVideoRecording()`'s local scope, and a `requestAnimationFrame` loop for the level meter). No backend or platform changes — this is purely an extension-side UX layer on top of the already-shipped audio/webcam recording feature.

**Tech Stack:** Chrome MV3 Permissions API (`navigator.permissions.query`), Web Audio API (`AnalyserNode`), `requestAnimationFrame`, plain DOM/CSS (no framework, matches existing `sidepanel.js` style).

## Global Constraints

- Status row only renders when `captureAudioEnabled` or `captureWebcamEnabled` is `true` in `qa_ext_settings` — same gating pattern as the existing `applyVideoRecordingVisibility`.
- `denied` state must NOT offer a "click to re-request" action — Chrome never re-shows its native prompt once blocked. Only `prompt` state gets a click-to-request button; `denied` state gets a click-to-open-settings button.
- Mute uses `track.enabled = false`, never `track.stop()` — stopping would require re-requesting permission to resume.
- Level meter reads a **separate** `AnalyserNode` tapped off the raw `micStream`, independent of the `dest`-bound mixing graph already feeding the recorder — so the meter still shows real mic input level even while muted.
- Follow existing code conventions: `.status-dot` color-dot pattern already used in `#status-bar`, CSS custom properties (`--green`, `--red`, `--text-lo`) already defined in `extension/sidepanel.html`'s `:root` block, plain vanilla JS DOM manipulation (no new dependencies).

---

### Task 1: Lift mic/webcam stream references to module scope

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Produces: module-level `activeMicStream: MediaStream | null` and `activeWebcamStream: MediaStream | null`, set inside `startVideoRecording()`'s existing try blocks and cleared in `stopVideoRecording()` — consumed by Task 3 (mute/meter) and Task 4 (webcam preview).

- [ ] **Step 1: Add the two new module-level state variables**

```javascript
// extension/sidepanel.js — add directly after the existing `let activeAudioCtx = null;` (line 60):
let activeMicStream = null;
let activeWebcamStream = null;
```

- [ ] **Step 2: Assign `activeMicStream` inside the audio-mixing try block**

```javascript
// extension/sidepanel.js — inside startVideoRecording(), in the `if (settings.captureAudioEnabled)` block,
// change the first line from:
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
// to:
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeMicStream = micStream;
```

- [ ] **Step 3: Assign `activeWebcamStream` inside the webcam try block**

```javascript
// extension/sidepanel.js — inside startVideoRecording(), in the `if (settings.captureWebcamEnabled)` block,
// change the first line from:
      const webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
// to:
      const webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      activeWebcamStream = webcamStream;
```

- [ ] **Step 4: Null both references in `stopVideoRecording()`**

```javascript
// extension/sidepanel.js — replace the existing stopVideoRecording function body:
function stopVideoRecording() {
  if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
    videoMediaRecorder.stop();
  }
  if (webcamMediaRecorder && webcamMediaRecorder.state !== 'inactive') {
    webcamMediaRecorder.stop();
  }
  if (activeAudioCtx) {
    activeAudioCtx.close().catch(() => {});
    activeAudioCtx = null;
  }
  activeMicStream = null;
  activeWebcamStream = null;
  clearInterval(videoRecTimerInterval);
  videoRecTimerRow.style.display = 'none';
  btnVideoRecording.textContent = 'Record Video';
}
```

Note: the underlying `MediaStreamTrack`s are already `.stop()`'d elsewhere (mic tracks are stopped as part of the tab/screen `stream.getTracks().forEach(t => t.stop())` in `videoMediaRecorder.onstop`, since the mixed audio track was added to that same `stream`; webcam tracks are stopped in `webcamMediaRecorder.onstop`'s `webcamStream.getTracks().forEach(t => t.stop())`). This step only nulls the module-level *reference* so later tasks know a stream is no longer active — it does not change any stop-track behavior.

- [ ] **Step 5: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js
git commit -m "refactor(extension): lift mic/webcam stream refs to module scope for status UI"
```

---

### Task 2: Permission status row — HTML/CSS markup

**Files:**
- Modify: `extension/sidepanel.html`

**Interfaces:**
- Produces: DOM elements `#media-status-row`, `#mic-status-chip` (with child `#mic-status-dot`, `#mic-status-label`), `#cam-status-chip` (with child `#cam-status-dot`, `#cam-status-label`) — consumed by Task 3 (JS wiring for mic chip) and Task 4 (JS wiring for camera chip).

- [ ] **Step 1: Add the status row markup**

```html
<!-- extension/sidepanel.html — insert directly after the existing video-attach-row div (after line 567,
     before the replay-chip div at line 569): -->
<div class="media-status-row" id="media-status-row" style="display:none">
  <button class="media-status-chip" id="mic-status-chip" type="button">
    <span class="media-status-dot" id="mic-status-dot"></span>
    <span class="media-status-icon">🎤</span>
    <span id="mic-status-label">Checking…</span>
  </button>
  <button class="media-status-chip" id="cam-status-chip" type="button">
    <span class="media-status-dot" id="cam-status-dot"></span>
    <span class="media-status-icon">📷</span>
    <span id="cam-status-label">Checking…</span>
  </button>
</div>
```

- [ ] **Step 2: Add the CSS**

```css
/* extension/sidepanel.html — add inside the existing <style> block, directly after the
   .video-attach-row rule (search for it near the other video-* rules): */
.media-status-row {
  display: flex; gap: 8px;
  padding: 0 14px 8px;
}
.media-status-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px; font-weight: 500;
  color: var(--text-mid);
  cursor: pointer;
}
.media-status-chip:disabled { cursor: default; }
.media-status-dot {
  width: 6px; height: 6px;
  border-radius: 50%; flex-shrink: 0;
  background: var(--text-lo);
}
.media-status-dot.granted { background: var(--green); }
.media-status-dot.denied { background: var(--red); }
.media-status-icon { font-size: 12px; line-height: 1; }
```

- [ ] **Step 3: Manual visual check**

Load the unpacked extension, open the sidepanel with a project selected. The row should not be visible yet (no JS wiring exists to unhide it — that's Task 3).
Expected: no visual regression on the existing "Record Video" area — the new row is `display:none` by default and invisible until Task 3 wires it up.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.html
git commit -m "feat(extension): add media permission status row markup and styles"
```

---

### Task 3: Mic permission status — query, render, click-to-request/click-to-open-settings

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `#media-status-row`, `#mic-status-chip`, `#mic-status-dot`, `#mic-status-label` (Task 2), `qa_ext_settings.captureAudioEnabled` (existing), `activeMicStream` (Task 1).
- Produces: `applyMediaStatusRowVisibility(settings)`, `refreshMicPermissionStatus()` — the camera equivalent function names in Task 4 (`applyCamPermissionStatus`... actually camera visibility is covered by the same `applyMediaStatusRowVisibility` call) must match exactly what this task defines.

- [ ] **Step 1: Add DOM refs**

```javascript
// extension/sidepanel.js — add near the other video-* DOM refs (after line 51's
// `const btnDiscardVideo = document.getElementById('btn-discard-video');`):
const mediaStatusRow  = document.getElementById('media-status-row');
const micStatusChip   = document.getElementById('mic-status-chip');
const micStatusDot    = document.getElementById('mic-status-dot');
const micStatusLabel  = document.getElementById('mic-status-label');
const camStatusChip   = document.getElementById('cam-status-chip');
const camStatusDot    = document.getElementById('cam-status-dot');
const camStatusLabel  = document.getElementById('cam-status-label');
```

- [ ] **Step 2: Add the row-visibility function and hook it into existing settings-change points**

```javascript
// extension/sidepanel.js — add near applyVideoRecordingVisibility:
function applyMediaStatusRowVisibility(settings) {
  const show = !!(settings && (settings.captureAudioEnabled || settings.captureWebcamEnabled));
  mediaStatusRow.style.display = show ? 'flex' : 'none';
  micStatusChip.style.display = settings && settings.captureAudioEnabled ? '' : 'none';
  camStatusChip.style.display = settings && settings.captureWebcamEnabled ? '' : 'none';
}
```

```javascript
// extension/sidepanel.js — modify the chrome.storage.onChanged listener's qa_ext_settings block
// (originally lines 523-526) to add the new call:
  if (changes.qa_ext_settings) {
    applyMultiTabVisibility(changes.qa_ext_settings.newValue);
    applyVideoRecordingVisibility(changes.qa_ext_settings.newValue);
    applyMediaStatusRowVisibility(changes.qa_ext_settings.newValue);
    refreshMicPermissionStatus();
    refreshCamPermissionStatus();
  }
```

```javascript
// extension/sidepanel.js — modify the initial chrome.storage.local.get call (originally
// lines 579-583) to add the new calls:
chrome.storage.local.get(['qa_ext_settings', 'qa_multitab_mode', 'qa_multitab_recorded_tabs'], function (r) {
  applyMultiTabVisibility(r.qa_ext_settings);
  applyVideoRecordingVisibility(r.qa_ext_settings);
  applyMediaStatusRowVisibility(r.qa_ext_settings);
  applyMultiTabToggle(r.qa_multitab_mode ?? false);
  applyMultiTabBadge(r.qa_multitab_recorded_tabs);
  refreshMicPermissionStatus();
  refreshCamPermissionStatus();
});
```

(`refreshCamPermissionStatus` is defined in Task 4 — this task's code references it, but Task 4 must exist for the file to run without a `ReferenceError`. Implement Task 3 and Task 4 as a pair if executing tasks strictly in order; the plan separates them for reviewability, not for independent runnability.)

- [ ] **Step 3: Implement `refreshMicPermissionStatus` with query + render + onchange + click handling**

```javascript
// extension/sidepanel.js — add near applyMediaStatusRowVisibility:
let micPermissionStatus = null;

async function refreshMicPermissionStatus() {
  try {
    micPermissionStatus = await navigator.permissions.query({ name: 'microphone' });
    renderMicPermissionStatus();
    micPermissionStatus.onchange = renderMicPermissionStatus;
  } catch (_) {
    // navigator.permissions.query for 'microphone' is unsupported in some contexts —
    // fail closed to the "prompt" visual state so the chip still offers a click-to-request.
    micStatusDot.className = 'media-status-dot';
    micStatusLabel.textContent = 'Unknown';
  }
}

function renderMicPermissionStatus() {
  const state = micPermissionStatus ? micPermissionStatus.state : 'prompt';
  micStatusDot.className = 'media-status-dot' + (state === 'granted' ? ' granted' : state === 'denied' ? ' denied' : '');
  micStatusLabel.textContent = state === 'granted' ? 'Ready' : state === 'denied' ? 'Blocked' : 'Not yet granted';
}

micStatusChip.addEventListener('click', async () => {
  const state = micPermissionStatus ? micPermissionStatus.state : 'prompt';
  if (state === 'denied') {
    chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    refreshMicPermissionStatus();
  } catch (_) {
    refreshMicPermissionStatus();
  }
});
```

- [ ] **Step 4: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: this will currently FAIL with a `ReferenceError`-adjacent issue is not how `node --check` works (it only checks syntax, not runtime references) — so it should still report clean syntax even though `refreshCamPermissionStatus` doesn't exist yet. Confirm:

Run: `node --check extension/sidepanel.js`
Expected: no output (syntax is valid; the missing `refreshCamPermissionStatus` function is a Task 4 concern, not a syntax error).

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): query and render mic permission status with click-to-request/settings"
```

---

### Task 4: Camera permission status — same pattern as Task 3, mirrored

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `camStatusChip`, `camStatusDot`, `camStatusLabel` (Task 3's DOM refs step already added these).
- Produces: `refreshCamPermissionStatus()` — referenced by Task 3's settings-change hookups (now satisfied), consumed by Task 5 (webcam preview upgrade) as the pattern to extend.

- [ ] **Step 1: Implement `refreshCamPermissionStatus` mirroring the mic version**

```javascript
// extension/sidepanel.js — add directly after the mic permission status code from Task 3:
let camPermissionStatus = null;

async function refreshCamPermissionStatus() {
  try {
    camPermissionStatus = await navigator.permissions.query({ name: 'camera' });
    renderCamPermissionStatus();
    camPermissionStatus.onchange = renderCamPermissionStatus;
  } catch (_) {
    camStatusDot.className = 'media-status-dot';
    camStatusLabel.textContent = 'Unknown';
  }
}

function renderCamPermissionStatus() {
  const state = camPermissionStatus ? camPermissionStatus.state : 'prompt';
  camStatusDot.className = 'media-status-dot' + (state === 'granted' ? ' granted' : state === 'denied' ? ' denied' : '');
  camStatusLabel.textContent = state === 'granted' ? 'Ready' : state === 'denied' ? 'Blocked' : 'Not yet granted';
}

camStatusChip.addEventListener('click', async () => {
  const state = camPermissionStatus ? camPermissionStatus.state : 'prompt';
  if (state === 'denied') {
    chrome.tabs.create({ url: 'chrome://settings/content/camera' });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    refreshCamPermissionStatus();
  } catch (_) {
    refreshCamPermissionStatus();
  }
});
```

- [ ] **Step 2: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 3: Manual test — prompt state**

Load the unpacked extension fresh (or after `chrome://settings/content/camera` and `.../microphone` reset for this extension to "Ask" via the trash-can icon on any existing entry). With Capture Audio/Webcam on in settings, open the sidepanel.
Expected: both chips show grey dot + "Not yet granted". Clicking the mic chip triggers Chrome's native microphone permission popup; clicking the camera chip triggers the native camera popup. After granting, the chip updates to green dot + "Ready" without needing to close/reopen the sidepanel (via `onchange`).

- [ ] **Step 4: Manual test — denied state**

In `chrome://settings/content/camera`, add this extension's origin to the "Not allowed" list (or trigger a real Deny click). Reopen the sidepanel.
Expected: camera chip shows red dot + "Blocked". Clicking it opens `chrome://settings/content/camera` in a new tab (does not attempt `getUserMedia` again).

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): query and render camera permission status with click-to-request/settings"
```

---

### Task 5: Mic mute toggle + live level meter during recording

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `activeMicStream` (Task 1), `micStatusChip`/`micStatusLabel` (Task 3).
- Produces: mic chip upgrades in place during recording to show a mute button + level bar; no new public functions consumed by later tasks (Task 6 is independent, mirroring the same "upgrade in place" pattern for the camera chip).

- [ ] **Step 1: Add the mute button and level-meter bar markup inside the mic chip**

```html
<!-- extension/sidepanel.html — replace the mic chip's inner content (from Task 2's markup): -->
<button class="media-status-chip" id="mic-status-chip" type="button">
  <span class="media-status-dot" id="mic-status-dot"></span>
  <span class="media-status-icon" id="mic-mute-icon">🎤</span>
  <span id="mic-status-label">Checking…</span>
  <span class="media-level-meter" id="mic-level-meter" style="display:none">
    <span class="media-level-bar" id="mic-level-bar"></span>
  </span>
</button>
```

- [ ] **Step 2: Add CSS for the level meter**

```css
/* extension/sidepanel.html — add inside the existing <style> block, after the .media-status-chip rules: */
.media-level-meter {
  width: 28px; height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
  display: inline-block;
}
.media-level-bar {
  display: block;
  height: 100%;
  width: 0%;
  background: var(--green);
  transition: width 60ms linear;
}
```

- [ ] **Step 3: Add DOM refs**

```javascript
// extension/sidepanel.js — add near the Task 3 DOM refs:
const micMuteIcon  = document.getElementById('mic-mute-icon');
const micLevelMeter = document.getElementById('mic-level-meter');
const micLevelBar   = document.getElementById('mic-level-bar');
```

- [ ] **Step 4: Add mute state, level-meter loop, and start/stop wiring**

```javascript
// extension/sidepanel.js — add near the other module-level recording state:
let micMuted = false;
let micAnalyser = null;
let micLevelRafId = null;

function startMicLevelMeter(stream) {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  micAnalyser = audioCtx.createAnalyser();
  micAnalyser.fftSize = 256;
  source.connect(micAnalyser);
  const data = new Uint8Array(micAnalyser.frequencyBinCount);
  micLevelMeter.style.display = '';

  function tick() {
    if (!activeMicStream) {
      micLevelMeter.style.display = 'none';
      micLevelBar.style.width = '0%';
      audioCtx.close().catch(() => {});
      return;
    }
    micAnalyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    micLevelBar.style.width = `${Math.min(100, (avg / 255) * 100 * 2)}%`;
    micLevelRafId = requestAnimationFrame(tick);
  }
  tick();
}

micStatusChip.addEventListener('click', () => {
  // Only toggle mute if a recording is active and mic is already granted — otherwise this
  // click falls through to the request/open-settings handler registered in Task 3.
  if (!activeMicStream) return;
  micMuted = !micMuted;
  activeMicStream.getAudioTracks().forEach(track => { track.enabled = !micMuted; });
  micMuteIcon.textContent = micMuted ? '🔇' : '🎤';
}, { capture: true });
```

Note on click handling: this step registers a second `click` listener on the same `micStatusChip` with `{ capture: true }` so it runs before Task 3's listener during the capture phase, and returns early via `if (!activeMicStream) return;` when no recording is active — letting Task 3's request/open-settings listener run normally in that case. When a recording IS active, this handler mutes/unmutes and does NOT call `stopPropagation()`, so Task 3's listener still runs afterward; guard Task 3's listener by also checking `if (activeMicStream) return;` at its top so it doesn't try to re-request permission mid-recording. Update Task 3's click listener:

```javascript
// extension/sidepanel.js — modify the Task 3 micStatusChip click listener's first line to add a guard:
micStatusChip.addEventListener('click', async () => {
  if (activeMicStream) return; // handled by the mute toggle above during an active recording
  const state = micPermissionStatus ? micPermissionStatus.state : 'prompt';
  // ...(rest unchanged)
```

- [ ] **Step 5: Call `startMicLevelMeter` when the mic stream is created, stop the loop on recording stop**

```javascript
// extension/sidepanel.js — inside startVideoRecording()'s `if (settings.captureAudioEnabled)` block,
// after the line `activeMicStream = micStream;`, add:
      startMicLevelMeter(micStream);
```

```javascript
// extension/sidepanel.js — in stopVideoRecording(), after the line `activeMicStream = null;`, add:
  micMuted = false;
  micMuteIcon.textContent = '🎤';
```

(The `tick()` loop in `startMicLevelMeter` already self-terminates and hides the meter once `activeMicStream` is nulled — no separate `cancelAnimationFrame` call is needed since the loop checks the condition at the top of every frame before scheduling the next one.)

- [ ] **Step 6: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 7: Manual test**

With Capture Audio on and mic permission granted, click "Record Video" (single-tab or multi-tab) and speak into the microphone.
Expected: the mic chip shows a small animated level bar reacting to voice volume. Clicking the chip mutes (icon changes to 🔇, level bar keeps moving since the meter taps the raw stream independent of the mute flag) — clicking again unmutes.

- [ ] **Step 8: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): add mic mute toggle and live level meter during recording"
```

---

### Task 6: Webcam live preview thumbnail during recording

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `activeWebcamStream` (Task 1), `camStatusChip` (Task 4).
- Produces: a live preview `<video>` element shown next to the camera chip during recording.

- [ ] **Step 1: Add the preview `<video>` markup**

```html
<!-- extension/sidepanel.html — insert directly after the cam-status-chip closing </button>,
     inside media-status-row: -->
<video id="webcam-preview" class="webcam-preview" muted autoplay style="display:none"></video>
```

- [ ] **Step 2: Add CSS**

```css
/* extension/sidepanel.html — add inside the existing <style> block: */
.webcam-preview {
  width: 60px; height: 60px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border);
}
```

- [ ] **Step 3: Add DOM ref and wire it up in `startVideoRecording`/`stopVideoRecording`**

```javascript
// extension/sidepanel.js — add near the Task 3/4 DOM refs:
const webcamPreview = document.getElementById('webcam-preview');
```

```javascript
// extension/sidepanel.js — inside startVideoRecording()'s `if (settings.captureWebcamEnabled)` block,
// after the line `activeWebcamStream = webcamStream;`, add:
      webcamPreview.srcObject = webcamStream;
      webcamPreview.style.display = '';
```

```javascript
// extension/sidepanel.js — in stopVideoRecording(), after the line `activeWebcamStream = null;`, add:
  webcamPreview.srcObject = null;
  webcamPreview.style.display = 'none';
```

- [ ] **Step 4: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 5: Manual test**

With Capture Webcam on and camera permission granted, click "Record Video".
Expected: a small circular live thumbnail of the webcam feed appears next to the camera status chip; it disappears when the recording stops.

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): add live webcam preview thumbnail during recording"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full happy-path test**

With Capture Audio and Capture Webcam both on, mic/camera permission both in `prompt` state (reset via `chrome://settings/content/camera` and `.../microphone` if needed), open the sidepanel.
Expected: both chips show "Not yet granted". Click each to grant. Both flip to green "Ready". Click "Record Video" — no unexpected permission prompts appear mid-recording (they were already granted), mic level meter animates, webcam preview shows live feed, mute toggle works. Stop recording — both chips' during-recording UI (level meter, preview) disappear; chips return to their static "Ready" state.

- [ ] **Step 2: Denied-state test**

Block camera for this extension via `chrome://settings/content/camera`. Reopen the sidepanel.
Expected: camera chip shows red "Blocked". Clicking it opens the settings page in a new tab — no `getUserMedia` call is attempted. Recording still proceeds without webcam (existing `describeMediaError` toast fires as before).

- [ ] **Step 3: Syntax and full regression check**

Run: `node --check extension/sidepanel.js && node --check extension/background.js && node --check extension/content.js && echo OK`
Expected: `OK`

Run: `cd backend && npx jest`
Expected: all existing tests still pass (10/10) — this feature touches no backend files, so this is a regression check, not new coverage.

- [ ] **Step 4: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
