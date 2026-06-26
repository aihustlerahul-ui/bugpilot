# Annotation Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen annotation canvas to the QA Reporter Chrome extension so users can draw arrows, rectangles, circles, freehand strokes, text labels, and blur/redact regions on captured screenshots before submitting a bug report.

**Architecture:** After a screenshot is captured, the existing submit modal gains an image slider (for "both" mode's two images). Each image has an "Edit" button. Clicking Edit triggers background.js to inject `annotate.js` on demand into the active tab. `annotate.js` renders a full-screen canvas overlay where the user draws, then sends the annotated dataUrl back to content.js via a chrome.runtime message. The user chooses to replace the original image or keep both.

**Tech Stack:** Vanilla JS (IIFE), HTML5 Canvas API, Chrome MV3 extension APIs (chrome.scripting, chrome.storage.local, chrome.runtime.onMessage)

## Global Constraints

- All injected DOM IDs and class names must be prefixed `qa-annotator-` or `qa-ann-`
- All CSS rules in content-styles.css must use `!important`
- annotate.js must be a self-executing IIFE — no import/export statements
- No external libraries — vanilla canvas only
- Do not break any existing functionality in content.js or background.js
- Guard against double-injection: if `#qa-annotator-overlay` already exists in DOM, exit early
- The annotation overlay z-index must be 2147483647 (above existing overlays which use 2147483645–2147483646)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `extension/annotate.js` | **CREATE** | Self-contained annotation canvas overlay — all drawing tools, undo, done flow |
| `extension/content.js` | **MODIFY** | Image slider in modal; OPEN_ANNOTATOR trigger; ANNOTATION_DONE handler |
| `extension/background.js` | **MODIFY** | OPEN_ANNOTATOR message handler — injects annotate.js on demand |
| `extension/content-styles.css` | **MODIFY** | Annotation overlay and toolbar styles |
| `extension/manifest.json` | **MODIFY** | Add annotate.js to web_accessible_resources |

---

## Task 1: Manifest + Styles Setup

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/content-styles.css`

**Interfaces:**
- Produces: `#qa-annotator-overlay`, `.qa-ann-tool`, `.qa-ann-tool.active`, `#qa-annotator-toolbar`, `#qa-annotator-canvas`, `#qa-annotator-footer` — all styled and ready for annotate.js to use

- [ ] **Step 1: Add annotate.js to web_accessible_resources in manifest.json**

Open `extension/manifest.json`. Change the `web_accessible_resources` entry from:
```json
"web_accessible_resources": [
  {
    "resources": ["content-styles.css"],
    "matches": ["<all_urls>"]
  }
]
```
To:
```json
"web_accessible_resources": [
  {
    "resources": ["content-styles.css", "annotate.js"],
    "matches": ["<all_urls>"]
  }
]
```

- [ ] **Step 2: Add annotation overlay styles to content-styles.css**

Append the following block at the end of `extension/content-styles.css`:

```css
/* ── Annotation Canvas Overlay ────────────────────────────────────────────── */
#qa-annotator-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: flex !important;
  flex-direction: column !important;
  background: transparent !important;
}

#qa-annotator-toolbar {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 8px 12px !important;
  background: #0f1124 !important;
  flex-shrink: 0 !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
}

.qa-ann-tool {
  width: 32px !important;
  height: 32px !important;
  border-radius: 6px !important;
  border: none !important;
  background: transparent !important;
  color: #9097b3 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  flex-shrink: 0 !important;
  transition: background 0.1s, color 0.1s !important;
}

.qa-ann-tool:hover {
  background: rgba(91,95,199,0.3) !important;
  color: #fff !important;
}

.qa-ann-tool.active {
  background: #5b5fc7 !important;
  color: #fff !important;
}

.qa-ann-separator {
  width: 1px !important;
  height: 24px !important;
  background: #2d2f45 !important;
  margin: 0 4px !important;
  flex-shrink: 0 !important;
}

#qa-ann-color-picker {
  width: 26px !important;
  height: 26px !important;
  border: 2px solid #4b5066 !important;
  border-radius: 50% !important;
  padding: 0 !important;
  cursor: pointer !important;
  background: none !important;
  flex-shrink: 0 !important;
}

.qa-ann-spacer {
  flex: 1 !important;
}

.qa-ann-btn-undo {
  padding: 5px 12px !important;
  background: #2d2f45 !important;
  color: #9097b3 !important;
  border: none !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  cursor: pointer !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-ann-btn-undo:hover {
  background: #3d3f55 !important;
  color: #fff !important;
}

.qa-ann-btn-done {
  padding: 5px 14px !important;
  background: #22c55e !important;
  color: #fff !important;
  border: none !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  cursor: pointer !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-ann-btn-done:hover {
  background: #16a34a !important;
}

#qa-annotator-canvas {
  flex: 1 !important;
  display: block !important;
  cursor: crosshair !important;
  min-height: 0 !important;
}

#qa-annotator-footer {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 12px !important;
  padding: 12px 16px !important;
  background: #0f1124 !important;
  flex-shrink: 0 !important;
}

.qa-ann-footer-label {
  color: #9097b3 !important;
  font-size: 12px !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-ann-btn-replace {
  padding: 7px 18px !important;
  background: #5b5fc7 !important;
  color: #fff !important;
  border: none !important;
  border-radius: 7px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-ann-btn-replace:hover {
  background: #4a4db5 !important;
}

.qa-ann-btn-keep {
  padding: 7px 18px !important;
  background: #2d2f45 !important;
  color: #fff !important;
  border: none !important;
  border-radius: 7px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-ann-btn-keep:hover {
  background: #3d3f55 !important;
}

/* ── Image slider in modal ─────────────────────────────────────────────────── */
.qa-modal-slider {
  position: relative !important;
  width: 100% !important;
  margin-bottom: 10px !important;
  border-radius: 6px !important;
  overflow: hidden !important;
  background: #0f1124 !important;
}

.qa-modal-slider-img {
  display: block !important;
  width: 100% !important;
  max-height: 200px !important;
  object-fit: contain !important;
}

.qa-slider-nav {
  position: absolute !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  background: rgba(15,17,36,0.7) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 4px !important;
  width: 24px !important;
  height: 36px !important;
  cursor: pointer !important;
  font-size: 14px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  z-index: 2 !important;
}

.qa-slider-nav-prev { left: 4px !important; }
.qa-slider-nav-next { right: 4px !important; }

.qa-slider-counter {
  position: absolute !important;
  bottom: 6px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  background: rgba(15,17,36,0.7) !important;
  color: #9097b3 !important;
  font-size: 10px !important;
  padding: 2px 7px !important;
  border-radius: 10px !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-slider-edit-btn {
  position: absolute !important;
  top: 6px !important;
  right: 6px !important;
  background: rgba(91,95,199,0.9) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 5px !important;
  padding: 3px 9px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  z-index: 2 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.qa-slider-edit-btn:hover {
  background: #5b5fc7 !important;
}
```

- [ ] **Step 3: Verify styles loaded correctly**

Load the extension unpacked in `chrome://extensions` and open any page. Open DevTools → Elements. No errors expected yet — just confirming CSS parses without error. The annotation classes won't appear in the DOM until later tasks.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/content-styles.css
git commit -m "feat: annotation canvas — manifest + styles"
```

---

## Task 2: background.js — OPEN_ANNOTATOR handler

**Files:**
- Modify: `extension/background.js` (lines 7–34, the message router)

**Interfaces:**
- Consumes: `{ type: 'OPEN_ANNOTATOR', dataUrl: string, imageIndex: number }` message from content.js
- Produces: injects `annotate.js` into active tab; stores `{ dataUrl, imageIndex }` under `chrome.storage.local` key `'qa_annotator_data'`

- [ ] **Step 1: Add OPEN_ANNOTATOR handler to background.js message router**

In `extension/background.js`, find the message router block starting at line 7. Add the new handler inside the listener, after the existing `if (type === 'SYNC_SETTINGS')` block and before the closing `});`:

```js
  if (type === 'OPEN_ANNOTATOR') {
    handleOpenAnnotator(message, sender);
    return false;
  }
