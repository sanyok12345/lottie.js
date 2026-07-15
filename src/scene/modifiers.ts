import type { PathData, Point } from '../ir.js';

interface Seg {
  ax: number; ay: number;
  c1x: number; c1y: number;
  c2x: number; c2y: number;
  bx: number; by: number;
  len: number;
  table: number[];
}

const SAMPLES = 16;

function makeSeg(
  ax: number, ay: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  bx: number, by: number
): Seg {
  const table: number[] = [0];
  let px = ax;
  let py = ay;
  let len = 0;
  for (let k = 1; k <= SAMPLES; k++) {
    const t = k / SAMPLES;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    const x = w0 * ax + w1 * c1x + w2 * c2x + w3 * bx;
    const y = w0 * ay + w1 * c1y + w2 * c2y + w3 * by;
    len += Math.hypot(x - px, y - py);
    table.push(len);
    px = x;
    py = y;
  }
  return { ax, ay, c1x, c1y, c2x, c2y, bx, by, len, table };
}

function segmentsOf(p: PathData): Seg[] {
  const n = p.v.length;
  const count = p.c ? n : n - 1;
  const segs: Seg[] = [];
  for (let j = 0; j < count; j++) {
    const k = (j + 1) % n;
    const a = p.v[j];
    const b = p.v[k];
    const o = p.o?.[j] ?? [0, 0];
    const i = p.i?.[k] ?? [0, 0];
    segs.push(
      makeSeg(
        a[0], a[1],
        a[0] + (o[0] ?? 0), a[1] + (o[1] ?? 0),
        b[0] + (i[0] ?? 0), b[1] + (i[1] ?? 0),
        b[0], b[1]
      )
    );
  }
  return segs;
}

function segsToPath(segs: Seg[], closed: boolean): PathData {
  const v: Point[] = [[segs[0].ax, segs[0].ay]];
  const i: Point[] = [[0, 0]];
  const o: Point[] = [];
  for (let j = 0; j < segs.length; j++) {
    const s = segs[j];
    o.push([s.c1x - s.ax, s.c1y - s.ay]);
    if (closed && j === segs.length - 1) {
      i[0] = [s.c2x - s.bx, s.c2y - s.by];
    } else {
      v.push([s.bx, s.by]);
      i.push([s.c2x - s.bx, s.c2y - s.by]);
    }
  }
  if (!closed) o.push([0, 0]);
  return { c: closed, v, i, o };
}

function tAtLength(seg: Seg, target: number): number {
  if (target <= 0) return 0;
  if (target >= seg.len) return 1;
  const table = seg.table;
  let lo = 0;
  let hi = SAMPLES;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = table[lo + 1] - table[lo];
  const f = span > 0 ? (target - table[lo]) / span : 0;
  return (lo + f) / SAMPLES;
}

function subSeg(s: Seg, t0: number, t1: number): Seg {
  const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = splitRange(
    s.ax, s.ay, s.c1x, s.c1y, s.c2x, s.c2y, s.bx, s.by, t0, t1
  );
  return makeSeg(ax, ay, c1x, c1y, c2x, c2y, bx, by);
}

function splitRange(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  t0: number, t1: number
): number[] {
  if (t0 > 0) {
    const r = splitAt(x0, y0, x1, y1, x2, y2, x3, y3, t0, false);
    [x0, y0, x1, y1, x2, y2, x3, y3] = r;
    t1 = (t1 - t0) / (1 - t0);
  }
  if (t1 < 1) {
    return splitAt(x0, y0, x1, y1, x2, y2, x3, y3, t1, true);
  }
  return [x0, y0, x1, y1, x2, y2, x3, y3];
}

function splitAt(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  t: number, left: boolean
): number[] {
  const ux = x0 + (x1 - x0) * t, uy = y0 + (y1 - y0) * t;
  const vx = x1 + (x2 - x1) * t, vy = y1 + (y2 - y1) * t;
  const wx = x2 + (x3 - x2) * t, wy = y2 + (y3 - y2) * t;
  const mx = ux + (vx - ux) * t, my = uy + (vy - uy) * t;
  const nx = vx + (wx - vx) * t, ny = vy + (wy - vy) * t;
  const px = mx + (nx - mx) * t, py = my + (ny - my) * t;
  return left ? [x0, y0, ux, uy, mx, my, px, py] : [px, py, nx, ny, wx, wy, x3, y3];
}

