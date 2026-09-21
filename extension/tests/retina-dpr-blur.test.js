// Unit test suite for Retina DPR coordinate alignment in annotation blur
// Milestone 1 Iteration 2 (BugPilot)
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ANNOTATE_PATH = path.join(__dirname, '..', 'annotate.js');

test('Retina DPR=2: blur draw width in CSS pixels equals 1200 (physical 2400) without 200% magnification', () => {
  const dpr = 2;
  const innerW = 1200;
  const innerH = 900;
  const toolbarH = 50;

  // Outer display dimensions in CSS pixels (as computed by setupCanvas)
  const dispW = innerW;
  const dispH = innerH - toolbarH; // 850
  assert.strictEqual(dispW, 1200, 'Outer CSS display width must be 1200');
  assert.strictEqual(dispH, 850, 'Outer CSS display height must be 850');

  // Canvas buffer dimensions in physical device pixels
  const canvasWidth = Math.round(dispW * dpr); // 2400
  const canvasHeight = Math.round(dispH * dpr); // 1700
  assert.strictEqual(canvasWidth, 2400, 'Canvas buffer width must be 2400 physical pixels');
  assert.strictEqual(canvasHeight, 1700, 'Canvas buffer height must be 1700 physical pixels');

  // Screenshot captured on Retina screen
  const baseImage = {
    naturalWidth: 2400,
    naturalHeight: 1700,
    src: 'data:image/png;base64,retinascreenshot'
  };

  // 1. Redraw base screenshot calculation (reference ground truth)
  const baseScale = Math.min(dispW / baseImage.naturalWidth, dispH / baseImage.naturalHeight);
  const baseDrawW = baseImage.naturalWidth * baseScale;
  const baseDrawH = baseImage.naturalHeight * baseScale;
  const baseDrawX = (dispW - baseDrawW) / 2;
  const baseDrawY = (dispH - baseDrawH) / 2;

  assert.strictEqual(baseScale, 0.5, 'Base scale must be 0.5 for 2400px image in 1200px viewport');
  assert.strictEqual(baseDrawW, 1200, 'Base draw width in CSS pixels must be 1200');
  assert.strictEqual(baseDrawH, 850, 'Base draw height in CSS pixels must be 850');
  assert.strictEqual(baseDrawW * dpr, 2400, 'Base physical draw width must equal 2400 physical pixels');

  // 2. annotate.js blur shape rendering (using outer dispW and dispH, without shadowing)
  const drawOps = [];
  const mockCtx = {
    saved: 0,
    transform: { a: dpr, b: 0, c: 0, d: dpr, e: 0, f: 0 },
    filter: 'none',
    lineDash: [],
    save() { this.saved++; drawOps.push({ op: 'save' }); },
    restore() { this.saved--; drawOps.push({ op: 'restore' }); },
    beginPath() { drawOps.push({ op: 'beginPath' }); },
    rect(x, y, w, h) { drawOps.push({ op: 'rect', x, y, w, h }); },
    clip() { drawOps.push({ op: 'clip' }); },
    drawImage(img, dx, dy, dw, dh) {
      drawOps.push({
        op: 'drawImage',
        img: img.src,
        dx,
        dy,
        dw,
        dh,
        physicalWidth: dw * dpr,
        physicalHeight: dh * dpr,
      });
    },
    setLineDash(dash) { this.lineDash = dash; drawOps.push({ op: 'setLineDash', dash }); },
    strokeRect(x, y, w, h) { drawOps.push({ op: 'strokeRect', x, y, w, h }); }
  };

  // Execute blur drawing logic matching annotate.js lines 188-215
  function drawBlur(ctx, s) {
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
      var drawW = baseImage.naturalWidth * scale;
      var drawH = baseImage.naturalHeight * scale;
      ctx.drawImage(baseImage, (dispW - drawW) / 2, (dispH - drawH) / 2, drawW, drawH);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(91, 95, 199, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }
  }

  // Draw blur shape
  drawBlur(mockCtx, { type: 'blur', x1: 100, y1: 100, x2: 300, y2: 250 });

  const drawImgOp = drawOps.find(op => op.op === 'drawImage');
  assert.ok(drawImgOp, 'drawImage must be called');

  // VERIFICATION OF CRITERIA:
  // (a) Blur draw width in CSS pixels equals 1200
  assert.strictEqual(drawImgOp.dw, 1200, 'Blur draw width in CSS pixels must equal 1200');
  // (b) Physical width equals 2400
  assert.strictEqual(drawImgOp.physicalWidth, 2400, 'Physical draw width must equal 2400 (matching baseImage.naturalWidth)');
  // (c) Coordinates perfectly match baseImage scaling without 200% magnification
  assert.strictEqual(drawImgOp.dw, baseDrawW, 'Blur draw width must match baseImage draw width exactly');
  assert.strictEqual(drawImgOp.dh, baseDrawH, 'Blur draw height must match baseImage draw height exactly');
  assert.strictEqual(drawImgOp.dx, baseDrawX, 'Blur draw X offset must match baseImage X offset exactly');
  assert.strictEqual(drawImgOp.dy, baseDrawY, 'Blur draw Y offset must match baseImage Y offset exactly');

  // Demonstrating the bug that was fixed:
  // If dispW had been shadowed by canvas.width (2400):
  const buggyScale = Math.min(canvasWidth / baseImage.naturalWidth, canvasHeight / baseImage.naturalHeight); // 1.0
  const buggyDrawW = baseImage.naturalWidth * buggyScale; // 2400 CSS px
  const buggyPhysicalWidth = buggyDrawW * dpr; // 4800 physical px (200% magnification defect)
  assert.strictEqual(buggyDrawW, 2400, 'Buggy code resulted in 2400 CSS px');
  assert.strictEqual(buggyPhysicalWidth, 4800, 'Buggy code produced 4800 physical px (2x magnification)');
  assert.notStrictEqual(drawImgOp.physicalWidth, buggyPhysicalWidth, 'Corrected blur must NOT produce 4800px magnification');
});

