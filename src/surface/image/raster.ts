import { avgScale, flattenPath, strokeRing, type Ring } from './flatten.js';
import { devicePaint } from './paint.js';
import { getRaster } from './scanline.js';
import type { RenderOptions } from '../surface.js';
import type { RGBAImage } from '../../types.js';
import type { PathData, Scene } from '../../ir.js';

const flattenCache = new WeakMap<PathData, { key: string; rings: Ring[] }>();

export function rasterize(scene: Scene, options: RenderOptions = {}): RGBAImage {
  const width = Math.round(Number(options.width ?? scene.width ?? 512));
  const height = Math.round(Number(options.height ?? scene.height ?? 512));
  const r = getRaster(width, height);
  r.clear();

  const sx = width / (scene.width || width);
  const sy = height / (scene.height || height);

  for (const op of scene.ops) {
    const m = op.matrix;
    const dm = [m[0] * sx, m[1] * sy, m[2] * sx, m[3] * sy, m[4] * sx, m[5] * sy];
    avgScale(dm);
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
      if (fill.alpha > 0) r.fillRings(rings, fill.rule ?? 1, devicePaint(fill, dm));
    }
    for (const stroke of op.strokes) {
      if (stroke.alpha <= 0) continue;
      const w = (stroke.width ?? 1) * avgScale(dm);
      if (w <= 0) continue;
      const strokeRings: Ring[] = [];
      for (const ring of rings) strokeRing(ring, w / 2, stroke.cap ?? 1, strokeRings);
      if (strokeRings.length) r.fillRings(strokeRings, 1, devicePaint(stroke, dm));
    }
  }

  return { data: r.unpremultiplied(), width, height };
}