function cutSegs(segs: Seg[], from: number, to: number, wrap: boolean): Seg[] {
  const out: Seg[] = [];
  const rounds = wrap ? 2 : 1;
  let pos = 0;
  for (let r = 0; r < rounds && pos < to; r++) {
    for (const seg of segs) {
      const s0 = pos;
      const s1 = pos + seg.len;
      if (seg.len > 0 && s1 > from && s0 < to) {
        const t0 = from > s0 ? tAtLength(seg, from - s0) : 0;
        const t1 = to < s1 ? tAtLength(seg, to - s0) : 1;
        out.push(t0 > 0 || t1 < 1 ? subSeg(seg, t0, t1) : seg);
      }
      pos = s1;
      if (pos >= to) break;
    }
  }
  return out;
}

const totalLen = (segs: Seg[]): number => {
  let L = 0;
  for (const s of segs) L += s.len;
  return L;
};

export function trimPaths(
  paths: PathData[],
  s: number,
  e: number,
  off: number,
  simultaneous: boolean
): PathData[] {
  let lo = Math.max(0, Math.min(1, Math.min(s, e)));
  let hi = Math.max(0, Math.min(1, Math.max(s, e)));
  const span = hi - lo;
  if (span >= 1) return paths;
  if (span <= 0) return [];

  let a = lo + off;
  a -= Math.floor(a);
  const b = a + span;

  const entries = paths.map((p) => ({ segs: segmentsOf(p), closed: !!p.c }));

  if (!simultaneous || entries.length === 1) {
    const out: PathData[] = [];
    for (const ent of entries) out.push(...cutOne(ent.segs, ent.closed, a, b));
    return out;
  }

  const lens = entries.map((ent) => totalLen(ent.segs));
  const L = lens.reduce((x, y) => x + y, 0);
  if (!L) return [];
  const ivals: Array<[number, number]> = b <= 1 ? [[a, b]] : [[a, 1], [0, b - 1]];
  const out: PathData[] = [];
  let acc = 0;
  for (let idx = 0; idx < entries.length; idx++) {
    const ent = entries[idx];
    const gs = acc / L;
    const ge = (acc + lens[idx]) / L;
    acc += lens[idx];
    if (ge <= gs) continue;
    for (const [x, y] of ivals) {
      const o0 = Math.max(x, gs);
      const o1 = Math.min(y, ge);
      if (o1 <= o0) continue;
      const from = ((o0 - gs) / (ge - gs)) * lens[idx];
      const to = ((o1 - gs) / (ge - gs)) * lens[idx];
      const cutted = cutSegs(ent.segs, from, to, false);
      if (cutted.length) out.push(segsToPath(cutted, false));
    }
  }
  return out;
}

function cutOne(segs: Seg[], closed: boolean, a: number, b: number): PathData[] {
  const L = totalLen(segs);
  if (!L) return [];
  const from = a * L;
  const to = b * L;
  if (closed) {
    const cutted = cutSegs(segs, from, to, to > L);
    return cutted.length ? [segsToPath(cutted, false)] : [];
  }
  const out: PathData[] = [];
  const first = cutSegs(segs, from, Math.min(to, L), false);
  if (first.length) out.push(segsToPath(first, false));
  if (to > L) {
    const second = cutSegs(segs, 0, to - L, false);
    if (second.length) out.push(segsToPath(second, false));
  }
  return out;
}

const ROUND_HANDLE = 0.5519;

