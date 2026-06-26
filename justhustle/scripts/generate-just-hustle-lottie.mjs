/**
 * Generates Just Hustle handwriting Lottie (hello-apple stroke-draw style).
 * Output: src/assets/just-hustle.lottie.json
 */
import { writeFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import https from 'https';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const FONT_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/sacramento@5.2.5/latin-400-normal.ttf';
const OUT_PUBLIC = 'public/animations/just-hustle.json';
const OUT_SRC = 'src/assets/just-hustle.json';
const text = 'justhustle.in';
const fontSize = 96;
const COMP_W = 640;
const COMP_H = 160;
const FPS = 60;
const DURATION = 150;
const STROKE = 2.8;
const STROKE_COLOR = [0.973, 0.98, 0.988, 1];
const ease = { x: [0.42, 0], y: [0.58, 1] };

function fetchFont(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function commandsToLottiePath(commands) {
  const v = [];
  const i = [];
  const o = [];
  let current = [0, 0];

  const addVertex = (x, y, inPt = [0, 0], outPt = [0, 0]) => {
    v.push([x, y]);
    i.push(inPt);
    o.push(outPt);
    current = [x, y];
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        addVertex(cmd.x, cmd.y);
        break;
      case 'L':
        addVertex(cmd.x, cmd.y);
        break;
      case 'Q': {
        const cp = [cmd.x1, cmd.y1];
        const end = [cmd.x, cmd.y];
        const outTan = [(cp[0] - current[0]) * (2 / 3), (cp[1] - current[1]) * (2 / 3)];
        if (v.length > 0) o[o.length - 1] = outTan;
        addVertex(
          end[0],
          end[1],
          [(cp[0] - end[0]) * (2 / 3), (cp[1] - end[1]) * (2 / 3)],
          [0, 0],
        );
        break;
      }
      case 'C': {
        const cp1 = [cmd.x1, cmd.y1];
        const cp2 = [cmd.x2, cmd.y2];
        const end = [cmd.x, cmd.y];
        if (v.length > 0) o[o.length - 1] = [cp1[0] - current[0], cp1[1] - current[1]];
        addVertex(end[0], end[1], [cp2[0] - end[0], cp2[1] - end[1]], [0, 0]);
        break;
      }
      default:
        break;
    }
  }

  return { i, o, v, c: false };
}

function fitToComp(shapePath) {
  const xs = shapePath.v.map((p) => p[0]);
  const ys = shapePath.v.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const scale = Math.min((COMP_W - 48) / contentW, (COMP_H - 40) / contentH);
  const shiftX = (COMP_W - contentW * scale) / 2 - minX * scale;
  const shiftY = (COMP_H - contentH * scale) / 2 - minY * scale;

  shapePath.v = shapePath.v.map(([x, y]) => [x * scale + shiftX, y * scale + shiftY]);
  shapePath.i = shapePath.i.map(([x, y]) => [x * scale, y * scale]);
  shapePath.o = shapePath.o.map(([x, y]) => [x * scale, y * scale]);
}

const buffer = await fetchFont(FONT_URL);
const font = opentype.parse(buffer);
const raw = font.getPath(text, 0, 0, fontSize);
const bbox = raw.getBoundingBox();
const pad = 8;
const path = font.getPath(text, pad - bbox.x1, pad - bbox.y1, fontSize);
const shapePath = commandsToLottiePath(path.commands);
fitToComp(shapePath);

const lottie = {
  v: '5.7.0',
  fr: FPS,
  ip: 0,
  op: DURATION,
  w: COMP_W,
  h: COMP_H,
  nm: 'Just Hustle Draw',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'Just Hustle Stroke',
      sr: 1,
      ip: 0,
      op: DURATION,
      st: 0,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [0, 0, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      shapes: [
        {
          ty: 'gr',
          nm: 'stroke-group',
          it: [
            { ty: 'sh', nm: 'Path', ks: { a: 0, k: shapePath } },
            {
              ty: 'st',
              c: { a: 0, k: STROKE_COLOR },
              o: { a: 0, k: 100 },
              w: { a: 0, k: STROKE },
              lc: 2,
              lj: 2,
              ml: 4,
            },
            {
              ty: 'tm',
              s: { a: 0, k: 0 },
              e: {
                a: 1,
                k: [
                  { t: 10, s: [0], h: 0 },
                  { t: 120, s: [100], i: ease, o: ease, h: 0 },
                  { t: DURATION, s: [100], h: 0 },
                ],
              },
              o: { a: 0, k: 0 },
              m: 1,
            },
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
          ],
        },
      ],
    },
  ],
};

mkdirSync('public/animations', { recursive: true });
mkdirSync('src/assets', { recursive: true });
const payload = JSON.stringify(lottie);
writeFileSync(OUT_PUBLIC, payload);
writeFileSync(OUT_SRC, payload);
console.log(`Wrote ${OUT_PUBLIC} (${(payload.length / 1024).toFixed(1)} KB)`);
