import {
  evaluate,
  isStatic,
  scalar,
  setExpressionFrameRate,
  setSlots,
} from '../model/property.js';
import { invert, multiply, rotation, scaling, translation, type Matrix } from '../math/matrix.js';
import { hexToRgb, to255 } from '../math/color.js';
import { safeHexColor } from '../util.js';
import { positionAt, transformMatrix, transformOpacity } from './transform.js';
import { ellipsePath, polystarPath, rectPath, reversePath } from './shape.js';
import {
  offsetPath,
  pathSampler,
  puckerBloat,
  roundCorners,
  signedArea,
  trimPaths,
  twist,
  zigZag,
} from './modifiers.js';
import {
  hasAnimators,
  isStaticDoc,
  layoutText,
  textAnimators,
  textDocAt,
  textEnv,
  type TextEnv,
} from './text.js';
import { mergePathsBoolean } from './boolean.js';
import type { Asset, Layer, LottieData, ShapeItem, Transform } from '../model/types.js';
import type {
  Clip,
  ClipShape,
  DrawOp,
  FillPaint,
  GradientPaint,
  GradientStop,
  PathData,
  Scene,
  StrokePaint,
} from '../ir.js';

const TY_PRECOMP = 0;
const TY_SOLID = 1;
const TY_IMAGE = 2;
const TY_NULL = 3;
const TY_SHAPE = 4;
const TY_TEXT = 5;

interface Ctx {
  assets: Map<string, Asset>;
  frameRate: number;
  ops: DrawOp[];
  depth: number;
  text: TextEnv | null;
}

const textEnvCache = new WeakMap<LottieData, TextEnv | null>();
const textPathsCache = new WeakMap<object, PathData[]>();

