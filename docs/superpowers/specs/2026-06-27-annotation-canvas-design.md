# Design Spec: Screenshot Annotation Canvas
**Date:** 2026-06-27  
**Feature:** Drawing / Annotation on Screenshots  
**Status:** Approved for implementation

---

## Overview

After a screenshot is captured, the submit modal shows a slider between the captured images (element crop + full page in "both" mode). Each image has an **Edit** button. Clicking Edit opens a full-screen annotation canvas overlay where the user can draw on the screenshot before submitting. On Done, the user chooses whether to replace the original or keep both versions.

---

## User Flow

```
Screenshot captured (element crop + full page in "both" mode)
  → Submit modal opens
  → Image slider shows image 1 of 2 / image 2 of 2
  → Each image has an "Edit" button overlay
  → User clicks Edit
    → content.js sends OPEN_ANNOTATOR to background.js
    → background.js injects annotate.js into the tab (on demand, once)
    → Full-screen annotation canvas overlay appears
    → User draws using toolbar tools
    → User clicks "Done"
      → Toggle appears: "Replace original" / "Keep both"
      → Annotated dataUrl returned to content.js via ANNOTATION_DONE message
    → Modal updates the image with the annotated version
  → User fills in title/description and submits
```

---

## Architecture

### Files

| File | Role |
|---|---|
| `extension/content.js` | Owns the modal + image slider UI. Triggers annotator injection. Receives annotated dataUrl back. |
| `extension/annotate.js` | New file. Self-contained annotation canvas overlay (~300 lines). Injected on demand via `chrome.scripting.executeScript`. |
| `extension/content-styles.css` | Add annotation toolbar + overlay styles (qa- prefixed, !important). |
| `extension/background.js` | Handles `OPEN_ANNOTATOR` message — injects `annotate.js` into the active tab. |
| `extension/manifest.json` | Already has `scripting` permission — no changes needed. |

### Message Flow

```
content.js  ──OPEN_ANNOTATOR { dataUrl, imageIndex }──►  background.js
background.js  ──executeScript(annotate.js)──►  tab
annotate.js  ──ANNOTATION_DONE { dataUrl, imageIndex, keepOriginal }──►  content.js
```

---

## Image Slider (Modal Change)

The existing screenshot preview area in the submit modal becomes a slider when "both" mode captures 2 images.

- Prev / Next arrows on the sides
- "1 / 2" indicator below
- Each image fills the preview area
- "Edit" button sits in the top-right corner of the image preview (absolute positioned)
- In single-image modes (element_crop, full, etc.), no slider — just the single image with Edit button

---

## Annotation Canvas (`annotate.js`)

### Overlay Structure

```html
<div id="qa-annotator-overlay">        <!-- full screen, fixed, z-index: 2147483647 -->
  <div id="qa-annotator-toolbar">      <!-- top bar, dark background -->
    <!-- tool buttons + color picker + undo + done -->
  </div>
  <canvas id="qa-annotator-canvas">   <!-- fills remaining space -->
  </canvas>
  <div id="qa-annotator-footer">       <!-- bottom bar on Done -->
    <!-- "Replace original" | "Keep both" toggle -->
  </div>
</div>
```

### Tools

| Tool | Behaviour |
|---|---|
| **Rectangle** | Click-drag draws a filled rectangle with 15% opacity fill + 2.5px stroke |
| **Arrow** | Click-drag draws a line with arrowhead polygon at the end point |
| **Circle** | Click-drag draws an ellipse with 15% opacity fill + 2.5px stroke |
| **Freehand pen** | Continuous lineTo path while mouse held, committed per stroke |
| **Text** | Click opens a native `prompt()` for the label, renders at click position |
| **Blur / Redact** | Click-drag draws a solid dark rectangle (rgba 0,0,0,0.75) over sensitive areas |
| **Color picker** | `<input type="color">` — applies to all drawing tools |
| **Undo** | Pops last operation from history stack, redraws from scratch |

### Undo Stack

Each completed drawing operation (mouseup) saves the full canvas state via `ctx.getImageData()`. Undo calls `ctx.putImageData()` with the previous state. Stack initialised with the base screenshot as state[0] — undo cannot go past it.

### Retina / HiDPI

```js
const dpr = window.devicePixelRatio || 1;
canvas.width  = displayWidth  * dpr;
canvas.height = displayHeight * dpr;
canvas.style.width  = displayWidth  + 'px';
canvas.style.height = displayHeight + 'px';
ctx.scale(dpr, dpr);
```

All mouse coordinates divided by dpr before use.

### Done Flow

1. User clicks "Done"
2. Footer appears with two buttons: **"Replace original"** and **"Keep both"**
3. Selection fires `chrome.runtime.sendMessage({ type: 'ANNOTATION_DONE', dataUrl: canvas.toDataURL('image/png'), imageIndex, keepOriginal: boolean })`
4. Overlay removes itself from DOM

---

## Modal: Receiving the Annotated Image

In `content.js`, the `ANNOTATION_DONE` handler:

```js
case 'ANNOTATION_DONE':
  if (msg.keepOriginal) {
    // add annotated as a third image in the slider
    images.splice(msg.imageIndex + 1, 0, { dataUrl: msg.dataUrl, label: 'Annotated' });
  } else {
    // replace the image at imageIndex
    images[msg.imageIndex].dataUrl = msg.dataUrl;
  }
  renderSlider();
  break;
```

---

## Styles

All classes prefixed `qa-annotator-`. All rules use `!important`. Annotation overlay sits at `z-index: 2147483647` (max) to clear any page content.

Toolbar: dark (`#0f1124` background), icon buttons with active state (`#5b5fc7`). Matches existing sidepanel dark header aesthetic.

---

## What Is Not In Scope (v1)

- Selecting / moving drawn objects after placing them
- Saving annotation as a separate layer (only flattened dataUrl stored)
- Keyboard shortcuts for tools
- Stroke width control

---

## Effort Estimate

| Task | Days |
|---|---|
| Image slider in submit modal | 0.5 |
| `annotate.js` canvas overlay + all 6 tools | 3.5 |
| Undo stack + retina handling | 0.5 |
| Done flow + keep/replace toggle | 0.5 |
| Message wiring (content ↔ background ↔ annotate) | 0.5 |
| Styles + polish | 0.5 |
| **Total** | **6 days** |
