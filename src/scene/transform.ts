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

export function transformMatrix(ks: Transform = {}, frame: number): Matrix {
  let m = identity();

  let px = 0;
  let py = 0;
  if (ks.p) {
    if (ks.p.s) {
      px = scalar(evaluate(ks.p.x, frame)) ?? 0;
      py = scalar(evaluate(ks.p.y, frame)) ?? 0;
    } else {
      const p = evaluate(ks.p, frame);
      if (Array.isArray(p)) {
        px = p[0] ?? 0;
        py = p[1] ?? 0;
      }
    }
  }
  if (px || py) m = multiply(m, translation(px, py));

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