export function sceneAt(data: LottieData, frame: number): Scene {
  setSlots(data.slots);
  setExpressionFrameRate(data.fr ?? 30);
  let env = textEnvCache.get(data);
  if (env === undefined) {
    env = textEnv(data);
    textEnvCache.set(data, env);
  }
  const ctx: Ctx = {
    assets: new Map((data.assets ?? []).map((a) => [a.id, a])),
    frameRate: data.fr ?? 30,
    ops: [],
    depth: 0,
    text: env,
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

function autoOrientAngle(layer: Layer, frame: number): number {
  if (layer.ao !== 1 || !layer.ks?.p) return 0;
  const p = layer.ks.p;
  if (p.s ? isStatic(p.x) && isStatic(p.y) : isStatic(p)) return 0;
  const [x0, y0] = positionAt(layer.ks, frame - 0.5);
  const [x1, y1] = positionAt(layer.ks, frame + 0.5);
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!dx && !dy) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function layerMatrix(layer: Layer, local: number): Matrix {
  const ao = autoOrientAngle(layer, local);
  if (ao) return transformMatrix(layer.ks ?? {}, local, ao);
  return cachedTransformMatrix(layer.ks ?? {}, local);
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

const styledCache = new WeakMap<ShapeItem, boolean>();

function hasStyles(group: ShapeItem): boolean {
  let styled = styledCache.get(group);
  if (styled === undefined) {
    styled = false;
    for (const it of group.it ?? []) {
      if (!it || it.hd) continue;
      const t = it.ty;
      if (t === 'fl' || t === 'st' || t === 'gf' || t === 'gs' || (t === 'gr' && hasStyles(it))) {
        styled = true;
        break;
      }
    }
    styledCache.set(group, styled);
  }
  return styled;
}

function geomOf(item: ShapeItem, frame: number): { path: PathData; static: boolean } | null {
  switch (item.ty) {
    case 'sh': {
      let path = evaluate(item.ks, frame) as PathData | undefined;
      if (!path || !Array.isArray(path.v) || !path.v.length) return null;
      if (item.d === 3) path = reversePath(path);
      return { path, static: isStatic(item.ks) };
    }
    case 'el': {
      const st = isStatic(item.p) && isStatic(item.s);
      const build = () => {
        const p = ellipsePath(evaluate(item.p, frame), evaluate(item.s, frame));
        return item.d === 3 ? reversePath(p) : p;
      };
      return { path: st ? cachedGeom(item, build) : build(), static: st };
    }
    case 'rc': {
      const st = isStatic(item.p) && isStatic(item.s) && isStatic(item.r);
      const build = () => {
        const p = rectPath(
          evaluate(item.p, frame),
          evaluate(item.s, frame),
          scalar(evaluate(item.r, frame)) ?? 0
        );
        return item.d === 3 ? reversePath(p) : p;
      };
      return { path: st ? cachedGeom(item, build) : build(), static: st };
    }
    case 'sr': {
      const st =
        isStatic(item.p) &&
        isStatic(item.pt) &&
        isStatic(item.r) &&
        isStatic(item.or) &&
        isStatic(item.ir) &&
        isStatic(item.os) &&
        isStatic(item.is);
      const build = () => {
        const p = polystarPath(
          evaluate(item.p, frame),
          scalar(evaluate(item.pt, frame)) ?? 5,
          scalar(evaluate(item.r, frame)) ?? 0,
          scalar(evaluate(item.or, frame)) ?? 0,
          scalar(evaluate(item.ir, frame)) ?? 0,
          scalar(evaluate(item.os, frame)) ?? 0,
          scalar(evaluate(item.is, frame)) ?? 0,
          item.sy !== 2
        );
        return item.d === 3 ? reversePath(p) : p;
      };
      return { path: st ? cachedGeom(item, build) : build(), static: st };
    }
    default:
      return null;
  }
}

function transformPath(p: PathData, m: Matrix): PathData {
  const n = p.v.length;
  const v: PathData['v'] = new Array(n);
  const i: PathData['i'] = new Array(n);
  const o: PathData['o'] = new Array(n);
  for (let j = 0; j < n; j++) {
    const pt = p.v[j];
    const it = p.i?.[j] ?? [0, 0];
    const ot = p.o?.[j] ?? [0, 0];
    v[j] = [m[0] * pt[0] + m[2] * pt[1] + m[4], m[1] * pt[0] + m[3] * pt[1] + m[5]];
    i[j] = [m[0] * it[0] + m[2] * it[1], m[1] * it[0] + m[3] * it[1]];
    o[j] = [m[0] * ot[0] + m[2] * ot[1], m[1] * ot[0] + m[3] * ot[1]];
  }
  return { c: p.c, v, i, o };
}

function collectPaths(
  group: ShapeItem,
  frame: number,
  m: Matrix | null,
  out: PathData[]
): boolean {
  let allStatic = true;
  const items = group.it ?? [];
  const tr = items.find((it) => it && it.ty === 'tr');
  if (tr) {
    const trM = cachedTransformMatrix(tr, frame);
    m = m ? multiply(m, trM) : trM;
    if (!isStaticTransform(tr)) allStatic = false;
  }
  for (const item of items) {
    if (!item || item.hd) continue;
    if (item.ty === 'gr') {
      if (!collectPaths(item, frame, m, out)) allStatic = false;
      continue;
    }
    const g = geomOf(item, frame);
    if (g) {
      out.push(m ? transformPath(g.path, m) : g.path);
      if (!g.static) allStatic = false;
    }
  }
  return allStatic;
}

function layers(list: Layer[], frame: number, ctx: Ctx): void {
  const byInd = new Map<number, Layer>();
  for (const l of list) if (l.ind !== undefined) byInd.set(l.ind, l);
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i];
    if (l.td === 1) continue;
    let matte: Clip[] | undefined;
    if (l.tt) {
      const src = l.tp !== undefined ? byInd.get(l.tp) : list[i - 1];
      if (src) matte = matteClips(src, byInd, frame, ctx, l.tt);
    }
    layer(l, byInd, frame, ctx, matte);
  }
}

function matteCoverage(fills: FillPaint[], luma: boolean): number {
  const f = fills[0];
  if (!f) return 0;
  const alpha = Math.min(1, Math.max(0, f.alpha));
  if (!luma) return alpha;
  const lum = (c: number[]): number =>
    (0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0)) / 255;
  if (f.kind === 'color') return lum(f.color) * alpha;
  let sum = 0;
  for (const s of f.stops) sum += lum([s.r, s.g, s.b]) * s.a;
  return (f.stops.length ? sum / f.stops.length : 0) * alpha;
}

