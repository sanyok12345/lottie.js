import type { PathData, Point } from '../ir.js';

const KAPPA = 0.5522847498307936;

export function ellipsePath(p: Point = [0, 0], s: Point = [0, 0]): PathData {
  const [cx, cy] = p;
  const rx = (s[0] ?? 0) / 2;
  const ry = (s[1] ?? 0) / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    c: true,
    v: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
    o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
  };
}

export function rectPath(p: Point = [0, 0], s: Point = [0, 0], r = 0): PathData {
  const [cx, cy] = p;
  const hw = (s[0] ?? 0) / 2;
  const hh = (s[1] ?? 0) / 2;
  const rad = Math.min(Math.max(r || 0, 0), hw, hh);

  if (!rad) {
    const z: Point = [0, 0];
    return {
      c: true,
      v: [[cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh]],
      o: [z, z, z, z],
      i: [z, z, z, z],
    };
  }

  const k = rad * KAPPA;
  const z: Point = [0, 0];
  return {
    c: true,
    v: [
      [cx + hw - rad, cy - hh],
      [cx + hw, cy - hh + rad],
      [cx + hw, cy + hh - rad],
      [cx + hw - rad, cy + hh],
      [cx - hw + rad, cy + hh],
      [cx - hw, cy + hh - rad],
      [cx - hw, cy - hh + rad],
      [cx - hw + rad, cy - hh],
    ],
    o: [[k, 0], z, [0, k], z, [-k, 0], z, [0, -k], z],
    i: [z, [0, -k], z, [k, 0], z, [0, k], z, [-k, 0]],
  };
}
