import type { FillPaint, StrokePaint } from '../../ir.js';

export const LUT_SIZE = 256;

export type DevicePaint = any;

export function devicePaint(paint: FillPaint | StrokePaint, m: number[]): DevicePaint {
  if (paint.kind === 'color') {
    return { grad: null, r: paint.color[0], g: paint.color[1], b: paint.color[2], a: paint.alpha };
  }

  const sx = m[0] * paint.s[0] + m[2] * paint.s[1] + m[4];
  const sy = m[1] * paint.s[0] + m[3] * paint.s[1] + m[5];
  const ex = m[0] * paint.e[0] + m[2] * paint.e[1] + m[4];
  const ey = m[1] * paint.e[0] + m[3] * paint.e[1] + m[5];

  const lut = new Uint8Array(LUT_SIZE * 4);
  const stops = paint.stops;
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k].p && t <= stops[k + 1].p) {
        s0 = stops[k];
        s1 = stops[k + 1];
        break;
      }
    }
    const span = s1.p - s0.p;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - s0.p) / span)) : t < s0.p ? 0 : 1;
    const a = (s0.a + (s1.a - s0.a) * f) * paint.alpha;
    lut[i * 4] = (s0.r + (s1.r - s0.r) * f) * a;
    lut[i * 4 + 1] = (s0.g + (s1.g - s0.g) * f) * a;
    lut[i * 4 + 2] = (s0.b + (s1.b - s0.b) * f) * a;
    lut[i * 4 + 3] = a * 255;
  }

  if (paint.kind === 'radial') {
    const radius = Math.hypot(ex - sx, ey - sy) || 1e-6;
    if (paint.h) {
      const ang = Math.atan2(ey - sy, ex - sx) + ((paint.a ?? 0) * Math.PI) / 180;
      const fx = sx + Math.cos(ang) * paint.h * radius;
      const fy = sy + Math.sin(ang) * paint.h * radius;
      return { grad: 'focal', lut, cx: sx, cy: sy, fx, fy, r: radius };
    }
    return { grad: 'radial', lut, gx: sx, gy: sy, invR: 1 / radius };
  }
  const dx = ex - sx;
  const dy = ey - sy;
  const len2 = dx * dx + dy * dy || 1e-6;
  return { grad: 'linear', lut, gx: sx, gy: sy, gdx: dx / len2, gdy: dy / len2 };
}