```

Then add the handler function after the `handleSyncSettings` function (around line 134):

```js
// ── OPEN_ANNOTATOR ────────────────────────────────────────────────────────────
async function handleOpenAnnotator(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  // Store dataUrl + imageIndex so annotate.js can read it after injection
  await chrome.storage.local.set({
    qa_annotator_data: { dataUrl: message.dataUrl, imageIndex: message.imageIndex }
  });

  // Inject annotate.js on demand (guard against double-injection is inside annotate.js)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['annotate.js'] });
  } catch (err) {
    console.error('[QA Reporter] Failed to inject annotate.js:', err);
  }
}
```

- [ ] **Step 2: Reload extension and verify no console errors in background service worker**

Go to `chrome://extensions`, click "Reload" on QA Reporter. Click "Service worker" link to open background DevTools. No syntax errors expected.

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: annotation canvas — background OPEN_ANNOTATOR handler"
```

---

## Task 3: annotate.js — Canvas overlay + all drawing tools

**Files:**
- Create: `extension/annotate.js`

**Interfaces:**
- Consumes: `chrome.storage.local` key `'qa_annotator_data'` → `{ dataUrl: string, imageIndex: number }`
- Produces: `chrome.runtime.sendMessage({ type: 'ANNOTATION_DONE', dataUrl: string, imageIndex: number, keepOriginal: boolean })`

- [ ] **Step 1: Create extension/annotate.js with the full IIFE**

Create `extension/annotate.js` with the following content:

```js
// QA Reporter — Annotation Canvas (injected on demand, MV3)
(function () {
  'use strict';

  // Guard: don't inject twice
  if (document.getElementById('qa-annotator-overlay')) return;

  var TOOLS = { RECT: 'rect', ARROW: 'arrow', CIRCLE: 'circle', PEN: 'pen', TEXT: 'text', BLUR: 'blur' };

  var currentTool  = TOOLS.RECT;
  var currentColor = '#ef4444';
  var drawing      = false;
  var startX = 0, startY = 0;
  var history      = [];   // array of ImageData snapshots
  var snapshot     = null; // ImageData before current stroke (for live preview)
  var imageIndex   = 0;

  // ── Build overlay DOM ──────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'qa-annotator-overlay';

  var toolbar = document.createElement('div');
  toolbar.id = 'qa-annotator-toolbar';
  toolbar.innerHTML =
    '<button class="qa-ann-tool active" data-tool="rect" title="Rectangle">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="arrow" title="Arrow">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="2" y1="14" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="circle" title="Circle">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="5.5"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="pen" title="Freehand">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13 L5 10 L11 4 L12 5 L6 11 Z"/><line x1="3" y1="13" x2="5" y2="10"/></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="text" title="Text label">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="13" font-size="12" font-weight="700" font-family="system-ui">T</text></svg>' +
    '</button>' +
    '<button class="qa-ann-tool" data-tool="blur" title="Blur / Redact">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="12" height="8" rx="1" stroke-dasharray="2 1.5"/><line x1="5" y1="7" x2="11" y2="7"/><line x1="5" y1="9" x2="11" y2="9"/></svg>' +
    '</button>' +
    '<div class="qa-ann-separator"></div>' +
    '<input type="color" id="qa-ann-color-picker" value="#ef4444" title="Color">' +
    '<div class="qa-ann-spacer"></div>' +
    '<button class="qa-ann-btn-undo" id="qa-ann-undo">↩ Undo</button>' +
    '<button class="qa-ann-btn-done" id="qa-ann-done">Done ✓</button>';

  var canvas = document.createElement('canvas');
  canvas.id = 'qa-annotator-canvas';

  var footer = document.createElement('div');
  footer.id = 'qa-annotator-footer';
  footer.style.display = 'none';
  footer.innerHTML =
    '<span class="qa-ann-footer-label">Save as:</span>' +
    '<button class="qa-ann-btn-replace" id="qa-ann-replace">Replace original</button>' +
    '<button class="qa-ann-btn-keep" id="qa-ann-keep">Keep both</button>';

  overlay.appendChild(toolbar);
  overlay.appendChild(canvas);
  overlay.appendChild(footer);
  document.documentElement.appendChild(overlay);

  // ── Canvas init ────────────────────────────────────────────────────────────
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  function initCanvas(dataUrl) {
    var img = new Image();
    img.onload = function () {
      // Display size: fill viewport minus toolbar (approx 50px) and footer (when shown, 54px)
      // Use the actual image aspect ratio scaled to viewport
      var toolbarH = toolbar.getBoundingClientRect().height || 50;
      var dispW = window.innerWidth;
      var dispH = window.innerHeight - toolbarH;

      canvas.style.width  = dispW + 'px';
      canvas.style.height = dispH + 'px';
      canvas.width  = Math.round(dispW  * dpr);
      canvas.height = Math.round(dispH * dpr);
      ctx.scale(dpr, dpr);

      // Fill background black then draw image centered/fitted
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dispW, dispH);

      var scale = Math.min(dispW / img.naturalWidth, dispH / img.naturalHeight);
      var drawW = img.naturalWidth  * scale;
      var drawH = img.naturalHeight * scale;
      var drawX = (dispW - drawW) / 2;
      var drawY = (dispH - drawH) / 2;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Save base state as first history entry (cannot undo past this)
      history = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
    };
    img.src = dataUrl;
  }

  // ── Tool selection ─────────────────────────────────────────────────────────
  toolbar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tool]');
    if (!btn) return;
    currentTool = btn.getAttribute('data-tool');
    toolbar.querySelectorAll('.qa-ann-tool').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    canvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
  });

  document.getElementById('qa-ann-color-picker').addEventListener('input', function (e) {
    currentColor = e.target.value;
  });

  // ── Mouse coordinate helper ────────────────────────────────────────────────
  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────
  function drawArrow(x1, y1, x2, y2) {
    var headLen = 14;
    var angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawRect(x1, y1, x2, y2) {
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor + '26'; // 15% opacity
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.fill();
    ctx.stroke();
  }

  function drawCircle(x1, y1, x2, y2) {
    var rx = (x2 - x1) / 2;
    var ry = (y2 - y1) / 2;
    ctx.strokeStyle = currentColor;
    ctx.fillStyle   = currentColor + '26';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawBlur(x1, y1, x2, y2) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  // ── Mouse events ───────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', function (e) {
    var pos = getPos(e);
    startX = pos.x;
    startY = pos.y;

    if (currentTool === TOOLS.TEXT) {
      var text = prompt('Enter label:');
      if (text) {
        ctx.font         = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.lineWidth    = 3;
        ctx.strokeStyle  = '#fff';
        ctx.fillStyle    = currentColor;
        ctx.strokeText(text, pos.x, pos.y);
        ctx.fillText(text, pos.x, pos.y);
        history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      }
      return;
    }

    drawing  = true;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!drawing) return;
    var pos = getPos(e);

    if (currentTool === TOOLS.PEN) {
      // For pen: draw incrementally, each move updates snapshot
      ctx.strokeStyle = currentColor;
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      startX = pos.x;
      startY = pos.y;
      // Update snapshot so undo removes the whole stroke on mouseup
      return;
    }

    // For all other tools: restore snapshot then redraw preview
    ctx.putImageData(snapshot, 0, 0);

    if      (currentTool === TOOLS.RECT)   drawRect(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.ARROW)  drawArrow(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.CIRCLE) drawCircle(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.BLUR)   drawBlur(startX, startY, pos.x, pos.y);
  });

  canvas.addEventListener('mouseup', function (e) {
    if (!drawing) return;
    drawing = false;

    if (currentTool === TOOLS.PEN) {
      // Pen: save snapshot of the completed stroke
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      return;
    }

    var pos = getPos(e);
    // Final draw (no preview flicker)
    if (snapshot) ctx.putImageData(snapshot, 0, 0);
    if      (currentTool === TOOLS.RECT)   drawRect(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.ARROW)  drawArrow(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.CIRCLE) drawCircle(startX, startY, pos.x, pos.y);
    else if (currentTool === TOOLS.BLUR)   drawBlur(startX, startY, pos.x, pos.y);

    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  document.getElementById('qa-ann-undo').addEventListener('click', function () {
    if (history.length <= 1) return; // can't undo past base screenshot
    history.pop();
    ctx.putImageData(history[history.length - 1], 0, 0);
  });

  // ── Done — show footer ─────────────────────────────────────────────────────
  document.getElementById('qa-ann-done').addEventListener('click', function () {
    toolbar.style.display = 'none';
    footer.style.display  = 'flex';
    canvas.style.pointerEvents = 'none';
  });

  function finish(keepOriginal) {
    var annotatedDataUrl = canvas.toDataURL('image/png');
    chrome.runtime.sendMessage({
      type:         'ANNOTATION_DONE',
      dataUrl:      annotatedDataUrl,
      imageIndex:   imageIndex,
      keepOriginal: keepOriginal,
    });
    // Clean up
    chrome.storage.local.remove('qa_annotator_data');
    overlay.remove();
  }

  document.getElementById('qa-ann-replace').addEventListener('click', function () { finish(false); });
  document.getElementById('qa-ann-keep').addEventListener('click',    function () { finish(true);  });

  // ── Keyboard: Escape to cancel ─────────────────────────────────────────────
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      chrome.storage.local.remove('qa_annotator_data');
    }
  });

  // ── Load data from storage and init ───────────────────────────────────────
  chrome.storage.local.get(['qa_annotator_data'], function (result) {
    var data = result.qa_annotator_data;
    if (!data || !data.dataUrl) {
      overlay.remove();
      return;
    }
    imageIndex = data.imageIndex || 0;
    initCanvas(data.dataUrl);
  });

})();
```

- [ ] **Step 2: Reload extension, open any page, trigger recording and click an element**

The modal should open normally (annotation not wired to modal yet — that's Task 4). Confirm extension loads without errors in the service worker console.

- [ ] **Step 3: Manually test annotate.js injection**

Open DevTools console on any page and run:
```js
chrome.runtime.sendMessage({ type: 'OPEN_ANNOTATOR', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', imageIndex: 0 })
```
Expected: a full-screen overlay appears with the toolbar. Escape key dismisses it.

- [ ] **Step 4: Commit**

```bash
git add extension/annotate.js
git commit -m "feat: annotation canvas — annotate.js drawing tools"
```

---

## Task 4: content.js — Image slider + OPEN_ANNOTATOR trigger + ANNOTATION_DONE handler

**Files:**
- Modify: `extension/content.js`

**Interfaces:**
- Consumes: `{ type: 'ANNOTATION_DONE', dataUrl: string, imageIndex: number, keepOriginal: boolean }` from annotate.js via chrome.runtime.onMessage
- Produces: `{ type: 'OPEN_ANNOTATOR', dataUrl: string, imageIndex: number }` message to background.js
- Modifies: `showModal()` — replaces static `screenshotHtml` string with dynamic slider

- [ ] **Step 1: Add slider state variables at the top of the modal function**

In `extension/content.js`, inside the `showModal(opts)` function (around line 785), add slider state variables right after the variable declarations at the top of `showModal`:

```js
// ── Slider state ─────────────────────────────────────────────────────────
var sliderImages = [];
if (screenshotDataUrl)     sliderImages.push({ dataUrl: screenshotDataUrl,     label: 'Element' });
if (fullScreenshotDataUrl) sliderImages.push({ dataUrl: fullScreenshotDataUrl, label: 'Full page' });
var sliderIndex = 0;
```

- [ ] **Step 2: Replace screenshotHtml with a slider builder function**

In `showModal()`, find this block (around line 821):

```js
var screenshotHtml = screenshotDataUrl
  ? '<img class="qa-modal-thumbnail" src="' + screenshotDataUrl + '" alt="Screenshot">'
  : '<div style="height:4px"></div>';
```

Replace it with:

```js
function buildSliderHtml() {
  if (sliderImages.length === 0) return '<div style="height:4px"></div>';
  var img = sliderImages[sliderIndex];
  var navHtml = sliderImages.length > 1
    ? '<button class="qa-slider-nav qa-slider-nav-prev" id="qa-slider-prev">‹</button>' +
      '<button class="qa-slider-nav qa-slider-nav-next" id="qa-slider-next">›</button>' +
      '<span class="qa-slider-counter" id="qa-slider-counter">' + (sliderIndex + 1) + ' / ' + sliderImages.length + '</span>'
    : '';
  return '<div class="qa-modal-slider" id="qa-modal-slider">' +
    '<img class="qa-modal-slider-img" id="qa-slider-img" src="' + img.dataUrl + '" alt="Screenshot">' +
    navHtml +
    '<button class="qa-slider-edit-btn" id="qa-slider-edit">✏ Edit</button>' +
  '</div>';
}
var screenshotHtml = buildSliderHtml();
```

- [ ] **Step 3: Wire slider navigation and Edit button after modal is appended to DOM**

Find the line `document.documentElement.appendChild(modal);` (around line 920). Directly after it, add:

```js
// ── Slider interactivity ──────────────────────────────────────────────────
function refreshSlider() {
  var sliderEl  = modal.querySelector('#qa-modal-slider');
  var imgEl     = modal.querySelector('#qa-slider-img');
  var counterEl = modal.querySelector('#qa-slider-counter');
  if (!sliderEl || !imgEl) return;
  imgEl.src = sliderImages[sliderIndex].dataUrl;
  if (counterEl) counterEl.textContent = (sliderIndex + 1) + ' / ' + sliderImages.length;
}

var prevBtn = modal.querySelector('#qa-slider-prev');
var nextBtn = modal.querySelector('#qa-slider-next');
var editBtn = modal.querySelector('#qa-slider-edit');

if (prevBtn) {
  prevBtn.addEventListener('click', function () {
    sliderIndex = (sliderIndex - 1 + sliderImages.length) % sliderImages.length;
    refreshSlider();
  });
}
if (nextBtn) {
  nextBtn.addEventListener('click', function () {
    sliderIndex = (sliderIndex + 1) % sliderImages.length;
    refreshSlider();
  });
}
if (editBtn) {
  editBtn.addEventListener('click', function () {
    chrome.runtime.sendMessage({
      type:       'OPEN_ANNOTATOR',
      dataUrl:    sliderImages[sliderIndex].dataUrl,
      imageIndex: sliderIndex,
    });
  });
}
```

- [ ] **Step 4: Add ANNOTATION_DONE handler to the content.js message listener**

Find the `chrome.runtime.onMessage.addListener` block in content.js (around line 653). It currently handles `START_REPORTING`, `STOP_REPORTING`, and `IS_RECORDING`. Add the new case:

```js
if (message.type === 'ANNOTATION_DONE') {
  if (message.keepOriginal) {
    // Insert annotated version as a new slide after the edited one
    sliderImages.splice(message.imageIndex + 1, 0, {
      dataUrl: message.dataUrl,
      label:   'Annotated',
    });
    sliderIndex = message.imageIndex + 1;
  } else {
    // Replace the image in place
    sliderImages[message.imageIndex] = {
      dataUrl: message.dataUrl,
      label:   sliderImages[message.imageIndex].label + ' (annotated)',
    };
  }
  refreshSlider();
  sendResponse({ ok: true });
  return true;
}
```

**Important:** `sliderImages`, `sliderIndex`, and `refreshSlider` are declared inside `showModal()`. The `ANNOTATION_DONE` handler needs access to them. To make this work, move the message listener registration inside `showModal()` after the slider variables are declared, and remove it when the modal closes.

Replace the existing `chrome.runtime.onMessage.addListener` block (the one with START_REPORTING / STOP_REPORTING / IS_RECORDING) — keep it as-is for those message types. Add a **separate** listener inside `showModal()`:

```js
// Inside showModal(), after slider state variables:
function onAnnotationDone(message, _sender, sendResponse) {
  if (message.type !== 'ANNOTATION_DONE') return;
  if (message.keepOriginal) {
    sliderImages.splice(message.imageIndex + 1, 0, {
      dataUrl: message.dataUrl,
      label:   'Annotated',
    });
    sliderIndex = message.imageIndex + 1;
  } else {
    sliderImages[message.imageIndex] = {
      dataUrl: message.dataUrl,
      label:   (sliderImages[message.imageIndex].label || '') + ' (annotated)',
    };
  }
  refreshSlider();
  sendResponse({ ok: true });
  return true;
}
chrome.runtime.onMessage.addListener(onAnnotationDone);
```

And in the `closeModal()` function, add cleanup:

```js
function closeModal() {
  modalOpen = false;
  chrome.runtime.onMessage.removeListener(onAnnotationDone);  // ← add this line
  var modal = document.getElementById(MODAL_ID);
  var dim   = document.getElementById(DIM_ID);
  if (modal) modal.remove();
  if (dim)   dim.remove();
  if (recording) enableHover();
}
```

**Note:** `onAnnotationDone` is declared inside `showModal()` so it has closure access to `sliderImages`, `sliderIndex`, and `refreshSlider`. The `closeModal()` function is also declared inside `showModal()` so it can reference `onAnnotationDone` correctly.

- [ ] **Step 5: Update buildIssue() to use sliderImages instead of raw dataUrls**

In `buildIssue()` (around line 925), find:

```js
var screenshot     = screenshotDataUrl     ? screenshotDataUrl.replace(/^data:image\/[a-z]+;base64,/, '')     : undefined;
var fullScreenshot = fullScreenshotDataUrl ? fullScreenshotDataUrl.replace(/^data:image\/[a-z]+;base64,/, '') : undefined;
```

Replace with:

```js
// Use current slider images (may have been annotated)
var screenshot     = sliderImages[0] ? sliderImages[0].dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '') : undefined;
var fullScreenshot = sliderImages[1] ? sliderImages[1].dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '') : undefined;
// If "keep both" added a 3rd image (annotated), include it as fullScreenshot override
if (sliderImages[2]) fullScreenshot = sliderImages[2].dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');
```

- [ ] **Step 6: End-to-end test**

1. Reload extension in `chrome://extensions`
2. Start recording on any page
3. Click any element — modal opens with image slider
4. If in "both" mode: prev/next arrows appear, counter shows "1 / 2"
5. Click "✏ Edit" — full-screen annotation canvas appears
6. Draw a rectangle and an arrow on the screenshot
7. Click "Done ✓" — footer appears with "Replace original" and "Keep both"
8. Click "Replace original" — canvas closes, modal image updates to annotated version
9. Click "Save & Submit" — issue submits successfully

