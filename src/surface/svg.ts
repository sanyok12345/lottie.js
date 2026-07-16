import { type RenderOptions, type Surface } from './surface.js';
import { fmt } from '../util.js';
import { rgb } from '../math/color.js';
import { isIdentity, toSvg } from '../math/matrix.js';
import type { Animation } from '../animation.js';
import type { Clip, FillPaint, GradientPaint, PathData, StrokePaint } from '../ir.js';

const CAPS: Record<number, string> = { 1: 'butt', 2: 'round', 3: 'square' };
const JOINS: Record<number, string> = { 1: 'miter', 2: 'round', 3: 'bevel' };
const BLEND: Record<number, string> = {
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
};

export class SvgSurface implements Surface<string> {
  render(anim: Animation, frame?: number, options: RenderOptions = {}): string {
    const scene = anim.sceneAt(frame);
    const width = Number(options.width ?? scene.width);
    const height = Number(options.height ?? scene.height);
    const ctx: Defs = {
      defs: [],
      nextId: 0,
      idPrefix: String(options.idPrefix ?? 'lj').replace(/[^\w-]/g, ''),
      sceneW: scene.width,
      sceneH: scene.height,
    };

    let body = '';
    for (const op of scene.ops) {
      let inner = '';
      if (op.kind === 'image') {
        if (op.alpha <= 0) continue;
        inner =
          `<image href="${escapeAttr(op.src)}" width="${fmt(op.width)}" height="${fmt(op.height)}"` +
          `${op.alpha < 1 ? ` opacity="${fmt(op.alpha)}"` : ''} preserveAspectRatio="none"/>`;
      } else {
        const d = op.paths.map(pathToD).filter(Boolean).join(' ');
        if (!d) continue;
        for (const fill of op.fills) {
          if (fill.alpha <= 0) continue;
          inner += `<path d="${d}" ${fillAttrs(fill, ctx)} stroke="none"/>`;
        }
        for (const stroke of op.strokes) {
          if (stroke.alpha <= 0 || !stroke.width) continue;
          inner += `<path d="${d}" fill="none" ${strokeAttrs(stroke, ctx)}/>`;
        }
      }
      if (!inner) continue;
      let out = isIdentity(op.matrix) ? inner : `<g transform="${toSvg(op.matrix)}">${inner}</g>`;
      const blend = op.blend !== undefined ? BLEND[op.blend] : undefined;
      if (op.clips?.length) {
        const wrapped = wrapClips(out, op.clips, ctx);
        if (wrapped === null) continue;
        out = wrapped;
      }
      if (blend) out = `<g style="mix-blend-mode:${blend}">${out}</g>`;
      body += out;
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
  sceneW: number;
  sceneH: number;
}

function wrapClips(inner: string, clips: Clip[], ctx: Defs): string | null {
  let out = inner;
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i];
    const subtractive = clip.mode === 2 || clip.mode === 3;
    let content = '';
    for (const shape of clip.shapes) {
      const d = shape.paths.map(pathToD).filter(Boolean).join(' ');
      if (!d) continue;
      const tr = isIdentity(shape.matrix) ? '' : ` transform="${toSvg(shape.matrix)}"`;
      content += `<path d="${d}"${tr}${subtractive ? ' clip-rule="evenodd"' : ''}/>`;
    }
    if (!content) {
      if (clip.mode === 1) return null;
      continue;
    }
    const id = `${ctx.idPrefix}-clip-${ctx.nextId++}`;
    if (subtractive) {
      const pad = Math.max(ctx.sceneW, ctx.sceneH) * 4;
      content =
        `<path d="M${fmt(-pad)},${fmt(-pad)}h${fmt(pad * 2 + ctx.sceneW)}v${fmt(pad * 2 + ctx.sceneH)}` +
        `h${fmt(-(pad * 2 + ctx.sceneW))}Z" clip-rule="evenodd"/>` + content;
      ctx.defs.push(`<clipPath id="${id}" clip-rule="evenodd">${content}</clipPath>`);
    } else {
      ctx.defs.push(`<clipPath id="${id}">${content}</clipPath>`);
    }
    out = `<g clip-path="url(#${id})">${out}</g>`;
    if (clip.mode === 1 && clip.alpha !== undefined && clip.alpha < 1) {
      out = `<g opacity="${fmt(clip.alpha)}">${out}</g>`;
    }
  }
  return out;
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
    paint = `fill="${rgb(fill.color)}"`;
  } else {
    paint = `fill="url(#${gradientDef(fill, ctx)})"`;
  }
  if (fill.alpha < 1) paint += ` fill-opacity="${fmt(Math.max(0, fill.alpha))}"`;
  if (fill.rule === 2) paint += ' fill-rule="evenodd"';
  return paint;
}

function strokeAttrs(s: StrokePaint, ctx: Defs): string {
  const paint = s.kind === 'color' ? rgb(s.color) : `url(#${gradientDef(s, ctx)})`;
  let attrs = `stroke="${paint}" stroke-width="${fmt(s.width ?? 1)}"`;
  if (s.alpha < 1) attrs += ` stroke-opacity="${fmt(Math.max(0, s.alpha))}"`;
  const cap = CAPS[s.cap ?? 1];
  if (cap && cap !== 'butt') attrs += ` stroke-linecap="${cap}"`;
  const join = JOINS[s.join ?? 1];
  if (join && join !== 'miter') attrs += ` stroke-linejoin="${join}"`;
  if (s.miter && s.miter !== 4) attrs += ` stroke-miterlimit="${fmt(s.miter)}"`;
  if (s.dash?.length) {
    attrs += ` stroke-dasharray="${s.dash.map(fmt).join(' ')}"`;
    if (s.dashOffset) attrs += ` stroke-dashoffset="${fmt(s.dashOffset)}"`;
  }
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
    let focal = '';
    if (g.h) {
      const ang =
        Math.atan2((g.e[1] ?? 0) - (g.s[1] ?? 0), (g.e[0] ?? 0) - (g.s[0] ?? 0)) +
        ((g.a ?? 0) * Math.PI) / 180;
      focal = ` fx="${fmt(g.s[0] + Math.cos(ang) * g.h * r)}" fy="${fmt(g.s[1] + Math.sin(ang) * g.h * r)}"`;
    }
    ctx.defs.push(
      `<radialGradient ${common} cx="${fmt(g.s[0])}" cy="${fmt(g.s[1])}" r="${fmt(r)}"${focal}>${stops}</radialGradient>`
    );
  } else {
    ctx.defs.push(
      `<linearGradient ${common} x1="${fmt(g.s[0])}" y1="${fmt(g.s[1])}" x2="${fmt(g.e[0])}" y2="${fmt(g.e[1])}">${stops}</linearGradient>`
    );
  }
  return id;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
