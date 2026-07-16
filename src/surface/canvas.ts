import { outputSize, type RenderOptions, type Surface } from './surface.js';
import type { Animation } from '../animation.js';
import type { Clip, DrawOp, FillPaint, GradientPaint, ImageOp, PathData, StrokePaint } from '../ir.js';

const BLEND: Record<number, GlobalCompositeOperation> = {
  1: 'multiply',
  2: 'screen',
  3: 'overlay',
  4: 'darken',
  5: 'lighten',
  6: 'color-dodge',
  7: 'color-burn',
  8: 'hard-light',
  9: 'soft-light',
  10: 'difference',
  11: 'exclusion',
  12: 'hue',
  13: 'saturation',
  14: 'color',
  15: 'luminosity',
  16: 'lighter',
};

export class CanvasSurface implements Surface<void> {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  render(anim: Animation, frame?: number, options: RenderOptions = {}): void {
    const scene = anim.sceneAt(frame);
    const { sx, sy } = outputSize(scene.width, scene.height, options);
    const ctx = this.ctx;
    const base = ctx.getTransform();
    if (options.clear !== false) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.setTransform(base);
    }
    const ba = base.a, bb = base.b, bc = base.c, bd = base.d, be = base.e, bf = base.f;
    const prevAlpha = ctx.globalAlpha;
    const dev: Dev = { ba, bb, bc, bd, be, bf, sx, sy };

    for (const op of scene.ops) {
      let clipped = 0;
      let clipAlpha = 1;
      if (op.clips?.length) {
        const res = applyClips(ctx, op.clips, dev);
        if (res === null) continue;
        clipped = res.saved ? 1 : 0;
        clipAlpha = res.alpha;
      }
      const m = op.matrix;
      const ma = m[0] * sx, mb = m[1] * sy, mc = m[2] * sx, md = m[3] * sy, me = m[4] * sx, mf = m[5] * sy;
      ctx.setTransform(
        ba * ma + bc * mb,
        bb * ma + bd * mb,
        ba * mc + bc * md,
        bb * mc + bd * md,
        ba * me + bc * mf + be,
        bb * me + bd * mf + bf
      );
      const blend = op.blend !== undefined ? BLEND[op.blend] : undefined;
      if (blend) ctx.globalCompositeOperation = blend;

      if (op.kind === 'image') {
        this.drawImage(op, clipAlpha);
      } else {
        const path = opPath(op);
        for (const fill of op.fills) {
          if (fill.alpha <= 0) continue;
          ctx.globalAlpha = fill.alpha * clipAlpha;
          ctx.fillStyle = paintStyle(ctx, fill);
          ctx.fill(path, fill.rule === 2 ? 'evenodd' : 'nonzero');
        }
        for (const stroke of op.strokes) {
          if (stroke.alpha <= 0 || !stroke.width) continue;
          ctx.globalAlpha = stroke.alpha * clipAlpha;
          ctx.strokeStyle = paintStyle(ctx, stroke) as string | CanvasGradient;
          ctx.lineWidth = stroke.width;
          ctx.lineCap = stroke.cap === 2 ? 'round' : stroke.cap === 3 ? 'square' : 'butt';
          ctx.lineJoin = stroke.join === 2 ? 'round' : stroke.join === 3 ? 'bevel' : 'miter';
          ctx.miterLimit = stroke.miter ?? 10;
          if (stroke.dash) {
            ctx.setLineDash(stroke.dash);
            ctx.lineDashOffset = stroke.dashOffset ?? 0;
          }
          ctx.stroke(path);
          if (stroke.dash) ctx.setLineDash([]);
        }
      }

      if (blend) ctx.globalCompositeOperation = 'source-over';
      if (clipped) ctx.restore();
    }

    ctx.setTransform(base);
    ctx.globalAlpha = prevAlpha;
  }

  private drawImage(op: ImageOp, alphaMul = 1): void {
    if (typeof Image === 'undefined') return;
    let img = this.images.get(op.src);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = op.src;
      this.images.set(op.src, img);
    }
    if (!img.complete || !img.naturalWidth) return;
    this.ctx.globalAlpha = Math.min(1, Math.max(0, op.alpha)) * alphaMul;
    this.ctx.drawImage(img, 0, 0, op.width || img.naturalWidth, op.height || img.naturalHeight);
  }

  dispose(): void {
    this.images.clear();
  }
}

interface Dev {
  ba: number; bb: number; bc: number; bd: number; be: number; bf: number;
  sx: number; sy: number;
}

