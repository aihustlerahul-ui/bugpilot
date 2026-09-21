// Tests for aspect-ratio aware geometry, padding math, and dashed callout border
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const PAD_RATIO = 0.3;
const MIN_PAD = 24;

function calculateCropGeometry(rect, padding, dpr, imgWidth, imgHeight) {
  const padX = padding === 0 ? 0 : Math.max(MIN_PAD, Math.round(rect.width * PAD_RATIO));
  const padY = padding === 0 ? 0 : Math.max(MIN_PAD, Math.round(rect.height * PAD_RATIO));

  const x = Math.max(0, (rect.left - padX) * dpr);
  const y = Math.max(0, (rect.top  - padY) * dpr);
  const w = Math.min(imgWidth  - x, (rect.width  + padX * 2) * dpr);
  const h = Math.min(imgHeight - y, (rect.height + padY * 2) * dpr);

  const highlightX = (rect.left * dpr) - x;
  const highlightY = (rect.top  * dpr) - y;
  const highlightW = rect.width  * dpr;
  const highlightH = rect.height * dpr;

  const radius = Math.min(8 * dpr, highlightW / 4, highlightH / 4);
  const dashPattern = [8 * dpr, 5 * dpr];

  return { padX, padY, x, y, w, h, highlightX, highlightY, highlightW, highlightH, radius, dashPattern };
}

test('crop geometry: applies proportional PAD_RATIO = 0.3 with min 24px clamp', () => {
  // Standard button (100x40): padX = 30, padY = 24 (clamped from 12)
  const geomBtn = calculateCropGeometry({ left: 200, top: 150, width: 100, height: 40 }, 80, 1, 1920, 1080);
  assert.strictEqual(geomBtn.padX, 30);
  assert.strictEqual(geomBtn.padY, 24);

  // Small icon (16x16): both clamped to 24px
  const geomIcon = calculateCropGeometry({ left: 50, top: 50, width: 16, height: 16 }, 80, 1, 1920, 1080);
  assert.strictEqual(geomIcon.padX, 24);
  assert.strictEqual(geomIcon.padY, 24);

  // Wide banner (600x150): padX = 180, padY = 45
  const geomBanner = calculateCropGeometry({ left: 100, top: 100, width: 600, height: 150 }, 80, 1, 1920, 1080);
  assert.strictEqual(geomBanner.padX, 180);
  assert.strictEqual(geomBanner.padY, 45);
});

test('crop geometry: element_crop (padding = 0) removes padding entirely', () => {
  const geom = calculateCropGeometry({ left: 100, top: 80, width: 120, height: 50 }, 0, 1, 1920, 1080);
  assert.strictEqual(geom.padX, 0);
  assert.strictEqual(geom.padY, 0);
  assert.strictEqual(geom.w, 120);
  assert.strictEqual(geom.h, 50);
  assert.strictEqual(geom.highlightX, 0);
  assert.strictEqual(geom.highlightY, 0);
});

test('crop geometry: correctly scales coordinates and line dashes for Retina DPR', () => {
  const rect = { left: 100, top: 100, width: 100, height: 50 };
  const dpr1 = calculateCropGeometry(rect, 80, 1, 1920, 1080);
  const dpr2 = calculateCropGeometry(rect, 80, 2, 3840, 2160);

  // Dash pattern scales with DPR
  assert.deepStrictEqual(dpr1.dashPattern, [8, 5]);
  assert.deepStrictEqual(dpr2.dashPattern, [16, 10]);

  // Dimensions scale with DPR
  assert.strictEqual(dpr2.w, dpr1.w * 2);
  assert.strictEqual(dpr2.h, dpr1.h * 2);
});

test('crop geometry: clamps coordinates to 0 when near viewport edges', () => {
  // Element is at x=10, padX=30 -> without clamp left would be -20
  const rect = { left: 10, top: 5, width: 100, height: 40 };
  const geom = calculateCropGeometry(rect, 80, 1, 1920, 1080);

  assert.strictEqual(geom.x, 0);
  assert.strictEqual(geom.y, 0);
  // Highlight offset inside canvas shifts to actual left position
  assert.strictEqual(geom.highlightX, 10);
  assert.strictEqual(geom.highlightY, 5);
});

test('crop geometry: corner radius adapts to element dimensions', () => {
  // Large button: radius is full 8 * dpr = 8
  const large = calculateCropGeometry({ left: 100, top: 100, width: 200, height: 80 }, 80, 1, 1920, 1080);
  assert.strictEqual(large.radius, 8);

  // Tiny element (12x12): radius is clamped to min(8, 12/4, 12/4) = 3
  const tiny = calculateCropGeometry({ left: 100, top: 100, width: 12, height: 12 }, 80, 1, 1920, 1080);
  assert.strictEqual(tiny.radius, 3);
});