function matteClips(
  src: Layer,
  byInd: Map<number, Layer>,
  frame: number,
  ctx: Ctx,
  tt: number
): Clip[] {
  const sub: Ctx = {
    assets: ctx.assets,
    frameRate: ctx.frameRate,
    ops: [],
    depth: ctx.depth,
    text: ctx.text,
  };
  layer(src, byInd, frame, sub);
  const luma = tt === 3 || tt === 4;
  const shapes: ClipShape[] = [];
  for (const op of sub.ops) {
    if (op.kind === 'shape' && op.paths.length) {
      const coverage = matteCoverage(op.fills, luma);
      const shape: ClipShape = { paths: op.paths, matrix: op.matrix };
      if (coverage < 1) shape.coverage = coverage;
      shapes.push(shape);
    }
  }
  const inverted = tt === 2 || tt === 4;
  if (!shapes.length) return inverted ? [] : [{ shapes: [], mode: 1 }];
  return [{ shapes, mode: inverted ? 2 : 1 }];
}

function maskClips(layer: Layer, m: Matrix, frame: number): Clip[] {
  const list = layer.masksProperties;
  if (!Array.isArray(list) || !list.length) return [];
  const clips: Clip[] = [];
  let add: ClipShape[] = [];
  let addAlpha = 1;
  const flushAdd = (): void => {
    if (add.length) {
      clips.push({ shapes: add, mode: 1, alpha: addAlpha });
      add = [];
      addAlpha = 1;
    }
  };
  for (const mk of list) {
    if (!mk || mk.mode === 'n') continue;
    let pd = evaluate(mk.pt, frame) as PathData | undefined;
    if (!pd || !Array.isArray(pd.v) || !pd.v.length) continue;
    const expand = scalar(evaluate(mk.x, frame)) ?? 0;
    if (expand) pd = offsetPath(pd, signedArea(pd) >= 0 ? expand : -expand, 4, 2);
    const alpha = Math.min(1, Math.max(0, (scalar(evaluate(mk.o, frame)) ?? 100) / 100));
    const shape: ClipShape = { paths: [pd], matrix: m };
    const inv = !!mk.inv;
    if (mk.mode === 's') {
      flushAdd();
      clips.push({ shapes: [shape], mode: inv ? 1 : 2, alpha });
    } else if (mk.mode === 'i' || mk.mode === 'd') {
      flushAdd();
      clips.push({ shapes: [shape], mode: inv ? 2 : 1, alpha });
    } else if (mk.mode === 'f') {
      flushAdd();
      clips.push({ shapes: [shape], mode: 3, alpha });
    } else if (inv) {
      flushAdd();
      clips.push({ shapes: [shape], mode: 2, alpha });
    } else {
      if (add.length && alpha !== addAlpha) flushAdd();
      add.push(shape);
      addAlpha = alpha;
    }
  }
  flushAdd();
  return clips;
}

const MB_SAMPLES = 6;
const MB_SHUTTER = 0.5;

function scaleOpAlpha(op: DrawOp, mul: number): void {
  if (op.kind === 'shape') {
    op.fills = op.fills.map((f) => ({ ...f, alpha: f.alpha * mul }));
    op.strokes = op.strokes.map((s) => ({ ...s, alpha: s.alpha * mul }));
  } else {
    op.alpha *= mul;
  }
  op.static = false;
}

function layer(
  layer: Layer,
  byInd: Map<number, Layer>,
  frame: number,
  ctx: Ctx,
  extraClips?: Clip[],
  mbSample = false
): void {
  if (layer.hd || layer.ty === TY_NULL) return;
  if (!mbSample && layer.mb && !chainStatic(layer, byInd)) {
    for (let k = 0; k < MB_SAMPLES; k++) {
      const t = frame + ((k + 0.5) / MB_SAMPLES - 0.5) * MB_SHUTTER;
      const before = ctx.ops.length;
      layer_(layer, byInd, t, ctx, extraClips);
      const mul = 1 / (k + 1);
      if (mul < 1) {
        for (let i = before; i < ctx.ops.length; i++) scaleOpAlpha(ctx.ops[i], mul);
      }
    }
    return;
  }
  layer_(layer, byInd, frame, ctx, extraClips);
}

