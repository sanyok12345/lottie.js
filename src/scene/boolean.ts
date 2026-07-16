import type { PathData, Point } from '../ir.js';

interface GHV {
  x: number;
  y: number;
  next: GHV | null;
  prev: GHV | null;
  intersect: boolean;
  entry: boolean;
  neighbor: GHV | null;
  alpha: number;
  visited: boolean;
}

const CURVE_STEPS = 24;
const EPS = 1e-9;
const DEGEN = 1e-6;

function flatten(p: PathData): Point[] {
  const v = p.v;
  const n = v.length;
  if (n < 3) return [];
  const inT = p.i ?? [];
  const outT = p.o ?? [];
  const pts: Point[] = [[v[0][0], v[0][1]]];
  for (let j = 1; j <= n; j++) {
    const k = j % n;
    if (!p.c && j === n) break;
    const a = v[j - 1];
    const b = v[k];
    const o = outT[j - 1] ?? [0, 0];
    const i = inT[k] ?? [0, 0];
    if (!o[0] && !o[1] && !i[0] && !i[1]) {
      pts.push([b[0], b[1]]);
    } else {
      const x0 = a[0], y0 = a[1];
      const x1 = a[0] + o[0], y1 = a[1] + o[1];
      const x3 = b[0], y3 = b[1];
      const x2 = b[0] + i[0], y2 = b[1] + i[1];
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS;
        const u = 1 - t;
        const w0 = u * u * u;
        const w1 = 3 * u * u * t;
        const w2 = 3 * u * t * t;
        const w3 = t * t * t;
        pts.push([
          w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3,
          w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3,
        ]);
      }
    }
  }
  while (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) < EPS && Math.abs(first[1] - last[1]) < EPS) pts.pop();
    else break;
  }
  return pts.length >= 3 ? pts : [];
}

function ring(points: Point[]): GHV {
  let first: GHV | null = null;
  let prev: GHV | null = null;
  for (const [x, y] of points) {
    const v: GHV = {
      x, y, next: null, prev: null,
      intersect: false, entry: false, neighbor: null, alpha: 0, visited: false,
    };
    if (!first) first = v;
    if (prev) {
      prev.next = v;
      v.prev = prev;
    }
    prev = v;
  }
  first!.prev = prev;
  prev!.next = first;
  return first!;
}