export function roundCorners(p: PathData, r: number): PathData {
  if (r <= 0 || p.v.length < 3) return p;
  const n = p.v.length;
  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  for (let j = 0; j < n; j++) {
    const iT = p.i?.[j] ?? [0, 0];
    const oT = p.o?.[j] ?? [0, 0];
    const corner = !iT[0] && !iT[1] && !oT[0] && !oT[1];
    const interior = p.c || (j > 0 && j < n - 1);
    if (!corner || !interior) {
      v.push(p.v[j]);
      i.push(iT);
      o.push(oT);
      continue;
    }
    const cur = p.v[j];
    const prev = p.v[(j - 1 + n) % n];
    const next = p.v[(j + 1) % n];
    const dPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const dNext = Math.hypot(cur[0] - next[0], cur[1] - next[1]);
    const fPrev = dPrev ? Math.min(dPrev / 2, r) / dPrev : 0;
    const fNext = dNext ? Math.min(dNext / 2, r) / dNext : 0;
    const A: Point = [cur[0] + (prev[0] - cur[0]) * fPrev, cur[1] + (prev[1] - cur[1]) * fPrev];
    const B: Point = [cur[0] + (next[0] - cur[0]) * fNext, cur[1] + (next[1] - cur[1]) * fNext];
    v.push(A);
    i.push([0, 0]);
    o.push([(cur[0] - A[0]) * ROUND_HANDLE, (cur[1] - A[1]) * ROUND_HANDLE]);
    v.push(B);
    i.push([(cur[0] - B[0]) * ROUND_HANDLE, (cur[1] - B[1]) * ROUND_HANDLE]);
    o.push([0, 0]);
  }
  return { c: p.c, v, i, o };
}

export function zigZag(p: PathData, amp: number, ridges: number, smooth: boolean): PathData {
  const segs = segmentsOf(p);
  if (!segs.length || ridges < 1 || !amp) return p;
  const per = Math.max(1, Math.round(ridges));
  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  let dir = 1;

  const pushPt = (x: number, y: number, tx: number, ty: number, tlen: number): void => {
    v.push([x, y]);
    if (smooth && tlen > 0) {
      i.push([-tx * tlen, -ty * tlen]);
      o.push([tx * tlen, ty * tlen]);
    } else {
      i.push([0, 0]);
      o.push([0, 0]);
    }
  };

  for (let sIdx = 0; sIdx < segs.length; sIdx++) {
    const s = segs[sIdx];
    const step = s.len / (per + 1);
    const tlen = (step / 2) * 0.5;
    if (sIdx === 0 || !p.c) {
      if (sIdx === 0) {
        const [tx, ty] = tangentAt(s, 0);
        pushPt(s.ax, s.ay, tx, ty, tlen);
      }
    }
    for (let k = 1; k <= per; k++) {
      const t = tAtLength(s, step * k);
      const [px, py] = pointAt(s, t);
      const [tx, ty] = tangentAt(s, t);
      const nx = -ty * amp * dir;
      const ny = tx * amp * dir;
      pushPt(px + nx, py + ny, tx, ty, tlen);
      dir = -dir;
    }
    if (!(p.c && sIdx === segs.length - 1)) {
      const [tx, ty] = tangentAt(s, 1);
      pushPt(s.bx, s.by, tx, ty, tlen);
    }
  }
  return { c: p.c, v, i, o };
}

function pointAt(s: Seg, t: number): [number, number] {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * s.ax + w1 * s.c1x + w2 * s.c2x + w3 * s.bx,
    w0 * s.ay + w1 * s.c1y + w2 * s.c2y + w3 * s.by,
  ];
}

function tangentAt(s: Seg, t: number): [number, number] {
  const u = 1 - t;
  let dx =
    3 * u * u * (s.c1x - s.ax) + 6 * u * t * (s.c2x - s.c1x) + 3 * t * t * (s.bx - s.c2x);
  let dy =
    3 * u * u * (s.c1y - s.ay) + 6 * u * t * (s.c2y - s.c1y) + 3 * t * t * (s.by - s.c2y);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

export function puckerBloat(p: PathData, amount: number): PathData {
  const n = p.v.length;
  if (!n || !amount) return p;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of p.v) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const kv = 1 - amount / 100;
  const kh = 1 + amount / 100;
  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  for (let j = 0; j < n; j++) {
    const pt = p.v[j];
    const iT = p.i?.[j] ?? [0, 0];
    const oT = p.o?.[j] ?? [0, 0];
    const nvx = cx + (pt[0] - cx) * kv;
    const nvy = cy + (pt[1] - cy) * kv;
    const iax = cx + (pt[0] + iT[0] - cx) * kh;
    const iay = cy + (pt[1] + iT[1] - cy) * kh;
    const oax = cx + (pt[0] + oT[0] - cx) * kh;
    const oay = cy + (pt[1] + oT[1] - cy) * kh;
    v.push([nvx, nvy]);
    i.push([iax - nvx, iay - nvy]);
    o.push([oax - nvx, oay - nvy]);
  }
  return { c: p.c, v, i, o };
}