function layer_(
  layer: Layer,
  byInd: Map<number, Layer>,
  frame: number,
  ctx: Ctx,
  extraClips?: Clip[]
): void {
  if (frame < (layer.ip ?? 0) || frame >= (layer.op ?? Infinity)) return;

  const opacity = transformOpacity(layer.ks, frame);
  if (opacity <= 0) return;

  const staticMx = chainStatic(layer, byInd);
  let m = layerMatrix(layer, frame);
  let node = layer;
  let guard = 0;
  while (node.parent !== undefined && guard++ < 100) {
    const parent = byInd.get(node.parent);
    if (!parent) break;
    m = multiply(layerMatrix(parent, frame), m);
    node = parent;
  }

  const start = ctx.ops.length;

  switch (layer.ty) {
    case TY_SHAPE:
      shapeItems(layer.shapes ?? [], frame, m, opacity, staticMx, ctx, []);
      break;
    case TY_PRECOMP: {
      if (ctx.depth > 20) return;
      const asset = ctx.assets.get(layer.refId as string);
      if (!asset || !Array.isArray(asset.layers)) return;
      let childFrame = localFrame(layer, frame);
      if (layer.tm) childFrame = (scalar(evaluate(layer.tm, frame)) ?? 0) * ctx.frameRate;
      ctx.depth++;
      layers(asset.layers, childFrame, ctx);
      ctx.depth--;
      const w = layer.w ?? asset.w ?? 0;
      const h = layer.h ?? asset.h ?? 0;
      const clipStage: Clip | null =
        w && h && layer.ct !== 1
          ? { shapes: [{ paths: [rectPath([w / 2, h / 2], [w, h], 0)], matrix: m }], mode: 1 }
          : null;
      for (let i = start; i < ctx.ops.length; i++) {
        const op = ctx.ops[i];
        op.matrix = multiply(m, op.matrix);
        op.static = op.static && staticMx;
        if (op.kind === 'shape') {
          for (const p of op.fills) p.alpha *= opacity;
          for (const p of op.strokes) p.alpha *= opacity;
        } else {
          op.alpha *= opacity;
        }
        if (op.clips) {
          op.clips = op.clips.map((c) => ({
            mode: c.mode,
            shapes: c.shapes.map((s) => ({ ...s, matrix: multiply(m, s.matrix) })),
          }));
        }
        if (clipStage) op.clips = op.clips ? [...op.clips, clipStage] : [clipStage];
      }
      break;
    }
    case TY_SOLID: {
      const w = layer.sw ?? 0;
      const h = layer.sh ?? 0;
      if (!w || !h) return;
      ctx.ops.push({
        kind: 'shape',
        paths: [rectPath([w / 2, h / 2], [w, h], 0)],
        matrix: m,
        fills: [{ kind: 'color', color: hexToRgb(safeHexColor(layer.sc)), alpha: opacity, rule: 1 }],
        strokes: [],
        static: staticMx,
      });
      break;
    }
    case TY_TEXT: {
      if (!ctx.text) return;
      const doc = textDocAt(layer, frame);
      if (!doc) return;
      const pathOpts = layer.t?.p;
      const pathMask =
        pathOpts && typeof pathOpts.m === 'number'
          ? layer.masksProperties?.[pathOpts.m]
          : undefined;

      if (!hasAnimators(layer) && !pathMask) {
        let paths = textPathsCache.get(doc);
        if (!paths) {
          paths = [];
          for (const g of layoutText(doc, ctx.text)) {
            const gm = multiply(translation(g.x, g.y), scaling(g.scale, g.scale));
            for (const item of g.glyph.shapes) {
              if (!item || item.hd) continue;
              if (item.ty === 'gr') collectPaths(item, frame, gm, paths);
              else {
                const geo = geomOf(item, frame);
                if (geo) paths.push(transformPath(geo.path, gm));
              }
            }
          }
          textPathsCache.set(doc, paths);
        }
        if (!paths.length) return;
        const fills: FillPaint[] = [];
        const strokes: StrokePaint[] = [];
        if (Array.isArray(doc.fc)) {
          fills.push({ kind: 'color', color: to255(doc.fc), alpha: opacity, rule: 1 });
        }
        if (Array.isArray(doc.sc) && (doc.sw ?? 0) > 0) {
          strokes.push({
            kind: 'color',
            color: to255(doc.sc),
            alpha: opacity,
            width: doc.sw ?? 1,
            cap: 2,
            join: 2,
          });
        }
        if (!fills.length && !strokes.length) {
          fills.push({ kind: 'color', color: [0, 0, 0], alpha: opacity, rule: 1 });
        }
        ctx.ops.push({
          kind: 'shape',
          paths,
          matrix: m,
          fills,
          strokes,
          static: staticMx && isStaticDoc(layer),
        });
        break;
      }

      const placed = layoutText(doc, ctx.text);
      if (!placed.length) return;
      const totalChars = placed[placed.length - 1].charIndex + 1;
      const mods = textAnimators(layer, frame, placed, totalChars);

      let sampler = null;
      let margin = 0;
      if (pathMask) {
        const pd = evaluate(pathMask.pt, frame) as PathData | undefined;
        if (pd && Array.isArray(pd.v) && pd.v.length) sampler = pathSampler(pd);
        margin = scalar(evaluate(pathOpts.f, frame)) ?? 0;
      }

      const baseColor = Array.isArray(doc.fc) ? doc.fc : [0, 0, 0];
      for (let gi = 0; gi < placed.length; gi++) {
        const g = placed[gi];
        const md = mods ? mods[gi] : null;
        const charAlpha = opacity * (md ? Math.min(1, Math.max(0, md.opacity)) : 1);
        if (charAlpha <= 0) continue;

        let cm: Matrix;
        if (sampler) {
          const pt = sampler.at(margin + g.x + (md?.dx ?? 0));
          cm = multiply(translation(pt.x, pt.y), rotation((pt.angle * 180) / Math.PI));
          const dy = (md?.dy ?? 0) + (doc.ls ?? 0);
          if (dy) cm = multiply(cm, translation(0, dy));
        } else {
          cm = translation(g.x + (md?.dx ?? 0), g.y + (md?.dy ?? 0));
        }
        if (md?.rot) cm = multiply(cm, rotation(md.rot));
        cm = multiply(cm, scaling(g.scale * (md?.sx ?? 1), g.scale * (md?.sy ?? 1)));

        const paths: PathData[] = [];
        for (const item of g.glyph.shapes) {
          if (!item || item.hd) continue;
          if (item.ty === 'gr') collectPaths(item, frame, cm, paths);
          else {
            const geo = geomOf(item, frame);
            if (geo) paths.push(transformPath(geo.path, cm));
          }
        }
        if (!paths.length) continue;

        let color = baseColor;
        if (md?.fcColor && md.fcF) {
          const w = md.fcF;
          color = baseColor.map((c, k) => c + ((md.fcColor![k] ?? c) - c) * w);
        }
        const strokes: StrokePaint[] = [];
        if (Array.isArray(doc.sc) && (doc.sw ?? 0) > 0) {
          strokes.push({
            kind: 'color',
            color: to255(doc.sc),
            alpha: charAlpha,
            width: doc.sw ?? 1,
            cap: 2,
            join: 2,
          });
        }
        ctx.ops.push({
          kind: 'shape',
          paths,
          matrix: m,
          fills: [{ kind: 'color', color: to255(color), alpha: charAlpha, rule: 1 }],
          strokes,
          static: false,
        });
      }
      break;
    }
    case TY_IMAGE: {
      const asset = ctx.assets.get(layer.refId as string);
      if (!asset || typeof asset.p !== 'string' || !asset.p) return;
      const src =
        asset.e === 1 || asset.p.startsWith('data:') ? asset.p : (asset.u ?? '') + asset.p;
      ctx.ops.push({
        kind: 'image',
        src,
        assetId: asset.id,
        width: asset.w ?? 0,
        height: asset.h ?? 0,
        matrix: m,
        alpha: opacity,
        static: staticMx,
        paths: [],
        fills: [],
        strokes: [],
      });
      break;
    }
    default:
      break;
  }

  const stages: Clip[] = extraClips ? [...extraClips] : [];
  stages.push(...maskClips(layer, m, frame));
  const blend = typeof layer.bm === 'number' && layer.bm ? layer.bm : undefined;
  if (stages.length || blend !== undefined) {
    for (let i = start; i < ctx.ops.length; i++) {
      const op = ctx.ops[i];
      if (stages.length) op.clips = op.clips ? [...op.clips, ...stages] : stages.slice();
      if (blend !== undefined && op.blend === undefined) op.blend = blend;
    }
  }
}