Repeat step 4–8 choosing "Keep both" — verify slider now shows 3 images.

- [ ] **Step 7: Commit**

```bash
git add extension/content.js
git commit -m "feat: annotation canvas — modal slider + Edit button + ANNOTATION_DONE handler"
```

---

## Task 5: Polish + Edge Cases

**Files:**
- Modify: `extension/annotate.js`
- Modify: `extension/content.js`

**Interfaces:**
- No new interfaces — hardening existing ones

- [ ] **Step 1: Handle single-image modes in the slider (no "both" mode)**

In `content.js` `buildSliderHtml()`, the slider already handles `sliderImages.length === 1` (no nav arrows, just the image + Edit button). Verify by testing in `element_crop` mode (set screenshotMode in settings to `element_crop`). Modal should show one image with an Edit button and no prev/next arrows.

- [ ] **Step 2: Prevent modal scroll while annotator is open**

In `content.js`, inside the `editBtn` click handler, add:

```js
editBtn.addEventListener('click', function () {
  modal.style.pointerEvents = 'none';   // freeze modal while annotating
  chrome.runtime.sendMessage({
    type:       'OPEN_ANNOTATOR',
    dataUrl:    sliderImages[sliderIndex].dataUrl,
    imageIndex: sliderIndex,
  });
});
```

