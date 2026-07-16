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

interface OffSeg {
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
  dStart: Point;
  dEnd: Point;
  jointStart: Point;
  jointEnd: Point;
}

const unit = (a: Point, b: Point): Point | null => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  return l < 1e-9 ? null : [dx / l, dy / l];
};

function lineIntersect(a: Point, ad: Point, b: Point, bd: Point): Point | null {
  const det = ad[0] * bd[1] - ad[1] * bd[0];
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b[0] - a[0]) * bd[1] - (b[1] - a[1]) * bd[0]) / det;
  return [a[0] + ad[0] * t, a[1] + ad[1] * t];
}

function offsetSeg(s: Seg, d: number): OffSeg {
  const p0: Point = [s.ax, s.ay];
  const p1: Point = [s.c1x, s.c1y];
  const p2: Point = [s.c2x, s.c2y];
  const p3: Point = [s.bx, s.by];
  const d1 = unit(p0, p1) ?? unit(p0, p2) ?? unit(p0, p3) ?? [1, 0];
  const d2 = unit(p1, p2) ?? d1;
  const d3 = unit(p2, p3) ?? d2;
  const n1: Point = [d1[1] * d, -d1[0] * d];
  const n2: Point = [d2[1] * d, -d2[0] * d];
  const n3: Point = [d3[1] * d, -d3[0] * d];
  const q0: Point = [p0[0] + n1[0], p0[1] + n1[1]];
  const q3: Point = [p3[0] + n3[0], p3[1] + n3[1]];
  const q1 =
    lineIntersect(q0, d1, [p1[0] + n2[0], p1[1] + n2[1]], d2) ??
    ([p1[0] + (n1[0] + n2[0]) / 2, p1[1] + (n1[1] + n2[1]) / 2] as Point);
  const q2 =
    lineIntersect([p1[0] + n2[0], p1[1] + n2[1]], d2, q3, d3) ??
    ([p2[0] + (n2[0] + n3[0]) / 2, p2[1] + (n2[1] + n3[1]) / 2] as Point);
  return { p0: q0, c1: q1, c2: q2, p3: q3, dStart: d1, dEnd: d3, jointStart: p0, jointEnd: p3 };
}

export function offsetPath(p: PathData, amount: number, miterLimit: number, join = 2): PathData {
  if (!amount || p.v.length < 2) return p;
  const segs = segmentsOf(p);
  if (!segs.length) return p;

  const off: OffSeg[] = [];
  for (const s of segs) {
    const curved = s.c1x !== s.ax || s.c1y !== s.ay || s.c2x !== s.bx || s.c2y !== s.by;
    if (curved) {
      off.push(offsetSeg(subSeg(s, 0, 0.5), amount), offsetSeg(subSeg(s, 0.5, 1), amount));
    } else {
      off.push(offsetSeg(s, amount));
    }
  }

  const v: Point[] = [];
  const i: Point[] = [];
  const o: Point[] = [];
  const push = (pt: Point, inn: Point, out: Point): void => {
    v.push(pt);
    i.push(inn);
    o.push(out);
  };

  const r = Math.abs(amount);
  const maxMiter = Math.max(1, miterLimit || 4) * r;
  let carryIn: Point = [0, 0];
  let firstIn: Point | null = null;

  for (let idx = 0; idx < off.length; idx++) {
    const seg = off[idx];
    push(seg.p0, carryIn, [seg.c1[0] - seg.p0[0], seg.c1[1] - seg.p0[1]]);
    carryIn = [0, 0];

    const wrap = idx === off.length - 1;
    const next = wrap ? (p.c ? off[0] : null) : off[idx + 1];
    let endOut: Point = [0, 0];
    let miterPt: Point | null = null;

    if (next) {
      const joint = seg.jointEnd;
      const gap = Math.hypot(next.p0[0] - seg.p3[0], next.p0[1] - seg.p3[1]);
      if (gap > 1e-6) {
        if (join === 2) {
          const a0 = Math.atan2(seg.p3[1] - joint[1], seg.p3[0] - joint[0]);
          const a1 = Math.atan2(next.p0[1] - joint[1], next.p0[0] - joint[0]);
          let sweep = a1 - a0;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          while (sweep < -Math.PI) sweep += 2 * Math.PI;
          const k = (4 / 3) * Math.tan(sweep / 4) * r;
          endOut = [-Math.sin(a0) * k, Math.cos(a0) * k];
          const inHandle: Point = [Math.sin(a1) * k, -Math.cos(a1) * k];
          if (wrap) firstIn = inHandle;
          else carryIn = inHandle;
        } else if (join === 1) {
          const m = lineIntersect(seg.p3, seg.dEnd, next.p0, next.dStart);
          if (m && Math.hypot(m[0] - joint[0], m[1] - joint[1]) <= maxMiter) miterPt = m;
        }
      }
    }

    push(seg.p3, [seg.c2[0] - seg.p3[0], seg.c2[1] - seg.p3[1]], endOut);
    if (miterPt) push(miterPt, [0, 0], [0, 0]);
  }

  if (firstIn) i[0] = firstIn;
  return { c: p.c, v, i, o };
}

export interface PathSampler {
  length: number;
  at(d: number): { x: number; y: number; angle: number };
}

export function pathSampler(p: PathData): PathSampler | null {
  const segs = segmentsOf(p);
  if (!segs.length) return null;
  const L = totalLen(segs);
  return {
    length: L,
    at(d: number) {
      let pos = 0;
      let clamped = Math.min(Math.max(d, 0), L);
      for (let j = 0; j < segs.length; j++) {
        const s = segs[j];
        if (clamped <= pos + s.len || j === segs.length - 1) {
          const t = tAtLength(s, Math.min(Math.max(clamped - pos, 0), s.len));
          const [x, y] = pointAt(s, t);
          const [tx, ty] = tangentAt(s, t);
          return { x, y, angle: Math.atan2(ty, tx) };
        }
        pos += s.len;
      }
      return { x: segs[0].ax, y: segs[0].ay, angle: 0 };
    },
  };
}

export function signedArea(p: PathData): number {
  let area = 0;
  const n = p.v.length;
  for (let j = 0; j < n; j++) {
    const a = p.v[j];
    const b = p.v[(j + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}
