# Extension Capture Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give testers a per-recording override to skip audio/webcam capture even when the workspace setting allows it, a mid-recording webcam pause (mirroring the existing mic mute), and wire the media setup page's device selection into the actual recording code (currently disconnected — recording always uses the browser default device).

**Architecture:** All changes are extension-only, split across `extension/sidepanel.html`/`sidepanel.js` (pre-recording checkboxes, webcam pause, reading persisted device IDs) and `extension/setup.html`/`setup.js` (persisting the selected device IDs to `localStorage`, mirroring the existing `qa-video-webcam-corner` persistence pattern). No backend or platform changes.

**Tech Stack:** Vanilla JS/HTML (no framework, matching the rest of the extension), `localStorage`, `navigator.mediaDevices.enumerateDevices()`/`getUserMedia`.

## Global Constraints

- The pre-recording checkboxes are a per-recording override only — unchecking never calls `PATCH /workspaces/settings` or otherwise touches the workspace-level `captureAudioEnabled`/`captureWebcamEnabled` settings. They only appear when the corresponding workspace setting is already `true`, and default to checked.
- Webcam mid-recording pause uses `track.enabled = false` directly (not a `GainNode`, unlike mic mute) — video has no meter dependency requiring the more complex routing mic mute needed.
- Device persistence uses two new `localStorage` keys, `qa-video-mic-device` and `qa-video-cam-device`, storing a plain `deviceId` string (no JSON wrapper) — same convention as the existing `qa-video-webcam-corner` key.
- A saved device that's no longer present (checked via a fresh `enumerateDevices()` call) must never block or fail a recording — fall back silently to the unconstrained default request.
- No automated test framework exists for extension code — verification is `node --check` on modified files plus a manual test checklist.

---

### Task 1: Pre-recording audio/webcam checkboxes

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `#media-status-row`, existing `applyMediaStatusRowVisibility(settings)` function (modifies its callers), `settings.captureAudioEnabled`/`settings.captureWebcamEnabled` read inside `startVideoRecording()`.
- Produces: `#capture-audio-checkbox`, `#capture-webcam-checkbox` DOM elements; module-level helper `shouldCaptureAudio(settings)`/`shouldCaptureWebcam(settings)` functions — consumed by Task 2 and Task 3, which both read the same checkbox state when deciding what to request.

- [ ] **Step 1: Add the checkboxes to the media status row**

```html
<!-- extension/sidepanel.html — insert directly after the closing </button> of #cam-status-chip
     (after line 642, before the #webcam-preview video element on line 643): -->
      <label class="capture-toggle" id="capture-audio-toggle" style="display:none">
        <input type="checkbox" id="capture-audio-checkbox" checked />
        Audio
      </label>
      <label class="capture-toggle" id="capture-webcam-toggle" style="display:none">
        <input type="checkbox" id="capture-webcam-checkbox" checked />
        Webcam
      </label>
```

```css
/* extension/sidepanel.html — add inside the existing <style> block, near the
   .media-status-chip rules: */
    .capture-toggle {
      display: flex; align-items: center; gap: 4px;
      font-size: 11px; color: var(--text-mid);
      cursor: pointer; user-select: none;
    }
    .capture-toggle input { cursor: pointer; }
```

- [ ] **Step 2: Add DOM refs and wire visibility into the existing settings-visibility function**

```javascript
// extension/sidepanel.js — add near the other DOM refs (after the mediaPermissionHelp ref):
const captureAudioToggle = document.getElementById('capture-audio-toggle');
const captureAudioCheckbox = document.getElementById('capture-audio-checkbox');
const captureWebcamToggle = document.getElementById('capture-webcam-toggle');
const captureWebcamCheckbox = document.getElementById('capture-webcam-checkbox');
```

```javascript
// extension/sidepanel.js — replace the existing applyMediaStatusRowVisibility function:
function applyMediaStatusRowVisibility(settings) {
  const show = !!(settings && (settings.captureAudioEnabled || settings.captureWebcamEnabled));
  mediaStatusRow.style.display = show ? 'flex' : 'none';
  micStatusChip.style.display = settings && settings.captureAudioEnabled ? '' : 'none';
  camStatusChip.style.display = settings && settings.captureWebcamEnabled ? '' : 'none';
  captureAudioToggle.style.display = settings && settings.captureAudioEnabled ? 'flex' : 'none';
  captureWebcamToggle.style.display = settings && settings.captureWebcamEnabled ? 'flex' : 'none';
}
```

- [ ] **Step 3: Add helper functions reading the checkbox state**

