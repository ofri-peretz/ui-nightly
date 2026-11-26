// Perceptual per-pixel comparison (YIQ delta, the method pixelmatch popularised).
import { decodePng, encodePng } from './png.mjs';

const MAX_DELTA = 35215; // maximum possible YIQ delta

function blend(c, a) { return 255 + (c - 255) * a; }

function delta(a, b, i, j) {
  let r1 = a[i], g1 = a[i + 1], b1 = a[i + 2];
  let r2 = b[j], g2 = b[j + 1], b2 = b[j + 2];
  const a1 = a[i + 3], a2 = b[j + 3];
  if (r1 === r2 && g1 === g2 && b1 === b2 && a1 === a2) return 0;
  if (a1 < 255) { const f = a1 / 255; r1 = blend(r1, f); g1 = blend(g1, f); b1 = blend(b1, f); }
  if (a2 < 255) { const f = a2 / 255; r2 = blend(r2, f); g2 = blend(g2, f); b2 = blend(b2, f); }
  const y = (0.29889531 * (r1 - r2)) + (0.58662247 * (g1 - g2)) + (0.11448223 * (b1 - b2));
  const iq = (0.59597799 * (r1 - r2)) - (0.2741761 * (g1 - g2)) - (0.32180189 * (b1 - b2));
  const q = (0.21147017 * (r1 - r2)) - (0.52261711 * (g1 - g2)) + (0.31114694 * (b1 - b2));
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
}

/**
 * Compare two PNG buffers.
 * @returns {{same:boolean, sizeChanged:boolean, diffPixels:number, ratio:number, width:number, height:number,
 *            expected:{width:number,height:number}, diffPng?:Buffer}}
 */
export function comparePng(expectedBuf, actualBuf, { threshold = 0.1, wantImage = false } = {}) {
  const exp = decodePng(expectedBuf);
  const act = decodePng(actualBuf);
  const expected = { width: exp.width, height: exp.height };
  if (exp.width !== act.width || exp.height !== act.height) {
    return {
      same: false, sizeChanged: true, diffPixels: Math.max(exp.width * exp.height, act.width * act.height),
      ratio: 1, width: act.width, height: act.height, expected,
    };
  }
  const { width, height } = act;
  const max = MAX_DELTA * threshold * threshold;
  const out = wantImage ? Buffer.alloc(width * height * 4) : null;
  let diff = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const d = delta(exp.data, act.data, i, i);
    const bad = d > max;
    if (bad) diff++;
    if (out) {
      if (bad) { out[i] = 255; out[i + 1] = 0; out[i + 2] = 80; out[i + 3] = 255; }
      else { // faded copy of the actual pixel
        const g = 255 - (255 - (0.299 * act.data[i] + 0.587 * act.data[i + 1] + 0.114 * act.data[i + 2])) * 0.25;
        out[i] = out[i + 1] = out[i + 2] = g; out[i + 3] = 255;
      }
    }
  }
  const ratio = diff / (width * height || 1);
  return {
    same: diff === 0, sizeChanged: false, diffPixels: diff, ratio, width, height, expected,
    diffPng: out ? encodePng({ width, height, data: out }) : undefined,
  };
}

/** Pass/fail decision for a comparison given the effective tolerances. */
export function withinTolerance(result, { maxDiffPixels = 0, maxDiffPixelRatio = 0 }) {
  if (result.sizeChanged) return false;
  const allowed = Math.max(maxDiffPixels, maxDiffPixelRatio * result.width * result.height);
  return result.diffPixels <= allowed;
}