And in the `onAnnotationDone` handler, after calling `refreshSlider()`, restore:

```js
modal.style.pointerEvents = '';
```

Also restore if user presses Escape (the annotator fires no message in that case). Add a storage listener in content.js to detect when `qa_annotator_data` is removed (Escape path):

```js
chrome.storage.onChanged.addListener(function (changes) {
  if (changes.qa_annotator_data && !changes.qa_annotator_data.newValue) {
    // Annotator was dismissed via Escape
    modal.style.pointerEvents = '';
  }
});
```

- [ ] **Step 3: Handle window resize in annotate.js**

Add a resize handler in `annotate.js` so the canvas redraws correctly if the browser window is resized while the annotator is open:

```js
// Inside the IIFE, after initCanvas is called:
window.addEventListener('resize', function () {
  // Re-read the current canvas content, resize, redraw
  if (history.length === 0) return;
  var currentState = history[history.length - 1];
  var toolbarH = toolbar.getBoundingClientRect().height || 50;
  var dispW = window.innerWidth;
  var dispH = window.innerHeight - toolbarH;
  canvas.style.width  = dispW + 'px';
  canvas.style.height = dispH + 'px';
  canvas.width  = Math.round(dispW  * dpr);
  canvas.height = Math.round(dispH * dpr);
  ctx.scale(dpr, dpr);
  ctx.putImageData(currentState, 0, 0);
});
```

- [ ] **Step 4: Final end-to-end smoke test across screenshot modes**

Test all five screenshot modes by changing `screenshotMode` in workspace settings:
- `element_crop` — one image in slider, Edit works
- `full` — one image in slider, Edit works  
- `element_context` — one image in slider, Edit works
- `full_highlighted` — one image in slider, Edit works
- `both` — two images in slider, each has Edit, keep-both adds third slide

- [ ] **Step 5: Final commit**

```bash
git add extension/annotate.js extension/content.js
git commit -m "feat: annotation canvas — edge cases and polish"
```
