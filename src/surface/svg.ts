import { type RenderOptions, type Surface } from './surface.js';
import { fmt } from '../util.js';
import { rgb } from '../math/color.js';
import { isIdentity, toSvg } from '../math/matrix.js';
import type { Animation } from '../animation.js';
import type { ColorPaint, FillPaint, GradientPaint, PathData } from '../ir.js';

const CAPS: Record<number, string> = { 1: 'butt', 2: 'round', 3: 'square' };
const JOINS: Record<number, string> = { 1: 'miter', 2: 'round', 3: 'bevel' };

export class SvgSurface implements Surface<string> {
  render(anim: Animation, frame?: number, options: RenderOptions = {}): string {
    const scene = anim.sceneAt(frame);
    const width = Number(options.width ?? scene.width);
    const height = Number(options.height ?? scene.height);
    const ctx: Defs = { defs: [], nextId: 0, idPrefix: String(options.idPrefix ?? 'lj').replace(/[^\w-]/g, '') };

    let body = '';
    for (const op of scene.ops) {
      const d = op.paths.map(pathToD).filter(Boolean).join(' ');
      if (!d) continue;
      let inner = '';
      for (const fill of op.fills) {
        if (fill.alpha <= 0) continue;
        inner += `<path d="${d}" ${fillAttrs(fill, ctx)} stroke="none"/>`;
      }
      for (const stroke of op.strokes) {
        if (stroke.alpha <= 0 || !stroke.width) continue;
        inner += `<path d="${d}" fill="none" ${strokeAttrs(stroke)}/>`;
      }
      if (!inner) continue;
      body += isIdentity(op.matrix) ? inner : `<g transform="${toSvg(op.matrix)}">${inner}</g>`;
    }

    const defs = ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" ` +
      `viewBox="0 0 ${fmt(scene.width)} ${fmt(scene.height)}">${defs}${body}</svg>`
    );
  }

  dispose(): void { }
}

interface Defs {
  defs: string[];
  nextId: number;
  idPrefix: string;
}

export function pathToD(path: PathData): string {
  const { v, c } = path;
  if (!Array.isArray(v) || v.length === 0) return '';
  const inT = path.i ?? [];
  const outT = path.o ?? [];
  const n = v.length;
  let d = `M${fmt(v[0][0])},${fmt(v[0][1])}`;
  for (let j = 1; j < n; j++) d += curveTo(v[j - 1], outT[j - 1], v[j], inT[j]);
  if (c && n > 1) {
    d += curveTo(v[n - 1], outT[n - 1], v[0], inT[0]);
    d += 'Z';
  }
  return d;
}

function curveTo(p0: number[], out: number[] = [0, 0], p1: number[], inn: number[] = [0, 0]): string {
  return (
    `C${fmt(p0[0] + (out[0] ?? 0))},${fmt(p0[1] + (out[1] ?? 0))}` +
    ` ${fmt(p1[0] + (inn[0] ?? 0))},${fmt(p1[1] + (inn[1] ?? 0))}` +
    ` ${fmt(p1[0])},${fmt(p1[1])}`
  );
}

function fillAttrs(fill: FillPaint, ctx: Defs): string {
  let paint: string;
  if (fill.kind === 'color') {
    paint = `fill="${rgb((fill as ColorPaint).color)}"`;
  } else {
    paint = `fill="url(#${gradientDef(fill, ctx)})"`;
  }
  if (fill.alpha < 1) paint += ` fill-opacity="${fmt(Math.max(0, fill.alpha))}"`;
  if (fill.rule === 2) paint += ' fill-rule="evenodd"';
  return paint;
}

function strokeAttrs(s: ColorPaint): string {
  let attrs = `stroke="${rgb(s.color)}" stroke-width="${fmt(s.width ?? 1)}"`;
  if (s.alpha < 1) attrs += ` stroke-opacity="${fmt(Math.max(0, s.alpha))}"`;
  const cap = CAPS[s.cap ?? 1];
  if (cap && cap !== 'butt') attrs += ` stroke-linecap="${cap}"`;
  const join = JOINS[s.join ?? 1];
  if (join && join !== 'miter') attrs += ` stroke-linejoin="${join}"`;
  return attrs;
}

function gradientDef(g: GradientPaint, ctx: Defs): string {
  const id = `${ctx.idPrefix}-grad-${ctx.nextId++}`;
  const stops = g.stops
    .map(
      (s) =>
        `<stop offset="${fmt(s.p * 100)}%" stop-color="rgb(${s.r},${s.g},${s.b})"` +
        `${s.a < 1 ? ` stop-opacity="${fmt(s.a)}"` : ''}/>`
    )
    .join('');
  const common = `id="${id}" gradientUnits="userSpaceOnUse"`;
  if (g.kind === 'radial') {
    const r = Math.hypot((g.e[0] ?? 0) - (g.s[0] ?? 0), (g.e[1] ?? 0) - (g.s[1] ?? 0));
    ctx.defs.push(`<radialGradient ${common} cx="${fmt(g.s[0])}" cy="${fmt(g.s[1])}" r="${fmt(r)}">${stops}</radialGradient>`);
  } else {
    ctx.defs.push(
      `<linearGradient ${common} x1="${fmt(g.s[0])}" y1="${fmt(g.s[1])}" x2="${fmt(g.e[0])}" y2="${fmt(g.e[1])}">${stops}</linearGradient>`
    );
  }
  return id;
}
