/**
 * Recreates the LottieFiles "hello apple" stroke-draw effect using Apple's SF-Hello SVG paths.
 * Output: src/assets/hello-apple.lottie.json
 */
import { readFileSync, writeFileSync } from 'fs';
import svgPathParser from 'svg-path-parser';
const { parseSVG, makeAbsolute } = svgPathParser;

const SVG_PATH = 'assets/hello-en.svg';
const OUT_PATH = 'src/assets/hello-apple.json';

const COMP_W = 640;
const COMP_H = 180;
const FPS = 60;
const DURATION = 150;
const STROKE = 2.8;
const STROKE_COLOR = [0.973, 0.98, 0.988, 1];
const ease = { x: [0.42, 0], y: [0.58, 1] };

function extractPaths(svg) {
  const matches = [...svg.matchAll(/<path d="([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

function cubicToLottie(p0, p1, p2, p3, v, i, o) {
  if (v.length === 0) {
    v.push([p0.x, p0.y]);
    i.push([0, 0]);
    o.push([0, 0]);
  }

  const prev = { x: v[v.length - 1][0], y: v[v.length - 1][1] };
  o[o.length - 1] = [(p1.x - prev.x) * (2 / 3), (p1.y - prev.y) * (2 / 3)];
  v.push([p3.x, p3.y]);
  i.push([(p2.x - p3.x) * (2 / 3), (p2.y - p3.y) * (2 / 3)]);
  o.push([0, 0]);
}

function svgPathToLottie(d, transform) {
  const commands = makeAbsolute(parseSVG(d));
  const v = [];
  const i = [];
  const o = [];
  let current = { x: 0, y: 0 };

  const map = (x, y) => {
    const ty = 728.156 - y;
    return {
      x: x * transform.scale + transform.padX,
      y: ty * transform.scale + transform.padY,
    };
  };

  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M': {
        const p = map(cmd.x, cmd.y);
        current = p;
        v.push([p.x, p.y]);
        i.push([0, 0]);
        o.push([0, 0]);
        break;
      }
      case 'L': {
        const p = map(cmd.x, cmd.y);
        current = p;
        v.push([p.x, p.y]);
        i.push([0, 0]);
        o.push([0, 0]);
        break;
      }
      case 'C': {
        const p0 = current;
        const p1 = map(cmd.x1, cmd.y1);
        const p2 = map(cmd.x2, cmd.y2);
        const p3 = map(cmd.x, cmd.y);
        cubicToLottie(p0, p1, p2, p3, v, i, o);
        current = p3;
        break;
      }
      default:
        break;
    }
  }

  return { i, o, v, c: false };
}

function boundsFromPaths(paths, transform) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const d of paths) {
    const commands = makeAbsolute(parseSVG(d));
    for (const cmd of commands) {
      if ('x' in cmd && 'y' in cmd) {
        const p = mapPoint(cmd.x, cmd.y, transform);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if ('x1' in cmd) {
        for (const key of ['x1', 'x2']) {
          if (key in cmd) {
            const p = mapPoint(cmd[key], cmd[key.replace('x', 'y')], transform);
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
    }
  }

  return { minX, minY, maxX, maxY };
}

function mapPoint(x, y, transform) {
  return {
    x: (x + transform.offsetX) * transform.scale + transform.padX,
    y: (y + transform.offsetY) * transform.scale + transform.padY,
  };
}

function makeStrokeLayer(index, shapePath, startFrame, endFrame, name) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
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
        nm: `${name}-group`,
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
                { t: startFrame, s: [0], h: 0 },
                { t: endFrame, s: [100], i: ease, o: ease, h: 0 },
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
  };
}

const svg = readFileSync(SVG_PATH, 'utf8');
const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
const [, , , vbW, vbH] = viewBoxMatch[1].split(/\s+/).map(Number);

// SF-Hello SVG uses scale(1,-1) translate(0,-728.156) — paths are in that space.
const pathStrings = extractPaths(svg);
const rawTransform = {
  scale: 0.085,
  padX: 32,
  padY: 24,
};

const lottiePaths = pathStrings.map((d) => svgPathToLottie(d, rawTransform));

const allPoints = lottiePaths.flatMap((p) => p.v);
const xs = allPoints.map((p) => p[0]);
const ys = allPoints.map((p) => p[1]);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);

const contentW = maxX - minX;
const contentH = maxY - minY;
const scale = Math.min((COMP_W - 64) / contentW, (COMP_H - 48) / contentH);
const shiftX = (COMP_W - contentW * scale) / 2 - minX * scale;
const shiftY = (COMP_H - contentH * scale) / 2 - minY * scale;

for (const shape of lottiePaths) {
  shape.v = shape.v.map(([x, y]) => [x * scale + shiftX, y * scale + shiftY]);
  shape.i = shape.i.map(([x, y]) => [x * scale, y * scale]);
  shape.o = shape.o.map(([x, y]) => [x * scale, y * scale]);
}

const layers = lottiePaths.map((shapePath, idx) => {
  const start = 8 + idx * 28;
  const end = start + 72;
  return makeStrokeLayer(idx + 1, shapePath, start, end, idx === 0 ? 'hello-h' : 'hello-rest');
});

const lottie = {
  v: '5.7.0',
  fr: FPS,
  ip: 0,
  op: DURATION,
  w: COMP_W,
  h: COMP_H,
  nm: 'Hello Apple Draw',
  ddd: 0,
  assets: [],
  layers: layers.reverse(),
};

writeFileSync(OUT_PATH, JSON.stringify(lottie));
console.log(`Wrote ${OUT_PATH} (${(JSON.stringify(lottie).length / 1024).toFixed(1)} KB)`);