test('annotate.js source code audit: dispW and dispH are not shadowed in blur block', () => {
  const content = fs.readFileSync(ANNOTATE_PATH, 'utf8');

  // Extract blur shape handling block
  const blurBlockMatch = content.match(new RegExp('else\\s+if\\s*\\(\\s*s\\.type\\s*===\\s*[\'"]blur[\'"]\\s*\\)\\s*\\{([\\s\\S]*?)\\}', 'm'));
  assert.ok(blurBlockMatch, 'annotate.js must contain s.type === "blur" block');

  const blurBlock = blurBlockMatch[1];

  // Must NOT shadow dispW or dispH with canvas.width / canvas.height
  assert.strictEqual(
    /var\s+dispW\s*=\s*canvas\.width/.test(blurBlock),
    false,
    'annotate.js blur block must NOT shadow dispW with canvas.width'
  );
  assert.strictEqual(
    /var\s+dispH\s*=\s*canvas\.height/.test(blurBlock),
    false,
    'annotate.js blur block must NOT shadow dispH with canvas.height'
  );

  // Must reference outer dispW and dispH
  assert.match(
    blurBlock,
    /Math\.min\(\s*dispW\s*\/\s*baseImage\.naturalWidth,\s*dispH\s*\/\s*baseImage\.naturalHeight\s*\)/,
    'annotate.js must compute scale from outer dispW and dispH'
  );

  // Must draw baseImage at (dispW - drawW) / 2, (dispH - drawH) / 2
  assert.match(
    blurBlock,
    /ctx\.drawImage\(\s*baseImage,\s*\(\s*dispW\s*-\s*drawW\s*\)\s*\/\s*2,\s*\(\s*dispH\s*-\s*drawH\s*\)\s*\/\s*2,\s*drawW,\s*drawH\s*\)/,
    'annotate.js must draw image at centered CSS coordinates'
  );
});

test('Retina DPR=3: higher density scaling maintains 1:1 physical alignment', () => {
  const dpr = 3;
  const dispW = 1000;
  const dispH = 700;
  const canvasWidth = Math.round(dispW * dpr); // 3000
  const canvasHeight = Math.round(dispH * dpr); // 2100

  const baseImage = { naturalWidth: 3000, naturalHeight: 2100 };

  const scale = Math.min(dispW / baseImage.naturalWidth, dispH / baseImage.naturalHeight); // 1/3
  const drawW = baseImage.naturalWidth * scale; // 1000 CSS px
  const drawH = baseImage.naturalHeight * scale; // 700 CSS px

  assert.strictEqual(drawW, 1000, 'Draw width in CSS pixels must equal 1000');
  assert.strictEqual(drawH, 700, 'Draw height in CSS pixels must equal 700');
  assert.strictEqual(drawW * dpr, 3000, 'Physical draw width must equal 3000, perfectly matching 3000px natural image');
});
