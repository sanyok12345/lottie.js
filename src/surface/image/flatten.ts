import type { PathData } from '../../ir.js';

export type Ring = number[];

const CURVE_STEPS_MAX = 48;
let avgScaleCached = 1;

export function avgScale(m: number[]): number {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  avgScaleCached = Math.sqrt(det) || 1;
  return avgScaleCached;
}

export function flattenPath(path: PathData, m: number[], out: Ring[]): void {
  const v = path.v;
  if (!Array.isArray(v) || v.length < 2) return;
  const inT = path.i ?? [];
  const outT = path.o ?? [];
  const n = v.length;
  const ring: Ring = [];

  pushPoint(ring, v[0], m);
  for (let j = 1; j <= (path.c ? n : n - 1); j++) {
    const a = v[j - 1];
    const b = v[j % n];
    const ta = outT[j - 1] ?? [0, 0];
    const tb = inT[j % n] ?? [0, 0];
    flattenCubic(ring, a, ta, b, tb, m);
  }
  if (ring.length >= 4) out.push(ring);
}

function pushPoint(ring: Ring, p: number[], m: number[]): void {
  ring.push(m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]);
}

function flattenCubic(ring: Ring, a: number[], ta: number[], b: number[], tb: number[], m: number[]): void {
  const tax = ta[0] ?? 0;
  const tay = ta[1] ?? 0;
  const tbx = tb[0] ?? 0;
  const tby = tb[1] ?? 0;

  if (!tax && !tay && !tbx && !tby) {
    pushPoint(ring, b, m);
    return;
  }

  const x0 = a[0];
  const y0 = a[1];
  const x1 = x0 + tax;
  const y1 = y0 + tay;
  const x3 = b[0];
  const y3 = b[1];
  const x2 = x3 + tbx;
  const y2 = y3 + tby;

  const len =
    (Math.abs(x1 - x0) + Math.abs(y1 - y0) +
      Math.abs(x2 - x1) + Math.abs(y2 - y1) +
      Math.abs(x3 - x2) + Math.abs(y3 - y2)) * avgScaleCached;
  const steps = Math.min(CURVE_STEPS_MAX, Math.max(4, Math.ceil(len / 4)));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    const px = w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3;
    const py = w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3;
    ring.push(m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]);
  }
}

export function strokeRing(ring: Ring, halfW: number, cap: number, out: Ring[]): void {
  const n = ring.length / 2;
  if (n < 2 || halfW <= 0) return;

  for (let i = 0; i < n - 1; i++) {
    const x0 = ring[i * 2];
    const y0 = ring[i * 2 + 1];
    const x1 = ring[i * 2 + 2];
    const y1 = ring[i * 2 + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;
    out.push([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]);
  }

  const segs = Math.min(32, Math.max(8, Math.ceil(halfW * 2)));
  const from = cap === 1 ? 1 : 0;
  const to = cap === 1 ? n - 1 : n;
  for (let i = from; i < to; i++) {
    const cx = ring[i * 2];
    const cy = ring[i * 2 + 1];
    const disk: Ring = [];
    for (let k = segs - 1; k >= 0; k--) {
      const a = (k / segs) * Math.PI * 2;
      disk.push(cx + Math.cos(a) * halfW, cy + Math.sin(a) * halfW);
    }
    out.push(disk);
  }
}