function applyClips(
  ctx: CanvasRenderingContext2D,
  clips: Clip[],
  dev: Dev
): { saved: boolean; alpha: number } | null {
  let saved = false;
  let alpha = 1;
  for (const clip of clips) {
    if (!clip.shapes.length) {
      if (clip.mode === 1) {
        if (saved) ctx.restore();
        return null;
      }
      continue;
    }
    if (clip.mode === 1 && clip.alpha !== undefined && clip.alpha < 1) alpha *= clip.alpha;
    const p2d = new Path2D();
    let any = false;
    for (const shape of clip.shapes) {
      const m = shape.matrix;
      const ma = m[0] * dev.sx, mb = m[1] * dev.sy, mc = m[2] * dev.sx, md = m[3] * dev.sy;
      const me = m[4] * dev.sx, mf = m[5] * dev.sy;
      const dm = {
        a: dev.ba * ma + dev.bc * mb,
        b: dev.bb * ma + dev.bd * mb,
        c: dev.ba * mc + dev.bc * md,
        d: dev.bb * mc + dev.bd * md,
        e: dev.ba * me + dev.bc * mf + dev.be,
        f: dev.bb * me + dev.bd * mf + dev.bf,
      };
      for (const pd of shape.paths) {
        if (!pd.v?.length) continue;
        p2d.addPath(buildOne(pd), dm);
        any = true;
      }
    }
    if (!any) {
      if (clip.mode === 1) {
        if (saved) ctx.restore();
        return null;
      }
      continue;
    }
    if (!saved) {
      ctx.save();
      saved = true;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clip.mode === 2 || clip.mode === 3) {
      const outer = new Path2D();
      outer.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
      outer.addPath(p2d);
      ctx.clip(outer, 'evenodd');
    } else {
      ctx.clip(p2d, 'nonzero');
    }
  }
  return { saved, alpha };
}

const path2dCache = new WeakMap<PathData, Path2D>();

function opPath(op: DrawOp & { kind: 'shape' }): Path2D {
  if (op.paths.length === 1) {
    return op.static ? cachedPath2D(op.paths[0]) : buildOne(op.paths[0]);
  }
  const combined = new Path2D();
  for (const pd of op.paths) combined.addPath(op.static ? cachedPath2D(pd) : buildOne(pd));
  return combined;
}

function cachedPath2D(pd: PathData): Path2D {
  let p = path2dCache.get(pd);
  if (!p) {
    p = buildOne(pd);
    path2dCache.set(pd, p);
  }
  return p;
}

function buildOne(path: PathData): Path2D {
  const p = new Path2D();
  const v = path.v;
  if (!Array.isArray(v) || v.length === 0) return p;
  const inT = path.i ?? [];
  const outT = path.o ?? [];
  const n = v.length;
  p.moveTo(v[0][0], v[0][1]);
  for (let j = 1; j < n; j++) curve(p, v[j - 1], outT[j - 1], v[j], inT[j]);
  if (path.c && n > 1) {
    curve(p, v[n - 1], outT[n - 1], v[0], inT[0]);
    p.closePath();
  }
  return p;
}

function curve(p: Path2D, p0: number[], out: number[] = [0, 0], p1: number[], inn: number[] = [0, 0]): void {
  p.bezierCurveTo(
    p0[0] + (out[0] ?? 0),
    p0[1] + (out[1] ?? 0),
    p1[0] + (inn[0] ?? 0),
    p1[1] + (inn[1] ?? 0),
    p1[0],
    p1[1]
  );
}

function paintStyle(
  ctx: CanvasRenderingContext2D,
  paint: FillPaint | StrokePaint
): string | CanvasGradient {
  if (paint.kind === 'color') return colorString(paint.color);
  const g = paint as GradientPaint;
  const [sx, sy] = g.s;
  const [ex, ey] = g.e;
  let grad: CanvasGradient;
  if (g.kind === 'radial') {
    const r = Math.hypot(ex - sx, ey - sy) || 1e-6;
    let fx = sx;
    let fy = sy;
    if (g.h) {
      const ang = Math.atan2(ey - sy, ex - sx) + ((g.a ?? 0) * Math.PI) / 180;
      fx = sx + Math.cos(ang) * g.h * r;
      fy = sy + Math.sin(ang) * g.h * r;
    }
    grad = ctx.createRadialGradient(fx, fy, 0, sx, sy, r);
  } else {
    grad = ctx.createLinearGradient(sx, sy, ex, ey);
  }
  for (const s of g.stops) {
    grad.addColorStop(Math.min(1, Math.max(0, s.p)), `rgba(${s.r},${s.g},${s.b},${s.a})`);
  }
  return grad;
}

const colorString = (c: number[]): string => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
