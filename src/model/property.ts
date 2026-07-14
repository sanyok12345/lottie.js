import { cubicBezierEasing } from '../math/bezier.js';
import type { PathData, Point } from '../ir.js';
import type { Animatable, AnimValue, Keyframe } from './types.js';

type Easing = (x: number) => number;

export function evaluate(prop: Animatable | undefined, frame: number): any {
  if (prop == null) return undefined;
  if (prop.k === undefined) return undefined;
  if (!animated(prop)) return prop.k as AnimValue;
  return evaluateKeyframes(prop.k as Keyframe[], frame);
}

export const scalar = (v: AnimValue | undefined): number | undefined =>
  Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;

export function isStatic(prop: Animatable | undefined): boolean {
  return prop == null || prop.k === undefined || !animated(prop);
}

function animated(prop: Animatable): boolean {
  if (!Array.isArray(prop.k)) return false;
  const first = prop.k[0];
  return typeof first === 'object' && first !== null && typeof first.t === 'number';
}

function evaluateKeyframes(kfs: Keyframe[], frame: number): AnimValue | undefined {
  const last = kfs.length - 1;
  if (frame <= kfs[0].t) return keyValue(kfs, 0);
  if (frame >= kfs[last].t) return keyValue(kfs, last);

  let i = 0;
  while (i < last && kfs[i + 1].t <= frame) i++;
  const k0 = kfs[i];
  const k1 = kfs[i + 1];
  const v0 = keyValue(kfs, i);
  if (k0.h === 1) return v0;

  const v1 = k0.e !== undefined ? unwrap(k0.e) : keyValue(kfs, i + 1);
  if (v0 === undefined || v1 === undefined) return v0 ?? v1;

  const lin = (frame - k0.t) / (k1.t - k0.t);
  const t = easingFor(k0)(lin);
  return interpolate(v0, v1, t, k0);
}

function keyValue(kfs: Keyframe[], i: number): AnimValue | undefined {
  for (let j = i; j >= 0; j--) {
    if (j < i && kfs[j].e !== undefined) return unwrap(kfs[j].e);
    if (kfs[j].s !== undefined) return unwrap(kfs[j].s);
  }
  return undefined;
}

const isPath = (v: unknown): v is PathData =>
  v !== null && typeof v === 'object' && Array.isArray((v as PathData).v);

function unwrap(v: unknown): AnimValue {
  if (Array.isArray(v) && v.length === 1 && isPath(v[0])) return v[0];
  return v as AnimValue;
}

const easingCache = new WeakMap<Keyframe, Easing>();

function easingFor(kf: Keyframe): Easing {
  let fn = easingCache.get(kf);
  if (!fn) {
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const pick = (v: number | number[] | undefined, fallback: number): number => {
      const n = Array.isArray(v) ? v[0] : v;
      return typeof n === 'number' ? n : fallback;
    };
    fn = cubicBezierEasing(
      clamp01(pick(kf.o?.x, 1 / 3)),
      pick(kf.o?.y, 1 / 3),
      clamp01(pick(kf.i?.x, 2 / 3)),
      pick(kf.i?.y, 2 / 3)
    );
    easingCache.set(kf, fn);
  }
  return fn;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function interpolate(v0: AnimValue, v1: AnimValue, t: number, kf: Keyframe): AnimValue {
  if (typeof v0 === 'number') return lerp(v0, typeof v1 === 'number' ? v1 : v0, t);

  if (isPath(v0) && isPath(v1)) {
    return {
      c: v0.c,
      v: lerpPoints(v0.v, v1.v, t),
      i: lerpPoints(v0.i, v1.i, t),
      o: lerpPoints(v0.o, v1.o, t),
    };
  }

  if (Array.isArray(v0) && Array.isArray(v1)) {
    if (Array.isArray(kf.to) && Array.isArray(kf.ti) && v0.length >= 2) {
      return spatialBezier(v0, v1, kf.to, kf.ti, t);
    }
    return v0.map((a, idx) => lerp(a, v1[idx] ?? a, t));
  }

  return t < 1 ? v0 : v1;
}

function lerpPoints(p0: Point[] = [], p1: Point[] = [], t: number): Point[] {
  return p0.map((pt, i) => {
    const q = p1[i] ?? pt;
    return [lerp(pt[0] ?? 0, q[0] ?? 0, t), lerp(pt[1] ?? 0, q[1] ?? 0, t)];
  });
}

function spatialBezier(
  v0: number[],
  v1: number[],
  to: number[],
  ti: number[],
  t: number
): number[] {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return v0.map((a, i) => {
    const b = v1[i] ?? a;
    const c1 = a + (to[i] ?? 0);
    const c2 = b + (ti[i] ?? 0);
    return w0 * a + w1 * c1 + w2 * c2 + w3 * b;
  });
}
