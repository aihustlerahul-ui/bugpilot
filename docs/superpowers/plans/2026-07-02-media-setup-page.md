# Media Setup Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw `sidepanel.html`-as-a-tab link (shown when Chrome's side panel fails to prompt for mic/camera permission) with a polished, branded setup page that lets the user test their microphone and camera, pick a specific device, and see live confirmation (level meter / video preview) that each is working.

**Architecture:** A new standalone extension page (`setup.html` + `setup.js`) opened as a normal browser tab via `chrome.tabs.create`. Since it's a real tab (not the side panel surface), `getUserMedia` prompts work normally. The side panel's existing `navigator.permissions.query(...).onchange` listeners (already built) pick up the permission grant automatically — no message-passing between the setup tab and the side panel is needed. `showSidePanelPermissionHelp()` in `sidepanel.js` changes its link target from `sidepanel.html` to `setup.html`.

**Tech Stack:** Vanilla JS/HTML/CSS (no framework, matching the rest of the extension), `navigator.mediaDevices.enumerateDevices()`, Web Audio API (`AnalyserNode`, mirroring the existing side-panel level meter), plain `<video>` for camera preview.

## Global Constraints

- Trigger is lazy/on-demand only — the setup tab opens only when the side panel's existing permission-request flow hits a `NotAllowedError` while state is not `denied` (i.e., the confirmed side-panel-limitation case) — no proactive prompt after login.
- Only render the card(s) for capabilities actually enabled in settings (`captureAudioEnabled` → mic card, `captureWebcamEnabled` → camera card) — if only one is on, show only that one card.
- Reuse the extension's existing color tokens copied verbatim from `sidepanel.html`'s `:root` block: `--brand: #5b5fc7`, `--surface: #ffffff`, `--bg: #f4f5fb`, `--border: #e2e4f0`, `--text-hi: #0f1124`, `--text-mid: #4b5066`, `--text-lo: #9097b3`, `--green: #22c55e`, `--green-bg: #f0fdf4`, `--green-border: #bbf7d0`, `--red: #ef4444`, `--red-bg: #fef2f2`, `--red-border: #fecaca`, `--radius: 8px`.
- No manifest changes needed — `sidepanel.html` itself is opened via `chrome.tabs.create({ url: chrome.runtime.getURL(...) })` today (see `showSidePanelPermissionHelp` in `sidepanel.js`) without being listed in `manifest.json`'s `web_accessible_resources`, since that's only required for resources fetched by content scripts or external web origins, not the extension's own top-level pages. `setup.html` follows the same pattern — no manifest edit required.
- Device selection changes affect only the live test on this page — no stored preference is written that affects the actual recording code elsewhere in the extension (recording continues to use the browser's default/active device, matching existing behavior).
- Once every card present on the page reaches "Ready", show a completion banner and call `window.close()` after ~1.5s.

---

### Task 1: `setup.html` — markup, styles, and DOM structure

**Files:**
- Create: `extension/setup.html`

**Interfaces:**
- Produces: DOM elements `#mic-card`, `#mic-card-status`, `#mic-test-area`, `#mic-level-bar`, `#mic-confirm`, `#mic-device-select`, `#mic-test-btn`; `#cam-card`, `#cam-card-status`, `#cam-test-area` (contains `#cam-preview` video), `#cam-confirm`, `#cam-device-select`, `#cam-test-btn`; `#completion-banner` — all consumed by Task 2 (`extension/setup.js`).

- [ ] **Step 1: Create the file with head, styles, and card markup**

```html
<!-- extension/setup.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QA Reporter — Media Setup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --brand:       #5b5fc7;
      --surface:     #ffffff;
      --bg:          #f4f5fb;
      --border:      #e2e4f0;
      --text-hi:     #0f1124;
      --text-mid:    #4b5066;
      --text-lo:     #9097b3;
      --green:       #22c55e;
      --green-bg:    #f0fdf4;
      --green-border:#bbf7d0;
      --red:         #ef4444;
      --red-bg:      #fef2f2;
      --red-border:  #fecaca;
      --radius:      8px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      min-height: 100vh;
      padding: 48px 24px;
    }

    .page {
      max-width: 720px;
      margin: 0 auto;
    }

    .page-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .page-brand {
      display: inline-flex; align-items: center; gap: 8px;
      margin-bottom: 10px;
    }
    .page-brand-icon {
      width: 26px; height: 26px; border-radius: 7px;
      background: var(--brand);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 13px; font-weight: 600;
    }
    .page-brand-label { font-size: 13px; font-weight: 600; color: var(--text-mid); }
    .page-title { font-size: 20px; font-weight: 600; color: var(--text-hi); margin: 0 0 6px; }
    .page-subtitle { font-size: 13px; color: var(--text-lo); margin: 0; }

    .cards { display: flex; gap: 16px; }

    .card {
      flex: 1;
      background: var(--surface);
      border: 0.5px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }
    .card.ready { border-color: var(--green); }
    .card.blocked { border-color: var(--red); }

    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px;
    }
    .card-header-left { display: flex; align-items: center; gap: 8px; }
    .card-icon { font-size: 17px; }
    .card-label { font-size: 14px; font-weight: 600; color: var(--text-hi); }
    .card-status {
      font-size: 11px; font-weight: 600;
      padding: 2px 8px; border-radius: 999px;
      background: var(--bg); color: var(--text-lo);
    }
    .card-status.ready { background: var(--green-bg); color: #166534; }
    .card-status.blocked { background: var(--red-bg); color: #991b1b; }

    .test-area {
      height: 96px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 12px;
      background: var(--bg);
      overflow: hidden;
      position: relative;
    }
    .test-area.ready { border: none; }

    .level-meter {
      display: flex; align-items: center; justify-content: center; gap: 3px;
      width: 100%; height: 100%;
    }
    .level-bar {
      width: 5px; height: 8%;
      background: var(--green);
      border-radius: 2px;
      transition: height 80ms linear;
    }

    .cam-video {
      width: 100%; height: 100%;
      object-fit: cover;
      background: var(--text-hi);
    }

    .confirm-box {
      display: none;
      gap: 6px;
      font-size: 11.5px; line-height: 1.4;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 14px;
    }
    .confirm-box.show { display: flex; }
    .confirm-box.ready { background: var(--green-bg); border: 1px solid var(--green-border); color: #166534; }
    .confirm-box.blocked { background: var(--red-bg); border: 1px solid var(--red-border); color: #991b1b; }

    .device-label {
      font-size: 11px; color: var(--text-mid); font-weight: 600;
      display: block; margin-bottom: 6px;
    }
    .device-select {
      width: 100%; font-size: 12.5px; color: var(--text-hi);
      border: 0.5px solid var(--border); border-radius: 8px;
      padding: 8px 10px; background: var(--surface);
      margin-bottom: 12px;
    }

    .test-btn {
      width: 100%;
      background: var(--brand); color: #fff;
      border: none; border-radius: 8px;
      padding: 10px; font-size: 13px; font-weight: 600;
      cursor: pointer;
    }
    .test-btn.retest {
      background: var(--bg); color: var(--text-mid);
      border: 0.5px solid var(--border);
    }

    .completion-banner {
      display: none;
      align-items: center; gap: 8px;
      font-size: 13px; color: #166534;
      background: var(--green-bg); border: 1px solid var(--green-border);
      border-radius: 10px;
      padding: 12px 14px;
      margin-top: 16px;
    }
    .completion-banner.show { display: flex; }
  </style>
</head>
<body>
  <div class="page">
    <div class="page-header">
      <div class="page-brand">
        <span class="page-brand-icon">Q</span>
        <span class="page-brand-label">QA Reporter setup</span>
      </div>
      <h1 class="page-title">Enable mic &amp; camera</h1>
      <p class="page-subtitle">This only works from a regular tab — that's why we brought you here.</p>
    </div>

    <div class="cards">
      <div class="card" id="mic-card" style="display:none">
        <div class="card-header">
          <div class="card-header-left">
            <span class="card-icon">🎤</span>
            <span class="card-label">Microphone</span>
          </div>
          <span class="card-status" id="mic-card-status">Not started</span>
        </div>
        <div class="test-area" id="mic-test-area">
          <div class="level-meter" id="mic-level-meter" style="display:none">
            <span class="level-bar" id="mic-level-bar-0"></span>
            <span class="level-bar" id="mic-level-bar-1"></span>
            <span class="level-bar" id="mic-level-bar-2"></span>
            <span class="level-bar" id="mic-level-bar-3"></span>
            <span class="level-bar" id="mic-level-bar-4"></span>
            <span class="level-bar" id="mic-level-bar-5"></span>
            <span class="level-bar" id="mic-level-bar-6"></span>
            <span class="level-bar" id="mic-level-bar-7"></span>
          </div>
          <span id="mic-test-area-icon" style="font-size:24px">🎤</span>
        </div>
        <div class="confirm-box" id="mic-confirm"></div>
        <label class="device-label" for="mic-device-select">Microphone</label>
        <select class="device-select" id="mic-device-select"></select>
        <button class="test-btn" id="mic-test-btn" type="button">Test microphone</button>
      </div>

      <div class="card" id="cam-card" style="display:none">
        <div class="card-header">
          <div class="card-header-left">
            <span class="card-icon">📷</span>
            <span class="card-label">Camera</span>
          </div>
          <span class="card-status" id="cam-card-status">Not started</span>
        </div>
        <div class="test-area" id="cam-test-area">
          <video class="cam-video" id="cam-preview" muted autoplay style="display:none"></video>
          <span id="cam-test-area-icon" style="font-size:24px">📷</span>
        </div>
        <div class="confirm-box" id="cam-confirm"></div>
        <label class="device-label" for="cam-device-select">Camera</label>
        <select class="device-select" id="cam-device-select"></select>
        <button class="test-btn" id="cam-test-btn" type="button">Test camera</button>
      </div>
    </div>

    <div class="completion-banner" id="completion-banner">
      <span>✓</span>
      <div><b>All set!</b> Closing this tab automatically — head back to the side panel.</div>
    </div>
  </div>

  <script src="setup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the HTML is well-formed**

Run: `node -e "require('fs').readFileSync('extension/setup.html', 'utf8')" && echo "file readable"`
Expected: `file readable` (this is a minimal sanity check since there's no HTML parser readily available in this environment — visually confirm every opened tag has a matching close by reading the file back).

- [ ] **Step 3: Commit**

```bash
git add extension/setup.html
git commit -m "feat(extension): add media setup page markup and styles"
```

---

### Task 2: `setup.js` — device enumeration, test logic, completion

**Files:**
- Create: `extension/setup.js`

**Interfaces:**
- Consumes: DOM elements from Task 1 (`#mic-card`, `#mic-card-status`, `#mic-test-area`, `#mic-level-meter`, `#mic-level-bar-0` through `#mic-level-bar-7`, `#mic-test-area-icon`, `#mic-confirm`, `#mic-device-select`, `#mic-test-btn`; equivalent `#cam-*` elements; `#cam-preview`; `#completion-banner`).
- Produces: a working setup page — no other task consumes functions from this file directly (the side panel integration is purely via the browser's permission state, not any exported JS interface).

- [ ] **Step 1: Read which capabilities are enabled and show the relevant cards**

```javascript
// extension/setup.js
'use strict';

const micCard         = document.getElementById('mic-card');
const micCardStatus   = document.getElementById('mic-card-status');
const micTestArea     = document.getElementById('mic-test-area');
const micLevelMeter    = document.getElementById('mic-level-meter');
const micLevelBars     = [0,1,2,3,4,5,6,7].map(i => document.getElementById(`mic-level-bar-${i}`));
const micTestAreaIcon  = document.getElementById('mic-test-area-icon');
const micConfirm       = document.getElementById('mic-confirm');
const micDeviceSelect  = document.getElementById('mic-device-select');
const micTestBtn       = document.getElementById('mic-test-btn');

const camCard         = document.getElementById('cam-card');
const camCardStatus   = document.getElementById('cam-card-status');
const camTestArea     = document.getElementById('cam-test-area');
const camPreview       = document.getElementById('cam-preview');
const camTestAreaIcon  = document.getElementById('cam-test-area-icon');
const camConfirm       = document.getElementById('cam-confirm');
const camDeviceSelect  = document.getElementById('cam-device-select');
const camTestBtn       = document.getElementById('cam-test-btn');

const completionBanner = document.getElementById('completion-banner');

let micReady = false;
let camReady = false;
let micStream = null;
let camStream = null;
let micAudioCtx = null;
let micRafId = null;

async function init() {
  const { qa_ext_settings } = await chrome.storage.local.get(['qa_ext_settings']);
  const settings = qa_ext_settings || {};
  if (settings.captureAudioEnabled) {
    micCard.style.display = '';
    await populateDeviceList(micDeviceSelect, 'audioinput');
  }
  if (settings.captureWebcamEnabled) {
    camCard.style.display = '';
    await populateDeviceList(camDeviceSelect, 'videoinput');
  }
  if (!settings.captureAudioEnabled && !settings.captureWebcamEnabled) {
    document.querySelector('.page-subtitle').textContent =
      'Neither microphone nor camera capture is enabled in your workspace settings.';
  }
}

async function populateDeviceList(selectEl, kind) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const filtered = devices.filter(d => d.kind === kind);
    selectEl.innerHTML = '';
    if (filtered.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'System default';
      selectEl.appendChild(opt);
      return;
    }
    filtered.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}`;
      selectEl.appendChild(opt);
    });
  } catch (_) {
    selectEl.innerHTML = '<option value="">System default</option>';
  }
}