```javascript
// extension/sidepanel.js — add near applyMediaStatusRowVisibility:
function shouldCaptureAudio(settings) {
  if (!settings || !settings.captureAudioEnabled) return false;
  return captureAudioCheckbox.checked;
}

function shouldCaptureWebcam(settings) {
  if (!settings || !settings.captureWebcamEnabled) return false;
  return captureWebcamCheckbox.checked;
}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): add pre-recording audio/webcam checkboxes"
```

---

### Task 2: Wire the checkboxes into `startVideoRecording`

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `shouldCaptureAudio(settings)`, `shouldCaptureWebcam(settings)` (Task 1).
- Produces: `startVideoRecording()` now gates on the checkbox-aware helpers instead of the raw workspace setting — no new exports.

- [ ] **Step 1: Replace all four `settings.captureAudioEnabled`/`settings.captureWebcamEnabled` reads inside `startVideoRecording` with the new helpers**

```javascript
// extension/sidepanel.js — inside startVideoRecording(), replace the full function body's
// use of the raw settings flags. The function currently reads them in four places; replace
// each occurrence exactly as shown:

// 1) In the qa_multitab_mode branch (getDisplayMedia call):
//    change: audio: !!settings.captureAudioEnabled
//    to:     audio: shouldCaptureAudio(settings)

// 2) In the single-tab branch (getUserMedia call):
//    change: audio: settings.captureAudioEnabled
//              ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } }
//              : false,
//    to:     audio: shouldCaptureAudio(settings)
//              ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } }
//              : false,

// 3) The audio-mixing block's gate:
//    change: if (settings.captureAudioEnabled) {
//    to:     if (shouldCaptureAudio(settings)) {

// 4) The webcam block's gate:
//    change: if (settings.captureWebcamEnabled) {
//    to:     if (shouldCaptureWebcam(settings)) {
```

Full resulting function for reference (copy this in place of the existing `startVideoRecording`):

```javascript
async function startVideoRecording() {
  webcamMediaRecorder = null;
  webcamChunks = [];
  webcamBlob = null;
  if (activeAudioCtx) { activeAudioCtx.close().catch(() => {}); activeAudioCtx = null; }

  await chrome.runtime.sendMessage({ type: 'SYNC_SETTINGS' }).catch(() => {});

  const { qa_multitab_mode, qa_ext_settings } = await chrome.storage.local.get(['qa_multitab_mode', 'qa_ext_settings']);
  const settings = qa_ext_settings || {};
  let stream;
  try {
    if (qa_multitab_mode) {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: shouldCaptureAudio(settings) });
    } else {
      const tab = await getActiveTab();
      const res = await chrome.runtime.sendMessage({ type: 'START_VIDEO_RECORDING', tabId: tab.id });
      if (!res || !res.ok) throw new Error(res?.error || 'Failed to start tab capture');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } },
        audio: shouldCaptureAudio(settings)
          ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: res.streamId } }
          : false,
      });
    }
  } catch (err) {
    showToast(`Could not start video recording: ${err.message}`, 'error', 4000);
    return;
  }

  if (shouldCaptureAudio(settings)) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeMicStream = micStream;
      startMicLevelMeter(micStream);
      const audioCtx = new AudioContext();
      activeAudioCtx = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      micGainNode = audioCtx.createGain();
      audioCtx.createMediaStreamSource(micStream).connect(micGainNode).connect(dest);
      const tabAudioTracks = stream.getAudioTracks();
      if (tabAudioTracks.length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream([tabAudioTracks[0]])).connect(dest);
        tabAudioTracks.forEach(track => stream.removeTrack(track));
      }
      dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    } catch (err) {
      showToast(`Microphone unavailable (${describeMediaError(err)}) — recording without audio.`, 'error', 6000);
    }
  }

  if (shouldCaptureWebcam(settings)) {
    try {
      const webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      activeWebcamStream = webcamStream;
      webcamPreview.srcObject = webcamStream;
      webcamPreview.style.display = '';
      webcamChunks = [];
      webcamMediaRecorder = new MediaRecorder(webcamStream, { mimeType: 'video/webm;codecs=vp9' });
      webcamMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) webcamChunks.push(e.data); };
      webcamMediaRecorder.onstop = () => {
        webcamBlob = new Blob(webcamChunks, { type: 'video/webm' });
        webcamStream.getTracks().forEach(t => t.stop());
      };
      webcamMediaRecorder.start();
    } catch (err) {
      showToast(`Webcam unavailable (${describeMediaError(err)}) — recording without webcam.`, 'error', 6000);
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

- [ ] **Step 2: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 3: Manual test — unchecking skips capture**

With both workspace settings on (both checkboxes visible and checked by default), uncheck "Audio", start a recording, stop it, and attach it to an issue. Confirm the resulting video has no audio track (silent playback). Repeat unchecking "Webcam" instead — confirm no webcam clip gets attached. Confirm the platform's workspace settings page still shows both toggles ON in either case (the checkbox never touched the workspace setting).

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): honor pre-recording audio/webcam checkboxes in startVideoRecording"
```