function localFrame(layer: Layer, frame: number): number {
  return (frame - (layer.st ?? 0)) / (layer.sr || 1);
}

type Mod = (paths: PathData[], frame: number) => PathData[];

function modOf(item: ShapeItem): Mod | null {
  switch (item.ty) {
    case 'tm':
      return (paths, frame) =>
        trimPaths(
          paths,
          (scalar(evaluate(item.s, frame)) ?? 0) / 100,
          (scalar(evaluate(item.e, frame)) ?? 100) / 100,
          (scalar(evaluate(item.o, frame)) ?? 0) / 360,
          item.m !== 2
        );
    case 'rd':
      return (paths, frame) => {
        const r = scalar(evaluate(item.r, frame)) ?? 0;
        return r > 0 ? paths.map((p) => roundCorners(p, r)) : paths;
      };
    case 'zz':
      return (paths, frame) => {
        const amp = scalar(evaluate(item.s, frame)) ?? 0;
        const ridges = scalar(evaluate(item.r, frame)) ?? 1;
        const smooth = (scalar(evaluate(item.pt, frame)) ?? 1) === 2;
        return amp ? paths.map((p) => zigZag(p, amp, ridges, smooth)) : paths;
      };
    case 'pb':
      return (paths, frame) => {
        const a = scalar(evaluate(item.a, frame)) ?? 0;
        return a ? paths.map((p) => puckerBloat(p, a)) : paths;
      };
    case 'tw':
      return (paths, frame) => {
        const a = scalar(evaluate(item.a, frame)) ?? 0;
        const c = evaluate(item.c, frame) ?? [0, 0];
        return a ? paths.map((p) => twist(p, a, c)) : paths;
      };
    case 'op':
      return (paths, frame) => {
        const a = scalar(evaluate(item.a, frame)) ?? 0;
        const ml = scalar(evaluate(item.ml, frame)) ?? item.ml ?? 4;
        return a ? paths.map((p) => offsetPath(p, a, ml, item.lj ?? 2)) : paths;
      };
    default:
      return null;
  }
}

