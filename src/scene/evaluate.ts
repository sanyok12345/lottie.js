import { evaluate, isStatic, scalar } from '../model/property.js';
import { multiply, type Matrix } from '../math/matrix.js';
import { hexToRgb, to255 } from '../math/color.js';
import { safeHexColor } from '../util.js';
import { transformMatrix, transformOpacity } from './transform.js';
import { ellipsePath, rectPath } from './shape.js';
import type { Asset, Layer, LottieData, ShapeItem, Transform } from '../model/types.js';
import type { ColorPaint, DrawOp, FillPaint, GradientStop, PathData, Scene } from '../ir.js';

const TY_PRECOMP = 0;
const TY_SOLID = 1;
const TY_NULL = 3;
const TY_SHAPE = 4;

interface Ctx {
  assets: Map<string, Asset>;
  frameRate: number;
  ops: DrawOp[];
  depth: number;
}

export function sceneAt(data: LottieData, frame: number): Scene {
  const ctx: Ctx = {
    assets: new Map((data.assets ?? []).map((a) => [a.id, a])),
    frameRate: data.fr ?? 30,
    ops: [],
    depth: 0,
  };
  layers(data.layers ?? [], frame, ctx);
  return { width: data.w, height: data.h, ops: ctx.ops };
}

const tmCache = new WeakMap<Transform, Matrix>();
const chainCache = new WeakMap<Layer, boolean>();
const geomCache = new WeakMap<ShapeItem, PathData>();

function isStaticTransform(ks: Transform | undefined): boolean {
  if (!ks) return true;
  const p = ks.p;
  const pStatic = !p || (p.s ? isStatic(p.x) && isStatic(p.y) : isStatic(p));
  return (
    pStatic &&
    isStatic(ks.r) &&
    isStatic(ks.s) &&
    isStatic(ks.sk) &&
    isStatic(ks.sa) &&
    isStatic(ks.a)
  );
}

function cachedTransformMatrix(ks: Transform, frame: number): Matrix {
  if (!isStaticTransform(ks)) return transformMatrix(ks, frame);
  let m = tmCache.get(ks);
  if (!m) {
    m = transformMatrix(ks, frame);
    tmCache.set(ks, m);
  }
  return m;
}

function chainStatic(layer: Layer, byInd: Map<number, Layer>): boolean {
  const cached = chainCache.get(layer);
  if (cached !== undefined) return cached;
  let node: Layer | undefined = layer;
  let ok = true;
  let guard = 0;
  while (node && guard++ < 100) {
    if (!isStaticTransform(node.ks)) {
      ok = false;
      break;
    }
    if (node.parent === undefined) break;
    node = byInd.get(node.parent);
  }
  chainCache.set(layer, ok);
  return ok;
}

function cachedGeom(item: ShapeItem, build: () => PathData): PathData {
  let g = geomCache.get(item);
  if (!g) {
    g = build();
    geomCache.set(item, g);
  }
  return g;
}

function layers(list: Layer[], frame: number, ctx: Ctx): void {
  const byInd = new Map<number, Layer>();
  for (const l of list) if (l.ind !== undefined) byInd.set(l.ind, l);
  for (let i = list.length - 1; i >= 0; i--) layer(list[i], byInd, frame, ctx);
}

function layer(layer: Layer, byInd: Map<number, Layer>, frame: number, ctx: Ctx): void {
  if (layer.hd || layer.ty === TY_NULL) return;
  if (frame < (layer.ip ?? 0) || frame >= (layer.op ?? Infinity)) return;

  const local = localFrame(layer, frame);
  const opacity = transformOpacity(layer.ks, local);
  if (opacity <= 0) return;

  const staticMx = chainStatic(layer, byInd);
  let m = cachedTransformMatrix(layer.ks ?? {}, local);
  let node = layer;
  let guard = 0;
  while (node.parent !== undefined && guard++ < 100) {
    const parent = byInd.get(node.parent);
    if (!parent) break;
    m = multiply(cachedTransformMatrix(parent.ks ?? {}, localFrame(parent, frame)), m);
    node = parent;
  }

  switch (layer.ty) {
    case TY_SHAPE:
      shapeItems(layer.shapes ?? [], local, m, opacity, staticMx, ctx);
      break;
    case TY_PRECOMP: {
      if (ctx.depth > 20) return;
      const asset = ctx.assets.get(layer.refId as string);
      if (!asset || !Array.isArray(asset.layers)) return;
      let childFrame = local;
      if (layer.tm) childFrame = (scalar(evaluate(layer.tm, local)) ?? 0) * ctx.frameRate;
      ctx.depth++;
      const before = ctx.ops.length;
      layers(asset.layers, childFrame, ctx);
      ctx.depth--;
      for (let i = before; i < ctx.ops.length; i++) {
        const op = ctx.ops[i];
        op.matrix = multiply(m, op.matrix);
        op.static = op.static && staticMx;
        for (const p of op.fills) p.alpha *= opacity;
        for (const p of op.strokes) p.alpha *= opacity;
      }
      break;
    }
    case TY_SOLID: {
      const w = layer.sw ?? 0;
      const h = layer.sh ?? 0;
      if (!w || !h) return;
      ctx.ops.push({
        paths: [rectPath([w / 2, h / 2], [w, h], 0)],
        matrix: m,
        fills: [{ kind: 'color', color: hexToRgb(safeHexColor(layer.sc)), alpha: opacity, rule: 1 }],
        strokes: [],
        static: staticMx,
      });
      break;
    }
    default:
      break;
  }
}