---

### Task 3: Mid-recording webcam pause

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `camStatusChip`, `activeWebcamStream` (existing), the existing mic-mute pattern (`micStatusChip`'s dual click-listener structure) as the model to mirror.
- Produces: `webcamPaused` module-level boolean state — no further tasks consume it.

- [ ] **Step 1: Add a pause icon span inside the camera chip, mirroring `#mic-mute-icon`**

```html
<!-- extension/sidepanel.html — replace the existing #cam-status-chip button: -->
<!--       <button class="media-status-chip" id="cam-status-chip" type="button">
        <span class="media-status-dot" id="cam-status-dot"></span>
        <span class="media-status-icon">📷</span>
        <span id="cam-status-label">Checking…</span>
      </button> -->
<!-- with: -->
      <button class="media-status-chip" id="cam-status-chip" type="button">
        <span class="media-status-dot" id="cam-status-dot"></span>
        <span class="media-status-icon" id="cam-pause-icon">📷</span>
        <span id="cam-status-label">Checking…</span>
      </button>
```

- [ ] **Step 2: Add the DOM ref and `webcamPaused` state**

```javascript
// extension/sidepanel.js — add near the existing `const micMuteIcon = ...` ref:
const camPauseIcon = document.getElementById('cam-pause-icon');
```

```javascript
// extension/sidepanel.js — add near the existing `let micMuted = false;` declaration:
let webcamPaused = false;
```

- [ ] **Step 3: Add a capture-phase click listener on `camStatusChip`, mirroring the mic mute listener exactly**

```javascript
// extension/sidepanel.js — add directly after the existing mic mute listener
// (the one registered with { capture: true } near the top of the file, right after it):
camStatusChip.addEventListener('click', () => {
  // Only toggle pause if a recording is active and webcam is already granted — otherwise
  // this click falls through to the request/open-settings handler registered further down.
  if (!activeWebcamStream) return;
  webcamPaused = !webcamPaused;
  activeWebcamStream.getVideoTracks().forEach(track => { track.enabled = !webcamPaused; });
  camPauseIcon.textContent = webcamPaused ? '⏸️' : '📷';
}, { capture: true });
```

- [ ] **Step 4: Guard the existing permission-request `camStatusChip` listener so it doesn't also fire during an active recording**

```javascript
// extension/sidepanel.js — find the existing camStatusChip.addEventListener('click', async () => { ... })
// (the permission-request one, further down in the file) and add a guard as its first line:
camStatusChip.addEventListener('click', async () => {
  if (activeWebcamStream) return; // handled by the pause toggle above during an active recording
  const state = camPermissionStatus ? camPermissionStatus.state : 'prompt';
  // ...(rest of the existing handler body unchanged)
```

- [ ] **Step 5: Reset `webcamPaused` in `stopVideoRecording`'s cleanup**

```javascript
// extension/sidepanel.js — in stopVideoRecording(), add alongside the existing
// `micMuted = false; micMuteIcon.textContent = '🎤';` lines:
  webcamPaused = false;
  camPauseIcon.textContent = '📷';
```

- [ ] **Step 6: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 7: Manual test**

Start a recording with webcam capture on, click the camera chip mid-recording — confirm the icon changes to the paused state and the live webcam preview thumbnail freezes/blacks out. Click again to resume — confirm the preview resumes. Stop the recording and check the resulting webcam clip has a frozen/black span during the paused period.

- [ ] **Step 8: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.js
git commit -m "feat(extension): add mid-recording webcam pause, mirroring the existing mic mute"
```

---

### Task 4: Persist device selection from the setup page

**Files:**
- Modify: `extension/setup.js`

**Interfaces:**
- Produces: `localStorage` keys `qa-video-mic-device`, `qa-video-cam-device` — consumed by Task 5.

- [ ] **Step 1: Save the selected device ID whenever either `<select>` changes**

```javascript
// extension/setup.js — replace the existing device-select change listeners:
//   micDeviceSelect.addEventListener('change', () => { if (micReady) runMicTest(); });
//   ...
//   camDeviceSelect.addEventListener('change', () => { if (camReady) runCamTest(); });
// with:
micDeviceSelect.addEventListener('change', () => {
  if (micDeviceSelect.value) window.localStorage.setItem('qa-video-mic-device', micDeviceSelect.value);
  if (micReady) runMicTest();
});
```

```javascript
// extension/setup.js — same treatment for the camera select:
camDeviceSelect.addEventListener('change', () => {
  if (camDeviceSelect.value) window.localStorage.setItem('qa-video-cam-device', camDeviceSelect.value);
  if (camReady) runCamTest();
});
```

- [ ] **Step 2: Also persist on a successful first test (not just on manual re-selection)**

```javascript
// extension/setup.js — inside runMicTest(), after the line `micStream = stream;`
// (right after the myGen staleness check that assigns micStream), add:
  if (deviceId) window.localStorage.setItem('qa-video-mic-device', deviceId);
```

```javascript
// extension/setup.js — inside runCamTest(), after the line `camStream = stream;`, add:
  if (deviceId) window.localStorage.setItem('qa-video-cam-device', deviceId);
```

- [ ] **Step 3: Syntax-check**

Run: `node --check extension/setup.js`
Expected: no output (clean).

- [ ] **Step 4: Manual test**

Open the setup page with more than one microphone or camera available. Select a non-default device, click Test. Confirm (via browser dev tools `localStorage.getItem('qa-video-mic-device')` in the setup tab's console) that the device ID was saved. Change the selection again — confirm the stored value updates.

- [ ] **Step 5: Commit**

```bash
git add extension/setup.js
git commit -m "feat(extension): persist selected mic/camera device from the setup page"
```

---

### Task 5: Use the persisted device in real recording

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `localStorage` keys `qa-video-mic-device`, `qa-video-cam-device` (Task 4).
- Produces: `resolveDeviceConstraint(kind, savedKey)` helper function — used internally by `startVideoRecording()`, no other task consumes it.

- [ ] **Step 1: Add a helper that validates a saved device ID against currently available devices**

```javascript
// extension/sidepanel.js — add near the other helper functions (e.g. near describeMediaError):
async function resolveDeviceConstraint(kind, storageKey) {
  const savedId = window.localStorage.getItem(storageKey);
  if (!savedId) return undefined;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const stillPresent = devices.some(d => d.kind === kind && d.deviceId === savedId);
    return stillPresent ? savedId : undefined;
  } catch (_) {
    return undefined;
  }
}
```

- [ ] **Step 2: Use it in the mic-capture block of `startVideoRecording`**

```javascript
// extension/sidepanel.js — inside startVideoRecording()'s `if (shouldCaptureAudio(settings))` block,
// replace:
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
// with:
      const savedMicId = await resolveDeviceConstraint('audioinput', 'qa-video-mic-device');
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: savedMicId ? { deviceId: { exact: savedMicId } } : true,
      });