function modStatic(item: ShapeItem): boolean {
  switch (item.ty) {
    case 'tm':
      return isStatic(item.s) && isStatic(item.e) && isStatic(item.o);
    case 'rd':
      return isStatic(item.r);
    case 'zz':
      return isStatic(item.s) && isStatic(item.r) && isStatic(item.pt);
    case 'pb':
    case 'tw':
      return isStatic(item.a) && isStatic(item.c);
    case 'op':
      return isStatic(item.a);
    default:
      return true;
  }
}

function repeaterStatic(item: ShapeItem): boolean {
  const tr = item.tr ?? {};
  return (
    isStatic(item.c) &&
    isStatic(item.o) &&
    isStatic(tr.p) &&
    isStatic(tr.a) &&
    isStatic(tr.s) &&
    isStatic(tr.r) &&
    isStatic(tr.so) &&
    isStatic(tr.eo)
  );
}

function repeaterMatrix(tr: Transform, n: number, frame: number): Matrix {
  const p = evaluate(tr.p, frame) ?? [0, 0];
  const a = evaluate(tr.a, frame) ?? [0, 0];
  const s = evaluate(tr.s, frame) ?? [100, 100];
  const r = scalar(evaluate(tr.r, frame)) ?? 0;
  const ax = Array.isArray(a) ? a[0] ?? 0 : 0;
  const ay = Array.isArray(a) ? a[1] ?? 0 : 0;
  let m = translation((Array.isArray(p) ? p[0] ?? 0 : 0) * n, (Array.isArray(p) ? p[1] ?? 0 : 0) * n);
  if (ax || ay) m = multiply(m, translation(ax, ay));
  if (r) m = multiply(m, rotation(r * n));
  const sx = Math.pow((Array.isArray(s) ? s[0] ?? 100 : 100) / 100, n);
  const sy = Math.pow((Array.isArray(s) ? s[1] ?? s[0] ?? 100 : 100) / 100, n);
  if (sx !== 1 || sy !== 1) m = multiply(m, scaling(sx, sy));
  if (ax || ay) m = multiply(m, translation(-ax, -ay));
  return m;
}