function localFrame(layer: Layer, frame: number): number {
  return (frame - (layer.st ?? 0)) / (layer.sr || 1);
}

function shapeItems(
  items: ShapeItem[],
  frame: number,
  matrix: Matrix,
  opacity: number,
  staticMatrix: boolean,
  ctx: Ctx
): void {
  const paths: PathData[] = [];
  const fills: FillPaint[] = [];
  const strokes: ColorPaint[] = [];
  const subgroups: ShapeItem[] = [];
  let geomStatic = true;

  for (const item of items) {
    if (!item || item.hd) continue;
    switch (item.ty) {
      case 'gr':
        subgroups.push(item);
        break;
      case 'sh': {
        const path = evaluate(item.ks, frame) as PathData | undefined;
        if (path && Array.isArray(path.v) && path.v.length) paths.push(path);
        if (!isStatic(item.ks)) geomStatic = false;
        break;
      }
      case 'el': {
        const st = isStatic(item.p) && isStatic(item.s);
        const build = () => ellipsePath(evaluate(item.p, frame), evaluate(item.s, frame));
        paths.push(st ? cachedGeom(item, build) : build());
        if (!st) geomStatic = false;
        break;
      }
      case 'rc': {
        const st = isStatic(item.p) && isStatic(item.s) && isStatic(item.r);
        const build = () =>
          rectPath(evaluate(item.p, frame), evaluate(item.s, frame), scalar(evaluate(item.r, frame)) ?? 0);
        paths.push(st ? cachedGeom(item, build) : build());
        if (!st) geomStatic = false;
        break;
      }
      case 'fl':
        fills.push({
          kind: 'color',
          color: colorOf(evaluate(item.c, frame)),
          alpha: opacityOf(item, frame) * opacity,
          rule: item.r === 2 ? 2 : 1,
        });
        break;
      case 'gf': {
        const stops = gradientStops(item.g, frame);
        if (stops.length) {
          fills.push({
            kind: item.t === 2 ? 'radial' : 'linear',
            s: evaluate(item.s, frame) ?? [0, 0],
            e: evaluate(item.e, frame) ?? [0, 0],
            stops,
            alpha: opacityOf(item, frame) * opacity,
            rule: item.r === 2 ? 2 : 1,
          });
        }
        break;
      }
      case 'st':
        strokes.push({
          kind: 'color',
          color: colorOf(evaluate(item.c, frame)),
          alpha: opacityOf(item, frame) * opacity,
          width: scalar(evaluate(item.w, frame)) ?? 1,
          cap: item.lc ?? 1,
          join: item.lj ?? 1,
        });
        break;
      default:
        break;
    }
  }

  for (let i = subgroups.length - 1; i >= 0; i--) {
    const group = subgroups[i];
    const groupItems = group.it ?? [];
    const tr = groupItems.find((it) => it && it.ty === 'tr');
    const groupMatrix = tr ? multiply(matrix, cachedTransformMatrix(tr, frame)) : matrix;
    const groupOpacity = tr ? opacity * transformOpacity(tr, frame) : opacity;
    if (groupOpacity <= 0) continue;
    const groupStatic = tr ? staticMatrix && isStaticTransform(tr) : staticMatrix;
    shapeItems(groupItems, frame, groupMatrix, groupOpacity, groupStatic, ctx);
  }

  if (paths.length && (fills.length || strokes.length)) {
    ctx.ops.push({ paths, matrix, fills, strokes, static: staticMatrix && geomStatic });
  }
}

function opacityOf(item: ShapeItem, frame: number): number {
  const o = scalar(evaluate(item.o, frame));
  return typeof o === 'number' ? Math.min(1, Math.max(0, o / 100)) : 1;
}

function colorOf(c: any): number[] {
  return Array.isArray(c) ? to255(c) : [0, 0, 0];
}

function gradientStops(g: any, frame: number): GradientStop[] {
  const flat = evaluate(g?.k, frame);
  if (!Array.isArray(flat) || flat.length < 4) return [];
  const count = g?.p ?? flat.length >> 2;
  const alphaData = flat.slice(count * 4);
  const alphaAt = (pos: number): number => {
    if (alphaData.length < 2) return 1;
    if (pos <= alphaData[0]) return alphaData[1];
    for (let i = 0; i + 3 < alphaData.length; i += 2) {
      const [p0, a0, p1, a1] = [alphaData[i], alphaData[i + 1], alphaData[i + 2], alphaData[i + 3]];
      if (pos <= p1) return p1 === p0 ? a1 : a0 + (a1 - a0) * ((pos - p0) / (p1 - p0));
    }
    return alphaData[alphaData.length - 1];
  };

  const stops: GradientStop[] = [];
  for (let i = 0; i < count; i++) {
    const p = flat[i * 4] ?? 0;
    const [r, g255, b] = colorOf([flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]]);
    stops.push({ p, r, g: g255, b, a: alphaAt(p) });
  }
  return stops;
}
