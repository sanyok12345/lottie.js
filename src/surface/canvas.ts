import { outputSize, type RenderOptions, type Surface } from './surface.js';
import type { Animation } from '../animation.js';
import type { ColorPaint, DrawOp, FillPaint, PathData } from '../ir.js';

export class CanvasSurface implements Surface<void> {
  private ctx: CanvasRenderingContext2D;

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

    for (const op of scene.ops) {
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
      const path = opPath(op);

      for (const fill of op.fills) {
        if (fill.alpha <= 0) continue;
        ctx.globalAlpha = fill.alpha;
        ctx.fillStyle = fillStyle(ctx, fill);
        ctx.fill(path, fill.rule === 2 ? 'evenodd' : 'nonzero');
      }
      for (const stroke of op.strokes) {
        if (stroke.alpha <= 0 || !stroke.width) continue;
        ctx.globalAlpha = stroke.alpha;
        ctx.strokeStyle = colorString(stroke.color);
        ctx.lineWidth = stroke.width;
        ctx.lineCap = stroke.cap === 2 ? 'round' : stroke.cap === 3 ? 'square' : 'butt';
        ctx.lineJoin = stroke.join === 2 ? 'round' : stroke.join === 3 ? 'bevel' : 'miter';
        ctx.stroke(path);
      }
    }

    ctx.setTransform(base);
    ctx.globalAlpha = prevAlpha;
  }

  dispose(): void { }
}

const path2dCache = new WeakMap<PathData, Path2D>();

function opPath(op: DrawOp): Path2D {
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

function fillStyle(ctx: CanvasRenderingContext2D, fill: FillPaint): string | CanvasGradient {
  if (fill.kind === 'color') return colorString((fill as ColorPaint).color);
  const [sx, sy] = fill.s;
  const [ex, ey] = fill.e;
  const grad =
    fill.kind === 'radial'
      ? ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.hypot(ex - sx, ey - sy) || 1e-6)
      : ctx.createLinearGradient(sx, sy, ex, ey);
  for (const s of fill.stops) {
    grad.addColorStop(Math.min(1, Math.max(0, s.p)), `rgba(${s.r},${s.g},${s.b},${s.a})`);
  }
  return grad;
}

const colorString = (c: number[]): string => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