function clonePath(p: PathData): PathData {
  return { c: p.c, v: p.v, i: p.i, o: p.o };
}

function applyRepeater(
  item: ShapeItem,
  frame: number,
  groupMatrix: Matrix,
  ctx: Ctx,
  startIdx: number
): void {
  const count = Math.max(0, Math.round(scalar(evaluate(item.c, frame)) ?? 0));
  const offset = scalar(evaluate(item.o, frame)) ?? 0;
  const tr = item.tr ?? {};
  const so = tr.so ? (scalar(evaluate(tr.so, frame)) ?? 100) / 100 : 1;
  const eo = tr.eo ? (scalar(evaluate(tr.eo, frame)) ?? 100) / 100 : 1;
  const originals = ctx.ops.splice(startIdx);
  if (!count || !originals.length) return;
  const inv = invert(groupMatrix);
  const stat = repeaterStatic(item);
  for (let k = 0; k < count; k++) {
    const n = offset + k;
    const world = multiply(multiply(groupMatrix, repeaterMatrix(tr, n, frame)), inv);
    const alphaMul = count > 1 ? so + (eo - so) * (k / (count - 1)) : so;
    for (const op of originals) {
      const matrix = multiply(world, op.matrix);
      if (op.kind === 'shape') {
        ctx.ops.push({
          kind: 'shape',
          paths: k === 0 ? op.paths : op.paths.map(clonePath),
          matrix,
          fills: op.fills.map((f) => ({ ...f, alpha: f.alpha * alphaMul })),
          strokes: op.strokes.map((s) => ({ ...s, alpha: s.alpha * alphaMul })),
          clips: op.clips,
          blend: op.blend,
          static: op.static && stat,
        });
      } else {
        ctx.ops.push({ ...op, matrix, alpha: op.alpha * alphaMul, static: op.static && stat });
      }
    }
  }
}