init();
```

- [ ] **Step 2: Implement the microphone test (grant, level meter, retest, device switch)**

```javascript
// extension/setup.js — append:

function setMicState(status) {
  micCardStatus.textContent = status === 'ready' ? 'Ready' : status === 'blocked' ? 'Blocked' : 'Not started';
  micCardStatus.className = 'card-status' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
  micCard.className = 'card' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
}

function showMicConfirm(status, message) {
  micConfirm.textContent = message;
  micConfirm.className = 'confirm-box show ' + status;
}

function stopMicTest() {
  if (micRafId) cancelAnimationFrame(micRafId);
  if (micAudioCtx) { micAudioCtx.close().catch(() => {}); micAudioCtx = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  micLevelMeter.style.display = 'none';
  micTestAreaIcon.style.display = '';
}

async function runMicTest() {
  stopMicTest();
  const deviceId = micDeviceSelect.value;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (err) {
    setMicState('blocked');
    showMicConfirm('blocked', 'Could not access the microphone — check Chrome and OS permission settings.');
    return;
  }

  micReady = true;
  setMicState('ready');
  showMicConfirm('ready', 'Bars moving means it\'s picking up sound.');
  micTestAreaIcon.style.display = 'none';
  micLevelMeter.style.display = '';
  micTestBtn.textContent = 'Retest microphone';
  micTestBtn.classList.add('retest');
  await populateDeviceList(micDeviceSelect, 'audioinput');

  micAudioCtx = new AudioContext();
  const source = micAudioCtx.createMediaStreamSource(micStream);
  const analyser = micAudioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const barCount = micLevelBars.length;

  function tick() {
    if (!micStream) return;
    analyser.getByteFrequencyData(data);
    const chunk = Math.floor(data.length / barCount);
    for (let i = 0; i < barCount; i++) {
      const slice = data.slice(i * chunk, (i + 1) * chunk);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      micLevelBars[i].style.height = `${Math.max(8, Math.min(100, (avg / 255) * 100 * 2))}%`;
    }
    micRafId = requestAnimationFrame(tick);
  }
  tick();

  checkCompletion();
}

micTestBtn.addEventListener('click', runMicTest);
micDeviceSelect.addEventListener('change', () => { if (micReady) runMicTest(); });
```

- [ ] **Step 3: Implement the camera test (grant, live preview, retest, device switch)**

```javascript
// extension/setup.js — append:

function setCamState(status) {
  camCardStatus.textContent = status === 'ready' ? 'Ready' : status === 'blocked' ? 'Blocked' : 'Not started';
  camCardStatus.className = 'card-status' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
  camCard.className = 'card' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
}

function showCamConfirm(status, message) {
  camConfirm.textContent = message;
  camConfirm.className = 'confirm-box show ' + status;
}

function stopCamTest() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  camPreview.srcObject = null;
  camPreview.style.display = 'none';
  camTestAreaIcon.style.display = '';
}