export function twist(p: PathData, angleDeg: number, center: Point): PathData {
  const n = p.v.length;
  if (!n || !angleDeg) return p;
  const cx = center[0] ?? 0;
  const cy = center[1] ?? 0;
  let maxD = 0;
  for (const pt of p.v) {
    const d = Math.hypot(pt[0] - cx, pt[1] - cy);
    if (d > maxD) maxD = d;
  }
  if (!maxD) return p;
  const rot = (x: number, y: number): [number, number] => {
    const d = Math.hypot(x - cx, y - cy);
    const theta = ((angleDeg * Math.PI) / 180) * (1 - Math.min(1, d / maxD));
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  for (let j = 0; j < n; j++) {
    const pt = p.v[j];
    const iT = p.i?.[j] ?? [0, 0];
    const oT = p.o?.[j] ?? [0, 0];
    const nv = rot(pt[0], pt[1]);
    const ni = rot(pt[0] + iT[0], pt[1] + iT[1]);
    const no = rot(pt[0] + oT[0], pt[1] + oT[1]);
    v.push([nv[0], nv[1]]);
    i.push([ni[0] - nv[0], ni[1] - nv[1]]);
    o.push([no[0] - nv[0], no[1] - nv[1]]);
  }
  return { c: p.c, v, i, o };
}

export function offsetPath(p: PathData, amount: number, miterLimit: number): PathData {
  const n = p.v.length;
  if (n < 2 || !amount) return p;
  const dirAt = (j: number, incoming: boolean): [number, number] => {
    const cur = p.v[j];
    const iT = p.i?.[j] ?? [0, 0];
    const oT = p.o?.[j] ?? [0, 0];
    if (incoming) {
      if (iT[0] || iT[1]) return norm(-iT[0], -iT[1]);
      const prev = p.v[(j - 1 + n) % n];
      const po = p.o?.[(j - 1 + n) % n] ?? [0, 0];
      if (po[0] || po[1]) {
        return norm(cur[0] - (prev[0] + po[0]), cur[1] - (prev[1] + po[1]));
      }
      return norm(cur[0] - prev[0], cur[1] - prev[1]);
    }
    if (oT[0] || oT[1]) return norm(oT[0], oT[1]);
    const next = p.v[(j + 1) % n];
    return norm(next[0] - cur[0], next[1] - cur[1]);
  };

  const maxLen = Math.abs(amount) * Math.max(1, miterLimit || 4);
  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  for (let j = 0; j < n; j++) {
    const first = !p.c && j === 0;
    const last = !p.c && j === n - 1;
    const din = first ? dirAt(j, false) : dirAt(j, true);
    const dout = last ? dirAt(j, true) : dirAt(j, false);
    let bx = din[0] + dout[0];
    let by = din[1] + dout[1];
    const bl = Math.hypot(bx, by);
    let nx: number;
    let ny: number;
    if (bl < 1e-6) {
      nx = -din[1];
      ny = din[0];
    } else {
      bx /= bl;
      by /= bl;
      nx = -by;
      ny = bx;
      const cosHalf = Math.max(0.1, nx * -din[1] + ny * din[0]);
      const scale = Math.min(1 / cosHalf, maxLen / Math.abs(amount));
      nx *= scale;
      ny *= scale;
    }
    const off: Point = [nx * amount, ny * amount];
    v.push([p.v[j][0] + off[0], p.v[j][1] + off[1]]);
    i.push(p.i?.[j] ?? [0, 0]);
    o.push(p.o?.[j] ?? [0, 0]);
  }
  return { c: p.c, v, i, o };
}

function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}
