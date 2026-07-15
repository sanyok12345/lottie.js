import {
  identity,
  multiply,
  rotation,
  scaling,
  skewX,
  translation,
  type Matrix,
} from '../math/matrix.js';
import { evaluate, scalar } from '../model/property.js';
import type { Transform } from '../model/types.js';

export function positionAt(ks: Transform = {}, frame: number): [number, number] {
  if (!ks.p) return [0, 0];
  if (ks.p.s) {
    return [scalar(evaluate(ks.p.x, frame)) ?? 0, scalar(evaluate(ks.p.y, frame)) ?? 0];
  }
  const p = evaluate(ks.p, frame);
  return Array.isArray(p) ? [p[0] ?? 0, p[1] ?? 0] : [0, 0];
}

export function transformMatrix(ks: Transform = {}, frame: number, autoOrient = 0): Matrix {
  let m = identity();

  const [px, py] = positionAt(ks, frame);
  if (px || py) m = multiply(m, translation(px, py));
  if (autoOrient) m = multiply(m, rotation(autoOrient));

  const r = ks.r ? scalar(evaluate(ks.r, frame)) ?? 0 : 0;
  if (r) m = multiply(m, rotation(r));

  const sk = ks.sk ? scalar(evaluate(ks.sk, frame)) ?? 0 : 0;
  if (sk) {
    const sa = ks.sa ? scalar(evaluate(ks.sa, frame)) ?? 0 : 0;
    if (sa) m = multiply(m, rotation(-sa));
    m = multiply(m, skewX(-sk));
    if (sa) m = multiply(m, rotation(sa));
  }

  const s = ks.s ? evaluate(ks.s, frame) : undefined;
  if (Array.isArray(s) && (s[0] !== 100 || (s[1] ?? s[0]) !== 100)) {
    m = multiply(m, scaling((s[0] ?? 100) / 100, (s[1] ?? s[0] ?? 100) / 100));
  }

  const a = ks.a ? evaluate(ks.a, frame) : undefined;
  if (Array.isArray(a) && ((a[0] ?? 0) || (a[1] ?? 0))) {
    m = multiply(m, translation(-(a[0] ?? 0), -(a[1] ?? 0)));
  }

  return m;
}

export function transformOpacity(ks: Transform = {}, frame: number): number {
  if (!ks.o) return 1;
  const o = scalar(evaluate(ks.o, frame));
  return typeof o === 'number' ? Math.min(1, Math.max(0, o / 100)) : 1;
}