async function runCamTest() {
  stopCamTest();
  const deviceId = camDeviceSelect.value;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (err) {
    setCamState('blocked');
    showCamConfirm('blocked', 'Could not access the camera — check Chrome and OS permission settings.');
    return;
  }

  camReady = true;
  setCamState('ready');
  showCamConfirm('ready', 'You can see yourself above — camera is working.');
  camTestAreaIcon.style.display = 'none';
  camPreview.srcObject = camStream;
  camPreview.style.display = '';
  camTestBtn.textContent = 'Retest camera';
  camTestBtn.classList.add('retest');
  await populateDeviceList(camDeviceSelect, 'videoinput');

  checkCompletion();
}

camTestBtn.addEventListener('click', runCamTest);
camDeviceSelect.addEventListener('change', () => { if (camReady) runCamTest(); });
```

- [ ] **Step 4: Implement completion detection and auto-close**

```javascript
// extension/setup.js — append:

function checkCompletion() {
  const micCardVisible = micCard.style.display !== 'none';
  const camCardVisible = camCard.style.display !== 'none';
  const micDone = !micCardVisible || micReady;
  const camDone = !camCardVisible || camReady;
  if (micDone && camDone && (micCardVisible || camCardVisible)) {
    completionBanner.classList.add('show');
    setTimeout(() => window.close(), 1500);
  }
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check extension/setup.js`
Expected: no output (clean).

- [ ] **Step 6: Manual test**

Load the unpacked extension, with `captureAudioEnabled` and/or `captureWebcamEnabled` on in workspace settings. Trigger the setup page the same way it's already wired (via the side panel's existing "didn't prompt" flow, or directly navigate a tab to `chrome-extension://<id>/setup.html` for a quick check). Click "Test microphone" — grant permission — confirm the level meter bars move when you speak. Click "Test camera" — grant permission — confirm the live video preview shows. Once both are ready, confirm the completion banner appears and the tab closes after ~1.5s.
Expected: both cards flip to "Ready" (green border, green status pill), confirmation text appears under each, and the tab auto-closes once all enabled cards are ready.

- [ ] **Step 7: Commit**

```bash
git add extension/setup.js
git commit -m "feat(extension): add media setup page device testing and completion logic"
```

---

### Task 3: Point the side panel's permission-help link at the new setup page

**Files:**
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `showSidePanelPermissionHelp(label)` (existing function, defined in `sidepanel.js`).
- Produces: no new interface — this task only changes which URL the existing function opens.

- [ ] **Step 1: Change the link target from `sidepanel.html` to `setup.html`**

```javascript
// extension/sidepanel.js — replace the existing showSidePanelPermissionHelp function:

function showSidePanelPermissionHelp(label) {
  mediaPermissionHelp.innerHTML =
    `${label} didn't prompt — Chrome's side panel doesn't reliably support camera/mic permission popups. ` +
    `<a id="media-permission-help-link">Open the setup page</a> and grant it there once — it'll then work here too.`;
  mediaPermissionHelp.style.display = '';
  document.getElementById('media-permission-help-link').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  });
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check extension/sidepanel.js`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): open the media setup page instead of the raw sidepanel tab"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full happy-path test**

With `captureAudioEnabled` and `captureWebcamEnabled` both on, and mic/camera permission not yet granted for the extension's origin, trigger the side-panel permission flow (click the mic or camera status chip in the actual side panel) until `showSidePanelPermissionHelp` fires. Click "Open the setup page." Confirm it opens `setup.html` as a normal tab with both cards visible.
Expected: clicking "Test microphone" and "Test camera" each show Chrome's native permission popup (unlike the side panel); after granting both, the completion banner appears and the tab closes; back in the side panel, the mic/camera status chips flip to green "Ready" automatically (via the existing `permissions.onchange` listeners) with no manual refresh.

- [ ] **Step 2: Device-switch test**

On the setup page, after granting microphone access, change the device dropdown selection (if more than one microphone is available) and confirm the level meter continues to respond, now reading from the newly selected device.

- [ ] **Step 3: Single-capability test**

With only `captureAudioEnabled` on (webcam off), confirm the setup page shows only the microphone card, and the completion banner/auto-close fires once the mic alone is granted.

- [ ] **Step 4: Syntax and regression check**

Run: `node --check extension/setup.html 2>/dev/null; node --check extension/setup.js && node --check extension/sidepanel.js && node --check extension/background.js && node --check extension/content.js && echo OK`
Expected: `OK` (the `setup.html` check is expected to fail since `node --check` only validates JS, not HTML — the `2>/dev/null;` suppresses that expected non-JS error so the real check continues).

Run: `cd backend && npx jest`
Expected: all existing tests still pass (10/10) — this feature touches no backend files, so this is a regression check, not new coverage.

- [ ] **Step 5: Commit final verification notes (if any fixes were needed)**

If any bugs were found and fixed during manual verification, commit those fixes with descriptive messages before considering the feature complete. If no fixes were needed, this task requires no commit.