function shapeItems(
  items: ShapeItem[],
  frame: number,
  matrix: Matrix,
  opacity: number,
  staticMatrix: boolean,
  ctx: Ctx,
  inherited: ShapeItem[]
): void {
  const startOps = ctx.ops.length;
  const paths: PathData[] = [];
  const fills: FillPaint[] = [];
  const strokes: StrokePaint[] = [];
  const subgroups: ShapeItem[] = [];
  const mods: ShapeItem[] = [...inherited];
  const repeaters: ShapeItem[] = [];
  let mergeMode = 0;
  let geomStatic = true;

  for (const item of items) {
    if (!item || item.hd) continue;
    switch (item.ty) {
      case 'gr':
        if (hasStyles(item)) subgroups.push(item);
        else if (!collectPaths(item, frame, null, paths)) geomStatic = false;
        break;
      case 'sh':
      case 'el':
      case 'rc':
      case 'sr': {
        const g = geomOf(item, frame);
        if (g) {
          paths.push(g.path);
          if (!g.static) geomStatic = false;
        }
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
        const g = gradientPaint(item, frame, opacityOf(item, frame) * opacity);
        if (g) fills.push(g);
        break;
      }
      case 'st': {
        strokes.push({
          kind: 'color',
          color: colorOf(evaluate(item.c, frame)),
          ...strokeBase(item, frame, opacity),
        });
        break;
      }
      case 'gs': {
        const g = gradientPaint(item, frame, 1);
        if (g) {
          const base = strokeBase(item, frame, opacity);
          strokes.push({ ...g, ...base, alpha: base.alpha });
        }
        break;
      }
      case 'tm':
      case 'rd':
      case 'zz':
      case 'pb':
      case 'tw':
      case 'op': {
        mods.push(item);
        if (!modStatic(item)) geomStatic = false;
        break;
      }
      case 'rp':
        repeaters.push(item);
        break;
      case 'mm':
        mergeMode = item.mm ?? 1;
        break;
      default:
        break;
    }
  }

  let outPaths = paths;
  for (const item of mods) {
    const mod = modOf(item);
    if (mod) outPaths = mod(outPaths, frame);
  }
  let mergeClips: Clip[] | undefined;
  if ((mergeMode === 2 || mergeMode === 3 || mergeMode === 4) && outPaths.length > 1) {
    const solved = strokes.length
      ? mergePathsBoolean(outPaths, mergeMode as 2 | 3 | 4)
      : null;
    if (solved) {
      outPaths = solved;
      geomStatic = false;
    } else if (mergeMode === 3 || mergeMode === 4) {
      mergeClips = [
        { shapes: [{ paths: outPaths.slice(1), matrix }], mode: mergeMode === 3 ? 2 : 1 },
      ];
      outPaths = [outPaths[0]];
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
    shapeItems(groupItems, frame, groupMatrix, groupOpacity, groupStatic, ctx, mods);
  }

  if (outPaths.length && (fills.length || strokes.length)) {
    if (mergeMode === 5) {
      for (const f of fills) f.rule = 2;
    }
    ctx.ops.push({
      kind: 'shape',
      paths: outPaths,
      matrix,
      fills,
      strokes,
      clips: mergeClips,
      static: staticMatrix && geomStatic,
    });
  }

  for (let i = repeaters.length - 1; i >= 0; i--) {
    applyRepeater(repeaters[i], frame, matrix, ctx, startOps);
  }
}

function strokeBase(item: ShapeItem, frame: number, opacity: number) {
  const base: {
    alpha: number;
    width: number;
    cap: number;
    join: number;
    miter?: number;
    dash?: number[];
    dashOffset?: number;
  } = {
    alpha: opacityOf(item, frame) * opacity,
    width: scalar(evaluate(item.w, frame)) ?? 1,
    cap: item.lc ?? 1,
    join: item.lj ?? 1,
  };
  if (typeof item.ml === 'number' && item.ml) base.miter = item.ml;
  if (Array.isArray(item.d) && item.d.length) {
    const arr: number[] = [];
    let off = 0;
    for (const seg of item.d) {
      const val = scalar(evaluate(seg?.v, frame)) ?? 0;
      if (seg?.n === 'o') off = val;
      else arr.push(Math.max(0, val));
    }
    if (arr.some((v) => v > 0)) {
      base.dash = arr;
      if (off) base.dashOffset = off;
    }
  }
  return base;
}

function gradientPaint(item: ShapeItem, frame: number, alpha: number): GradientPaint | null {
  const stops = gradientStops(item.g, frame);
  if (!stops.length) return null;
  const g: GradientPaint = {
    kind: item.t === 2 ? 'radial' : 'linear',
    s: evaluate(item.s, frame) ?? [0, 0],
    e: evaluate(item.e, frame) ?? [0, 0],
    stops,
    alpha,
    rule: item.r === 2 ? 2 : 1,
  };
  if (item.t === 2) {
    const h = scalar(evaluate(item.h, frame));
    const a = scalar(evaluate(item.a, frame));
    if (h) g.h = Math.max(-0.99, Math.min(0.99, h / 100));
    if (a) g.a = a;
  }
  return g;
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
