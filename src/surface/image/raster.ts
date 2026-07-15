import { avgScale, flattenPath, strokeRing, type Ring } from './flatten.js';
import { devicePaint } from './paint.js';
import { getRaster, type Raster } from './scanline.js';
import type { RenderOptions } from '../surface.js';
import type { RGBAImage } from '../../types.js';
import type { Clip, PathData, Scene } from '../../ir.js';

const flattenCache = new WeakMap<PathData, { key: string; rings: Ring[] }>();

export function rasterize(scene: Scene, options: RenderOptions = {}): RGBAImage {
  const width = Math.max(1, Math.round(Number(options.width ?? scene.width ?? 512)));
  const height = Math.max(1, Math.round(Number(options.height ?? scene.height ?? 512)));
  const r = getRaster(width, height);
  r.clear();

  const sx = width / (scene.width || width);
  const sy = height / (scene.height || height);

  for (const op of scene.ops) {
    let clip: Float32Array | null = null;
    if (op.clips?.length) {
      clip = clipCoverage(r, op.clips, sx, sy);
      if (!clip) continue;
    }

    const m = op.matrix;
    const dm = [m[0] * sx, m[1] * sy, m[2] * sx, m[3] * sy, m[4] * sx, m[5] * sy];
    const scale = avgScale(dm);
    const blend = op.blend ?? 0;

    if (op.kind === 'image') {
      const img = options.images?.[op.assetId ?? ''] ?? options.images?.[op.src];
      if (!img || op.alpha <= 0) continue;
      const mw = op.width && img.width ? op.width / img.width : 1;
      const mh = op.height && img.height ? op.height / img.height : 1;
      const im = [dm[0] * mw, dm[1] * mw, dm[2] * mh, dm[3] * mh, dm[4], dm[5]];
      r.drawImage(img, im, Math.min(1, op.alpha), clip, blend);
      continue;
    }

    const rings: Ring[] = [];
    if (op.static) {
      const key = dm.join(',');
      for (const path of op.paths) {
        const ent = flattenCache.get(path);
        if (ent && ent.key === key) {
          for (const rg of ent.rings) rings.push(rg);
        } else {
          const fresh: Ring[] = [];
          flattenPath(path, dm, fresh);
          flattenCache.set(path, { key, rings: fresh });
          for (const rg of fresh) rings.push(rg);
        }
      }
    } else {
      for (const path of op.paths) flattenPath(path, dm, rings);
    }
    if (!rings.length) continue;

    for (const fill of op.fills) {
      if (fill.alpha > 0) r.fillRings(rings, fill.rule ?? 1, devicePaint(fill, dm), clip, blend);
    }
    for (const stroke of op.strokes) {
      if (stroke.alpha <= 0) continue;
      const w = (stroke.width ?? 1) * scale;
      if (w <= 0) continue;
      let baseRings = rings;
      if (stroke.dash?.length) {
        const dashed: Ring[] = [];
        const pattern = stroke.dash.map((v) => v * scale);
        for (const ring of rings) dashRing(ring, pattern, (stroke.dashOffset ?? 0) * scale, dashed);
        baseRings = dashed;
      }
      const strokeRings: Ring[] = [];
      for (const ring of baseRings) strokeRing(ring, w / 2, stroke.cap ?? 1, strokeRings);
      if (strokeRings.length) r.fillRings(strokeRings, 1, devicePaint(stroke, dm), clip, blend);
    }
  }

  return { data: r.unpremultiplied(), width, height };
}

function clipCoverage(r: Raster, clips: Clip[], sx: number, sy: number): Float32Array | null {
  const buf = r.acquireClipBuf();
  for (const stage of clips) {
    const rings: Ring[] = [];
    for (const shape of stage.shapes) {
      const m = shape.matrix;
      const dm = [m[0] * sx, m[1] * sy, m[2] * sx, m[3] * sy, m[4] * sx, m[5] * sy];
      avgScale(dm);
      for (const p of shape.paths) flattenPath(p, dm, rings);
    }
    if (!rings.length) {
      if (stage.mode === 1) return null;
      continue;
    }
    const tmp = r.acquireStageBuf();
    r.coverageRings(rings, tmp);
    if (stage.mode === 1) {
      for (let i = 0; i < buf.length; i++) buf[i] *= tmp[i];
    } else {
      for (let i = 0; i < buf.length; i++) buf[i] *= 1 - tmp[i];
    }
  }
  return buf;
}

function dashRing(ring: Ring, pattern: number[], offset: number, out: Ring[]): void {
  const arr = pattern.length % 2 ? pattern.concat(pattern) : pattern;
  const total = arr.reduce((a, b) => a + b, 0);
  if (total <= 1e-6) {
    out.push(ring);
    return;
  }
  let idx = 0;
  let on = true;
  let rem = arr[0];
  let off = ((offset % total) + total) % total;
  while (off > 1e-9) {
    const take = Math.min(off, rem);
    rem -= take;
    off -= take;
    if (rem <= 1e-9) {
      idx = (idx + 1) % arr.length;
      rem = arr[idx];
      on = !on;
    }
  }

  let cur: Ring | null = on ? [ring[0], ring[1]] : null;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    let x0 = ring[i];
    let y0 = ring[i + 1];
    const x1 = ring[i + 2];
    const y1 = ring[i + 3];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > rem + 1e-9) {
      const t = rem / seg;
      const mx = x0 + (x1 - x0) * t;
      const my = y0 + (y1 - y0) * t;
      if (on) {
        cur!.push(mx, my);
        if (cur!.length >= 4) out.push(cur!);
        cur = null;
      } else {
        cur = [mx, my];
      }
      seg -= rem;
      x0 = mx;
      y0 = my;
      idx = (idx + 1) % arr.length;
      rem = arr[idx];
      on = !on;
    }
    rem -= seg;
    if (on && cur) cur.push(x1, y1);
    if (rem <= 1e-9) {
      idx = (idx + 1) % arr.length;
      rem = arr[idx];
      if (on) {
        if (cur && cur.length >= 4) out.push(cur);
        cur = null;
      } else {
        cur = [x1, y1];
      }
      on = !on;
    }
  }
  if (cur && cur.length >= 4) out.push(cur);
}
