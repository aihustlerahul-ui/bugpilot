// Challenger Milestone 1 Test Suite: Empirical stress-testing of M1 features
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXT_DIR = path.resolve(__dirname, '..');
const RRWEB_PATH = path.join(EXT_DIR, 'rrweb-record.min.js');
const MANIFEST_PATH = path.join(EXT_DIR, 'manifest.json');
const BACKGROUND_PATH = path.join(EXT_DIR, 'background.js');
const RECORDER_PATH = path.join(EXT_DIR, 'replay-recorder.js');
const CONTENT_PATH = path.join(EXT_DIR, 'content.js');
const ANNOTATE_PATH = path.join(EXT_DIR, 'annotate.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Validate extension/rrweb-record.min.js
// ─────────────────────────────────────────────────────────────────────────────

test('rrweb-record: bundle footprint is < 220KB and ~66% smaller than original', () => {
  assert.ok(fs.existsSync(RRWEB_PATH), 'extension/rrweb-record.min.js must exist');
  const stats = fs.statSync(RRWEB_PATH);
  const sizeBytes = stats.size;
  const sizeKB = sizeBytes / 1024;

  // Strict thresholds
  assert.ok(sizeBytes < 220 * 1024, `Bundle size ${sizeKB.toFixed(2)} KB must be < 220 KB`);
  assert.ok(sizeBytes < 220000, `Bundle size ${sizeBytes} bytes must be < 220,000 bytes`);

  // Target was 182KB (~182,753 bytes)
  assert.ok(sizeBytes <= 190000, `Bundle size ${sizeBytes} bytes should be close to 182KB target`);

  // Verify reduction compared to original 535,596 bytes
  const originalSize = 535596;
  const reductionPercent = ((originalSize - sizeBytes) / originalSize) * 100;
  assert.ok(reductionPercent >= 60, `Reduction (${reductionPercent.toFixed(1)}%) must exceed 60%`);
});

test('rrweb-record: executes in V8/Node VM and exports record and takeFullSnapshot', () => {
  const code = fs.readFileSync(RRWEB_PATH, 'utf8');

  // Realistic browser global environment mock
  const sandbox = {
    window: {},
    document: {
      createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      readyState: 'complete'
    },
    navigator: { userAgent: 'Chrome/120.0.0.0 Safari/537.36' },
    location: { href: 'http://localhost:3000/app', origin: 'http://localhost:3000' },
    Date: Date,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Element: class {},
    HTMLCanvasElement: class {},
    CanvasRenderingContext2D: class {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(code, sandbox);
  }, 'rrweb-record.min.js must execute in V8 without throwing');

  const rrweb = sandbox.rrweb;
  assert.ok(rrweb, 'rrweb must be defined on window/globalThis');
  assert.strictEqual(typeof rrweb.record, 'function', 'rrweb.record must be a function');
  assert.strictEqual(typeof rrweb.takeFullSnapshot, 'function', 'rrweb.takeFullSnapshot must be a function');
  assert.ok(rrweb.EventType, 'rrweb.EventType enum must be exported');
  assert.ok(rrweb.IncrementalSource, 'rrweb.IncrementalSource enum must be exported');
  assert.ok(rrweb.MouseInteractions, 'rrweb.MouseInteractions enum must be exported');
});

test('rrweb-record: exposes callable record and takeFullSnapshot interfaces and methods', () => {
  const code = fs.readFileSync(RRWEB_PATH, 'utf8');

  const sandbox = {
    window: {},
    document: {},
    navigator: { userAgent: 'Chrome/120.0.0.0 Safari/537.36' },
    location: { href: 'http://localhost/' },
    Date: Date,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Element: class {},
    HTMLCanvasElement: class {},
    CanvasRenderingContext2D: class {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  assert.strictEqual(typeof sandbox.rrweb.record, 'function', 'record must be a function');
  assert.strictEqual(typeof sandbox.rrweb.takeFullSnapshot, 'function', 'takeFullSnapshot must be a function');
  assert.strictEqual(typeof sandbox.rrweb.record.takeFullSnapshot, 'function', 'record.takeFullSnapshot must also be a function');
  assert.strictEqual(typeof sandbox.rrweb.record.addCustomEvent, 'function', 'record.addCustomEvent must be a function');
  assert.strictEqual(typeof sandbox.rrweb.record.freezePage, 'function', 'record.freezePage must be a function');
  assert.ok(sandbox.rrweb.record.mirror, 'record.mirror must exist');
});

test('rrweb-record: manifest.json and background.js correctly reference decoupled bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const war = manifest.web_accessible_resources;
  assert.ok(Array.isArray(war), 'web_accessible_resources must be an array');
  const allResources = war.flatMap(w => w.resources);

  assert.ok(allResources.includes('rrweb-record.min.js'), 'manifest must expose rrweb-record.min.js in web_accessible_resources');
  assert.ok(!allResources.includes('rrweb.min.js'), 'manifest must NOT expose old rrweb.min.js');

  const bg = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  assert.match(bg, /files:\s*\[['"]rrweb-record\.min\.js['"]\]/, 'background.js must inject rrweb-record.min.js');
  assert.ok(!bg.includes('rrweb.min.js'), 'background.js must have NO occurrences of rrweb.min.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Validate canvas recording configuration in replay-recorder.js
// ─────────────────────────────────────────────────────────────────────────────

test('canvas recording: replay-recorder.js sets recordCanvas: true and sampling.canvas: 2', () => {
  const content = fs.readFileSync(RECORDER_PATH, 'utf8');

  // Verify recordCanvas is boolean true, not number 4
  assert.match(content, /recordCanvas:\s*true\b/, 'replay-recorder.js must set recordCanvas: true');
  assert.doesNotMatch(content, /recordCanvas:\s*\d+/, 'replay-recorder.js must NOT set recordCanvas to a numeric value (e.g., 4)');

  // Verify sampling.canvas is set to 2
  assert.match(content, /sampling:\s*\{[^}]*canvas:\s*2\b/s, 'replay-recorder.js must configure sampling.canvas: 2');
});

test('canvas recording: replay-recorder.js snapshot fallback supports function export', () => {
  const content = fs.readFileSync(RECORDER_PATH, 'utf8');

  // Verify both rrweb.record.takeFullSnapshot AND rrweb.takeFullSnapshot are handled
  assert.match(content, /rrweb\.record\.takeFullSnapshot/, 'replay-recorder.js should check rrweb.record.takeFullSnapshot');
  assert.match(content, /rrweb\.takeFullSnapshot/, 'replay-recorder.js should check rrweb.takeFullSnapshot fallback');
  assert.match(content, /typeof rrweb\.record === 'function'/, 'replay-recorder.js should handle rrweb.record as function');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Validate Bug Magnet context menus in background.js and content.js
// ─────────────────────────────────────────────────────────────────────────────

test('bug magnet: audit of all 8 categories and payloads in background.js', () => {
  const bg = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const match = bg.match(/const BUG_MAGNET_DATA = (\{[\s\S]*?\n\};)/);
  assert.ok(match, 'BUG_MAGNET_DATA definition must be found in background.js');

  // Parse BUG_MAGNET_DATA safely
  const bugMagnetData = eval('(' + match[1].replace(/;\s*$/, '') + ')');
  const categories = Object.keys(bugMagnetData);

  const expectedCategories = ['whitespace', 'accents', 'emojis', 'rtl', 'emails', 'numbers', 'boundaries', 'exploits'];
  assert.strictEqual(categories.length, 8, 'Must define exactly 8 categories');
  assert.deepStrictEqual(categories, expectedCategories, 'Categories must match expected 8');

  let totalItems = 0;
  let emptyCount = 0;
  const nonBoundaryItems = [];

  for (const [catKey, cat] of Object.entries(bugMagnetData)) {
    assert.ok(cat.title, `Category ${catKey} must have a title`);
    assert.ok(Array.isArray(cat.items), `Category ${catKey} must have items array`);
    assert.ok(cat.items.length > 0, `Category ${catKey} items must not be empty`);

    for (const item of cat.items) {
      totalItems++;
      assert.ok(item.id && item.id.startsWith('bm_'), `Item id ${item.id} must start with bm_`);
      assert.ok(item.title, `Item ${item.id} must have a title`);
      assert.strictEqual(typeof item.value, 'string', `Item ${item.id} value must be a string`);

      if (catKey !== 'boundaries') {
        nonBoundaryItems.push(item);
      }
      if (item.value === '') {
        emptyCount++;
      }
    }
  }

  // Verification of worker claim vs reality:
  // Worker handoff stated "across 8 categories with 38 payloads".
  // Reality: 38 payloads in the first 7 categories, plus 5 boundary payloads = 43 total payloads.
  assert.strictEqual(nonBoundaryItems.length, 38, 'Non-boundary categories contain exactly 38 payloads');
  assert.strictEqual(totalItems, 43, 'Total items across all 8 categories is 43');

  // Verify all 38 non-boundary payloads are strictly non-empty strings
  for (const item of nonBoundaryItems) {
    assert.ok(item.value.length > 0, `Non-boundary item ${item.id} must be a non-empty string`);
  }

  // In boundaries category, exactly 1 item is intentionally empty string: bm_str_empty
  assert.strictEqual(emptyCount, 1, 'Only bm_str_empty should have empty string value');
  const emptyItem = bugMagnetData.boundaries.items.find(i => i.id === 'bm_str_empty');
  assert.ok(emptyItem, 'bm_str_empty must exist in boundaries');
  assert.strictEqual(emptyItem.value, '');
});

test('bug magnet: background.js click handler safely handles empty string payload', () => {
  const bg = fs.readFileSync(BACKGROUND_PATH, 'utf8');

  // Adversarial check: verify that targetValue is not checked via truthiness (if (targetValue))
  // because "" is falsy and would fail to send the empty string test payload!
  assert.match(bg, /targetValue !== null/, 'background.js must check targetValue !== null so empty string payload is preserved');
});

test('bug magnet: content.js BUG_MAGNET_INSERT input manipulation and event dispatching', () => {
  // Simulate BUG_MAGNET_INSERT in content.js across various DOM scenarios
  function simulateContentInsert(element, messageValue) {
    const el = element;
    const message = { type: 'BUG_MAGNET_INSERT', value: messageValue };
    const dispatchedEvents = [];
    el.dispatchEvent = (ev) => dispatchedEvents.push(ev);

    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : (el.value || '').length;
      const val = el.value || '';
      const insertVal = message.value != null ? String(message.value) : '';
      el.value = val.substring(0, start) + insertVal + val.substring(end);
      el.selectionStart = el.selectionEnd = start + insertVal.length;
      el.dispatchEvent({ type: 'input', bubbles: true });
      el.dispatchEvent({ type: 'change', bubbles: true });
    }
    return { el, dispatchedEvents };
  }

  // 1. Text input: insert at cursor
  const input1 = { tagName: 'INPUT', value: 'Hello World', selectionStart: 5, selectionEnd: 5 };
  const res1 = simulateContentInsert(input1, ' Beautiful');
  assert.strictEqual(res1.el.value, 'Hello Beautiful World');
  assert.strictEqual(res1.el.selectionStart, 15);
  assert.strictEqual(res1.el.selectionEnd, 15);
  assert.strictEqual(res1.dispatchedEvents.length, 2);
  assert.strictEqual(res1.dispatchedEvents[0].type, 'input');
  assert.strictEqual(res1.dispatchedEvents[0].bubbles, true);
  assert.strictEqual(res1.dispatchedEvents[1].type, 'change');
  assert.strictEqual(res1.dispatchedEvents[1].bubbles, true);

  // 2. Text input: replace selection
  const input2 = { tagName: 'INPUT', value: 'Hello REPLACE World', selectionStart: 6, selectionEnd: 13 };
  const res2 = simulateContentInsert(input2, 'BugMagnet');
  assert.strictEqual(res2.el.value, 'Hello BugMagnet World');
  assert.strictEqual(res2.el.selectionStart, 15);

  // 3. Text input: replace with empty string payload (bm_str_empty)
  const input3 = { tagName: 'INPUT', value: 'Keep DeleteMe Keep', selectionStart: 5, selectionEnd: 14 };
  const res3 = simulateContentInsert(input3, '');
  assert.strictEqual(res3.el.value, 'Keep Keep');
  assert.strictEqual(res3.el.selectionStart, 5);

  // 4. Textarea: multiline insertion with emojis
  const textarea = { tagName: 'TEXTAREA', value: 'Line 1\nLine 2', selectionStart: 6, selectionEnd: 6 };
  const res4 = simulateContentInsert(textarea, '\n👋 🚀 🐞');
  assert.strictEqual(res4.el.value, 'Line 1\n👋 🚀 🐞\nLine 2');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Validate extension/annotate.js blur filter
// ─────────────────────────────────────────────────────────────────────────────

test('annotate: ctx.filter = blur(12px) branch exists, clips to box, redraws baseImage, and strokes dashed border', () => {
  const content = fs.readFileSync(ANNOTATE_PATH, 'utf8');

  // Verify the blur branch exists
  assert.match(content, /s\.type === ['"]blur['"]/, 'annotate.js must have s.type === "blur" branch');

  // Verify ctx.filter = blur(12px)
  assert.match(content, /ctx\.filter\s*=\s*['"]blur\(12px\)['"]/, 'annotate.js must set ctx.filter = "blur(12px)"');

  // Verify clipping path is established
  assert.match(content, /ctx\.beginPath\(\);[\s\S]*?ctx\.rect\(bx,\s*by,\s*bw,\s*bh\);[\s\S]*?ctx\.clip\(\);/, 'annotate.js must clip to rectangular shape bounds');

  // Verify baseImage is redrawn inside clipped region
  assert.match(content, /ctx\.drawImage\(baseImage,/, 'annotate.js must redraw baseImage within clipped filter context');

  // Verify context is restored
  assert.match(content, /ctx\.restore\(\);/, 'annotate.js must restore ctx after applying filter');

  // Verify dashed indicator border is drawn
  assert.match(content, /ctx\.setLineDash\(\[4,\s*4\]\)/, 'annotate.js must set dashed border [4, 4]');
  assert.match(content, /ctx\.strokeRect\(bx,\s*by,\s*bw,\s*bh\)/, 'annotate.js must stroke dashed rectangle');

  // Verify that dispW and dispH are NOT shadowed by canvas.width/height in blur block (prevents Retina 200% magnification)
  const blurBlockMatch = content.match(/s\.type === ['"]blur['"][\s\S]*?ctx\.restore\(\);/);
  assert.ok(blurBlockMatch, 'annotate.js must have s.type === "blur" block');
  assert.doesNotMatch(blurBlockMatch[0], /var\s+dispW\s*=\s*canvas\.width/, 'blur block must not shadow dispW with canvas.width');
  assert.doesNotMatch(blurBlockMatch[0], /var\s+dispH\s*=\s*canvas\.height/, 'blur block must not shadow dispH with canvas.height');
});

test('annotate: execution simulation of blur render logic and Retina DPR coordinate alignment', () => {
  const drawOps = [];
  const mockCtx = {
    saved: 0,
    filter: 'none',
    strokeStyle: '',
    lineWidth: 0,
    lineDash: [],
    save() { this.saved++; drawOps.push({ op: 'save' }); },
    restore() { this.saved--; drawOps.push({ op: 'restore' }); },
    beginPath() { drawOps.push({ op: 'beginPath' }); },
    rect(x, y, w, h) { drawOps.push({ op: 'rect', x, y, w, h }); },
    clip() { drawOps.push({ op: 'clip' }); },
    drawImage(img, dx, dy, dw, dh) { drawOps.push({ op: 'drawImage', img: img.src, dx, dy, dw, dh }); },
    setLineDash(dash) { this.lineDash = dash; drawOps.push({ op: 'setLineDash', dash }); },
    strokeRect(x, y, w, h) { drawOps.push({ op: 'strokeRect', x, y, w, h }); }
  };

  const dispW = 800, dispH = 600;
  const baseImage = { naturalWidth: 1600, naturalHeight: 1200, src: 'base64://image' };

  // Simulate execution of annotate.js lines 188-215 using outer CSS display dimensions dispW, dispH
  function renderBlurShape(ctx, dispW, dispH, baseImage, s) {
    var bx = Math.min(s.x1, s.x2);
    var by = Math.min(s.y1, s.y2);
    var bw = Math.abs(s.x2 - s.x1);
    var bh = Math.abs(s.y2 - s.y1);

    if (bw > 0 && bh > 0 && baseImage) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      ctx.filter = 'blur(12px)';

      var scale = Math.min(dispW / baseImage.naturalWidth, dispH / baseImage.naturalHeight);
      var drawW = baseImage.naturalWidth  * scale;
      var drawH = baseImage.naturalHeight * scale;
      ctx.drawImage(baseImage, (dispW - drawW) / 2, (dispH - drawH) / 2, drawW, drawH);
      ctx.restore();

      // Subtle dashed indicator around blur region
      ctx.save();
      ctx.strokeStyle = 'rgba(91, 95, 199, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }
  }

  // 1. Inverted coordinate drag: x1 > x2, y1 > y2
  renderBlurShape(mockCtx, dispW, dispH, baseImage, { type: 'blur', x1: 200, y1: 150, x2: 50, y2: 50 });

  assert.strictEqual(mockCtx.saved, 0, 'Ctx save/restore must balance to 0');
  assert.deepStrictEqual(mockCtx.lineDash, [4, 4]);

  const rectOp = drawOps.find(op => op.op === 'rect');
  assert.deepStrictEqual(rectOp, { op: 'rect', x: 50, y: 50, w: 150, h: 100 }, 'Must normalize inverted coordinates');

  const strokeOp = drawOps.find(op => op.op === 'strokeRect');
  assert.deepStrictEqual(strokeOp, { op: 'strokeRect', x: 50, y: 50, w: 150, h: 100 }, 'Dashed stroke must match bounds');

  const drawImgOp = drawOps.find(op => op.op === 'drawImage');
  assert.ok(drawImgOp, 'drawImage must be called');
  assert.strictEqual(drawImgOp.dw, 800);
  assert.strictEqual(drawImgOp.dh, 600);

  // 2. Zero dimension drag: bw === 0
  drawOps.length = 0;
  renderBlurShape(mockCtx, dispW, dispH, baseImage, { type: 'blur', x1: 100, y1: 100, x2: 100, y2: 150 });
  assert.strictEqual(drawOps.length, 0, 'Zero-width drag must not execute any drawing operations');

  // 3. Null baseImage
  drawOps.length = 0;
  renderBlurShape(mockCtx, dispW, dispH, null, { type: 'blur', x1: 100, y1: 100, x2: 200, y2: 200 });
  assert.strictEqual(drawOps.length, 0, 'Null baseImage must not execute drawing operations');

  // 4. Retina DPR = 2 coordinate alignment test:
  // Viewport CSS dimensions: dispW = 1200, dispH = 850 (canvas physical buffer = 2400x1700)
  // Screenshot natural dimensions: 2400x1700
  const dpr = 2;
  const retinaDispW = 1200;
  const retinaDispH = 850;
  const retinaBaseImage = { naturalWidth: 2400, naturalHeight: 1700, src: 'base64://retina' };
  drawOps.length = 0;
  renderBlurShape(mockCtx, retinaDispW, retinaDispH, retinaBaseImage, { type: 'blur', x1: 50, y1: 50, x2: 200, y2: 150 });
  const retinaDrawImgOp = drawOps.find(op => op.op === 'drawImage');
  assert.ok(retinaDrawImgOp, 'drawImage must be called on Retina');
  // CSS pixel draw width must equal 1200 (scale = 0.5)
  assert.strictEqual(retinaDrawImgOp.dw, 1200, 'CSS draw width must equal 1200 on Retina');
  assert.strictEqual(retinaDrawImgOp.dh, 850, 'CSS draw height must equal 850 on Retina');
  // Physical width under ctx.setTransform(dpr, 0, 0, dpr, 0, 0) is dw * dpr:
  assert.strictEqual(retinaDrawImgOp.dw * dpr, 2400, 'Physical draw width must equal 2400, matching baseImage without 200% magnification');
});
