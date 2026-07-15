import type { PathData, Point } from '../ir.js';

const KAPPA = 0.5522847498307936;

export function reversePath(p: PathData): PathData {
  const n = p.v.length;
  const v: Point[] = new Array(n);
  const i: Point[] = new Array(n);
  const o: Point[] = new Array(n);
  for (let j = 0; j < n; j++) {
    const k = n - 1 - j;
    v[j] = p.v[k];
    i[j] = p.o?.[k] ?? [0, 0];
    o[j] = p.i?.[k] ?? [0, 0];
  }
  return { c: p.c, v, i, o };
}

export function polystarPath(
  p: Point = [0, 0],
  points: number,
  rotationDeg: number,
  outerR: number,
  innerR: number,
  outerRound: number,
  innerRound: number,
  star: boolean
): PathData {
  const cx = p[0] ?? 0;
  const cy = p[1] ?? 0;
  const numPts = Math.max(3, Math.floor(points)) * (star ? 2 : 1);
  const angle = (Math.PI * 2) / numPts;
  let currentAng = -Math.PI / 2 + (rotationDeg * Math.PI) / 180;

  const longPerim = (2 * Math.PI * outerR) / (numPts * (star ? 2 : 4));
  const shortPerim = (2 * Math.PI * innerR) / (numPts * 2);

  const v: Point[] = [];
  const inn: Point[] = [];
  const out: Point[] = [];
  let longFlag = true;
  for (let j = 0; j < numPts; j++) {
    const rad = longFlag || !star ? outerR : innerR;
    const roundness = (longFlag || !star ? outerRound : innerRound) / 100;
    const perim = longFlag || !star ? longPerim : shortPerim;
    const x = rad * Math.cos(currentAng);
    const y = rad * Math.sin(currentAng);
    const len = Math.hypot(x, y);
    const tx = len ? y / len : 0;
    const ty = len ? -x / len : 0;
    const k = perim * roundness;
    v.push([cx + x, cy + y]);
    out.push([-tx * k, -ty * k]);
    inn.push([tx * k, ty * k]);
    longFlag = !longFlag;
    currentAng += angle;
  }
  return { c: true, v, i: inn, o: out };
}

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
