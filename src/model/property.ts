import { cubicBezierEasing } from '../math/bezier.js';
import type { PathData, Point } from '../ir.js';
import type { Animatable, AnimValue, Keyframe } from './types.js';

type Easing = (x: number) => number;

let slots: Record<string, any> | null = null;

export function setSlots(s: Record<string, any> | null | undefined): void {
  slots = s ?? null;
}

function resolved(prop: Animatable): Animatable {
  if (slots && typeof prop.sid === 'string') {
    const slot = slots[prop.sid];
    if (slot && typeof slot === 'object' && slot.p) return slot.p as Animatable;
  }
  return prop;
}

export function evaluate(prop: Animatable | undefined, frame: number): any {
  if (prop == null) return undefined;
  prop = resolved(prop);
  if (prop.k === undefined) return undefined;
  if (!animated(prop)) return prop.k as AnimValue;
  return evaluateKeyframes(prop.k as Keyframe[], frame);
}

export const scalar = (v: AnimValue | undefined): number | undefined =>
  Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;

export function isStatic(prop: Animatable | undefined): boolean {
  if (prop == null) return true;
  prop = resolved(prop);
  return prop.k === undefined || !animated(prop);
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
  const ease = easingFor(k0);
  if (Array.isArray(ease)) {
    if (Array.isArray(v0) && Array.isArray(v1) && !(Array.isArray(k0.to) && Array.isArray(k0.ti))) {
      return v0.map((a, idx) => {
        const fn = ease[Math.min(idx, ease.length - 1)];
        return lerp(a, (v1 as number[])[idx] ?? a, fn(lin));
      });
    }
    return interpolate(v0, v1, ease[0](lin), k0);
  }
  return interpolate(v0, v1, ease(lin), k0);
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

const easingCache = new WeakMap<Keyframe, Easing | Easing[]>();

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function pickAt(v: number | number[] | undefined, idx: number, fallback: number): number {
  const n = Array.isArray(v) ? v[Math.min(idx, v.length - 1)] : v;
  return typeof n === 'number' ? n : fallback;
}

function easeAt(kf: Keyframe, idx: number): Easing {
  return cubicBezierEasing(
    clamp01(pickAt(kf.o?.x, idx, 1 / 3)),
    pickAt(kf.o?.y, idx, 1 / 3),
    clamp01(pickAt(kf.i?.x, idx, 2 / 3)),
    pickAt(kf.i?.y, idx, 2 / 3)
  );
}

function easingFor(kf: Keyframe): Easing | Easing[] {
  let fn = easingCache.get(kf);
  if (!fn) {
    const dims = Math.max(
      Array.isArray(kf.o?.x) ? kf.o.x.length : 1,
      Array.isArray(kf.i?.x) ? kf.i.x.length : 1
    );
    if (dims > 1) {
      const fns: Easing[] = [];
      for (let d = 0; d < dims; d++) fns.push(easeAt(kf, d));
      const same = fns.every(
        (_, d) =>
          d === 0 ||
          (pickAt(kf.o?.x, d, 1 / 3) === pickAt(kf.o?.x, 0, 1 / 3) &&
            pickAt(kf.o?.y, d, 1 / 3) === pickAt(kf.o?.y, 0, 1 / 3) &&
            pickAt(kf.i?.x, d, 2 / 3) === pickAt(kf.i?.x, 0, 2 / 3) &&
            pickAt(kf.i?.y, d, 2 / 3) === pickAt(kf.i?.y, 0, 2 / 3))
      );
      fn = same ? fns[0] : fns;
    } else {
      fn = easeAt(kf, 0);
    }
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