function pointInPoly(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nextNonIntersect(v: GHV): GHV {
  let c = v;
  while (c.intersect) c = c.next!;
  return c;
}

function insertBetween(start: GHV, v: GHV): void {
  let c = start.next!;
  while (c.intersect && c.alpha < v.alpha) c = c.next!;
  v.next = c;
  v.prev = c.prev;
  c.prev!.next = v;
  c.prev = v;
}

function buildIntersections(sRing: GHV, cRing: GHV): { count: number; degenerate: boolean } {
  let count = 0;
  let degenerate = false;
  let s = sRing;
  do {
    if (!s.intersect) {
      const sEnd = nextNonIntersect(s.next!);
      let c = cRing;
      do {
        if (!c.intersect) {
          const cEnd = nextNonIntersect(c.next!);
          const den = (cEnd.y - c.y) * (sEnd.x - s.x) - (cEnd.x - c.x) * (sEnd.y - s.y);
          if (Math.abs(den) > EPS) {
            const ua = ((cEnd.x - c.x) * (s.y - c.y) - (cEnd.y - c.y) * (s.x - c.x)) / den;
            const ub = ((sEnd.x - s.x) * (s.y - c.y) - (sEnd.y - s.y) * (s.x - c.x)) / den;
            if (ua > -DEGEN && ua < 1 + DEGEN && ub > -DEGEN && ub < 1 + DEGEN) {
              if (ua < DEGEN || ua > 1 - DEGEN || ub < DEGEN || ub > 1 - DEGEN) {
                degenerate = true;
              } else {
                const x = s.x + ua * (sEnd.x - s.x);
                const y = s.y + ua * (sEnd.y - s.y);
                const vs: GHV = { x, y, next: null, prev: null, intersect: true, entry: false, neighbor: null, alpha: ua, visited: false };
                const vc: GHV = { x, y, next: null, prev: null, intersect: true, entry: false, neighbor: null, alpha: ub, visited: false };
                vs.neighbor = vc;
                vc.neighbor = vs;
                insertBetween(s, vs);
                insertBetween(c, vc);
                count++;
              }
            }
          }
        }
        c = nextNonIntersect(c.next!);
      } while (c !== cRing);
    }
    s = nextNonIntersect(s.next!);
  } while (s !== sRing);
  return { count, degenerate };
}

function markEntries(start: GHV, other: Point[], invert: boolean): void {
  let inside = pointInPoly(start.x, start.y, other);
  let v = start;
  do {
    if (v.intersect) {
      v.entry = invert ? inside : !inside;
      inside = !inside;
    }
    v = v.next!;
  } while (v !== start);
}

function trace(sRing: GHV, maxPoints: number): Point[][] | null {
  const out: Point[][] = [];
  for (;;) {
    let start: GHV | null = null;
    let v = sRing;
    do {
      if (v.intersect && !v.visited) {
        start = v;
        break;
      }
      v = v.next!;
    } while (v !== sRing);
    if (!start) break;

    const poly: Point[] = [];
    let cur: GHV = start;
    let guard = 0;
    do {
      cur.visited = true;
      if (cur.neighbor) cur.neighbor.visited = true;
      if (cur.entry) {
        do {
          cur = cur.next!;
          poly.push([cur.x, cur.y]);
          if (++guard > maxPoints) return null;
        } while (!cur.intersect);
      } else {
        do {
          cur = cur.prev!;
          poly.push([cur.x, cur.y]);
          if (++guard > maxPoints) return null;
        } while (!cur.intersect);
      }
      cur = cur.neighbor!;
    } while (cur !== start && !cur.visited);
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
}

function reversePoly(poly: Point[]): Point[] {
  return poly.slice().reverse();
}

function clipPair(subject: Point[], clip: Point[], mode: 2 | 3 | 4): Point[][] | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cl = attempt === 0 ? clip : clip.map(([x, y]) => [x + 1.31e-4, y + 0.79e-4] as Point);
    const sRing = ring(subject);
    const cRing = ring(cl);
    const { count, degenerate } = buildIntersections(sRing, cRing);
    if (degenerate) continue;
    if (!count) {
      const sInC = pointInPoly(subject[0][0], subject[0][1], cl);
      const cInS = pointInPoly(cl[0][0], cl[0][1], subject);
      if (mode === 2) {
        if (sInC) return [cl];
        if (cInS) return [subject];
        return [subject, cl];
      }
      if (mode === 4) {
        if (sInC) return [subject];
        if (cInS) return [cl];
        return [];
      }
      if (sInC) return [];
      if (cInS) {
        return area(subject) * area(cl) > 0 ? [subject, reversePoly(cl)] : [subject, cl];
      }
      return [subject];
    }
    markEntries(sRing, cl, mode !== 4);
    markEntries(cRing, subject, mode === 3 ? false : mode !== 4);
    const res = trace(sRing, (subject.length + cl.length + count * 2) * 4);
    if (res) return res;
  }
  return null;
}

export function mergePathsBoolean(paths: PathData[], mode: 2 | 3 | 4): PathData[] | null {
  if (paths.length < 2) return null;
  const polys = paths.map(flatten);
  if (polys.some((p) => !p.length)) return null;

  let acc: Point[][] = [polys[0]];
  for (let i = 1; i < polys.length; i++) {
    const b = polys[i];
    if (mode === 2) {
      let merged = b;
      const rest: Point[][] = [];
      for (const a of acc) {
        const r = clipPair(a, merged, 2);
        if (r === null) return null;
        if (r.length === 1) merged = r[0];
        else if (r.length === 2 && r[1] === merged) rest.push(a);
        else {
          merged = r[0];
          for (let k = 1; k < r.length; k++) rest.push(r[k]);
        }
      }
      acc = [merged, ...rest];
    } else {
      const next: Point[][] = [];
      for (const a of acc) {
        const r = clipPair(a, b, mode);
        if (r === null) return null;
        next.push(...r);
      }
      acc = next;
    }
  }

  const out: PathData[] = [];
  for (const poly of acc) {
    if (poly.length < 3 || Math.abs(area(poly)) < 1e-6) continue;
    const z: Point = [0, 0];
    out.push({
      c: true,
      v: poly.map((pt) => [pt[0], pt[1]]),
      i: poly.map(() => z),
      o: poly.map(() => z),
    });
  }
  return out;
}