```

- [ ] **Step 3: Use it in the webcam-capture block of `startVideoRecording`**

```javascript
// extension/sidepanel.js — inside startVideoRecording()'s `if (shouldCaptureWebcam(settings))` block,
// replace:
      const webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
// with:
      const savedCamId = await resolveDeviceConstraint('videoinput', 'qa-video-cam-device');
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: savedCamId ? { deviceId: { exact: savedCamId }, width: 320, height: 240 } : { width: 320, height: 240 },
      });
```

- [ ] **Step 4: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 5: Manual test — device honored**

With two distinct microphones (or cameras) connected, select the non-default one on the setup page and confirm it's granted/tested successfully there. Start a real recording from the sidepanel — confirm (via OS-level "in use" indicators, e.g. macOS's camera/mic menu-bar dot, or by testing with clearly distinguishable audio sources) that the selected device — not the system default — is the one actually capturing.

- [ ] **Step 6: Manual test — graceful fallback**

Select a device on the setup page, then physically disconnect it (or simulate via OS device settings) before starting a recording. Confirm the recording still starts successfully using the default device, with no error shown to the user.

- [ ] **Step 7: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): use the setup page's saved device selection in real recordings"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full regression syntax check**

Run: `node --check extension/sidepanel.js && node --check extension/setup.js && node --check extension/background.js && node --check extension/content.js && node -e "require('fs').readFileSync('extension/sidepanel.html', 'utf8')" && node -e "require('fs').readFileSync('extension/setup.html', 'utf8')" && echo OK`
Expected: `OK`

- [ ] **Step 2: Full manual walkthrough**

With both `captureAudioEnabled` and `captureWebcamEnabled` on in workspace settings:
1. Confirm both pre-recording checkboxes appear, checked by default.
2. Uncheck both, record, confirm the resulting issue has neither audio nor webcam attached.
3. Re-check both, record again, pause the webcam mid-recording via the camera chip, confirm the paused span is visible/frozen in playback.
4. Mute the mic mid-recording via the mic chip (unchanged from before) — confirm this still works exactly as before (regression check on the existing feature this plan builds alongside).
5. Select a non-default device on the setup page for both mic and camera, start a fresh recording, confirm the selected devices are used (not system default).

- [ ] **Step 3: Backend regression check**

Run: `cd backend && npx jest`
Expected: all existing tests still pass (10/10) — this feature touches no backend files, so this is a regression check, not new coverage.

- [ ] **Step 4: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
