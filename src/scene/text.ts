import { evaluate, scalar } from '../model/property.js';
import type { Layer, LottieData, ShapeItem } from '../model/types.js';

export interface GlyphDef {
  shapes: ShapeItem[];
  w: number;
}

export interface TextEnv {
  chars: Map<string, GlyphDef>;
  fonts: Map<string, { fFamily?: string; fStyle?: string; ascent?: number }>;
}

export interface TextDoc {
  t?: string;
  f?: string;
  s?: number;
  fc?: number[];
  sc?: number[];
  sw?: number;
  of?: boolean;
  j?: number;
  tr?: number;
  lh?: number;
  ls?: number;
  ps?: number[];
  sz?: number[];
}

export interface PlacedGlyph {
  glyph: GlyphDef;
  x: number;
  y: number;
  scale: number;
  charIndex: number;
}

export function textEnv(data: LottieData): TextEnv | null {
  if (!Array.isArray(data.chars) || !data.chars.length) return null;
  const chars = new Map<string, GlyphDef>();
  for (const c of data.chars) {
    if (!c || typeof c.ch !== 'string') continue;
    chars.set(glyphKey(c.ch, c.fFamily ?? '', c.style ?? ''), {
      shapes: c.data?.shapes ?? [],
      w: typeof c.w === 'number' ? c.w : 0,
    });
  }
  const fonts = new Map<string, { fFamily?: string; fStyle?: string; ascent?: number }>();
  for (const f of data.fonts?.list ?? []) {
    if (f?.fName) fonts.set(f.fName, f);
  }
  return { chars, fonts };
}

const glyphKey = (ch: string, family: string, style: string): string =>
  ch + ' ' + family + ' ' + style;

export function textDocAt(layer: Layer, frame: number): TextDoc | undefined {
  const d = layer.t?.d;
  if (!d) return undefined;
  const k = d.k;
  if (!Array.isArray(k)) return k as TextDoc | undefined;
  let doc: TextDoc | undefined;
  for (const kf of k) {
    if (kf && typeof kf.t === 'number' && kf.t <= frame && kf.s) doc = kf.s;
    if (kf && typeof kf.t === 'number' && kf.t > frame) break;
  }
  return doc ?? k[0]?.s;
}

export function isStaticDoc(layer: Layer): boolean {
  const k = layer.t?.d?.k;
  return !Array.isArray(k) || k.length <= 1;
}

export interface CharMod {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  opacity: number;
  fcColor?: number[];
  fcF?: number;
}

function shapeFactor(shape: number, u: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  if (u < lo || u >= hi) return 0;
  const t = (u - lo) / (hi - lo);
  switch (shape) {
    case 2:
      return t;
    case 3:
      return 1 - t;
    case 4:
      return 1 - Math.abs(t * 2 - 1);
    case 5:
      return Math.sqrt(Math.max(0, 1 - (t * 2 - 1) ** 2));
    case 6: {
      const x = 1 - Math.abs(t * 2 - 1);
      return x * x * (3 - 2 * x);
    }
    default:
      return 1;
  }
}

export function hasAnimators(layer: Layer): boolean {
  const a = layer.t?.a;
  return Array.isArray(a) && a.length > 0;
}

export function textAnimators(
  layer: Layer,
  frame: number,
  chars: PlacedGlyph[],
  totalChars: number
): CharMod[] | null {
  const anims = layer.t?.a;
  if (!Array.isArray(anims) || !anims.length || !chars.length) return null;
  const mods: CharMod[] = chars.map(() => ({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, opacity: 1 }));

  for (const an of anims) {
    if (!an) continue;
    const sel = an.s ?? {};
    const props = an.a ?? {};
    const sVal = scalar(evaluate(sel.s, frame)) ?? 0;
    const eVal = sel.e !== undefined ? scalar(evaluate(sel.e, frame)) ?? 100 : 100;
    const oVal = scalar(evaluate(sel.o, frame)) ?? 0;
    const amount = sel.a !== undefined ? (scalar(evaluate(sel.a, frame)) ?? 100) / 100 : 1;
    const shape = sel.sh ?? 1;
    const units = sel.r ?? 1;

    const p = evaluate(props.p, frame);
    const sc = evaluate(props.s, frame);
    const rot = scalar(evaluate(props.r, frame)) ?? 0;
    const op = props.o !== undefined ? scalar(evaluate(props.o, frame)) : undefined;
    const fc = props.fc ? evaluate(props.fc, frame) : undefined;
    const trk = scalar(evaluate(props.t, frame)) ?? 0;

    let lo = sVal + oVal;
    let hi = eVal + oVal;
    if (hi < lo) [lo, hi] = [hi, lo];

    let cumTrack = 0;
    for (let ci = 0; ci < chars.length; ci++) {
      const idx = chars[ci].charIndex;
      const u = units === 2 ? idx : ((idx + 0.5) / Math.max(1, totalChars)) * 100;
      const f = shapeFactor(shape, u, lo, hi) * amount;
      if (trk) {
        cumTrack += trk * f;
        mods[ci].dx += cumTrack;
      }
      if (!f) continue;
      const m = mods[ci];
      if (Array.isArray(p)) {
        m.dx += (p[0] ?? 0) * f;
        m.dy += (p[1] ?? 0) * f;
      }
      if (Array.isArray(sc)) {
        m.sx *= 1 + ((sc[0] ?? 100) / 100 - 1) * f;
        m.sy *= 1 + (((sc[1] ?? sc[0] ?? 100) as number) / 100 - 1) * f;
      }
      if (rot) m.rot += rot * f;
      if (op !== undefined && op !== null) m.opacity *= 1 + (op / 100 - 1) * f;
      if (Array.isArray(fc)) {
        m.fcColor = fc;
        m.fcF = Math.min(1, Math.max(0, f));
      }
    }
  }
  return mods;
}

export function layoutText(doc: TextDoc, env: TextEnv): PlacedGlyph[] {
  const text = String(doc.t ?? '');
  if (!text) return [];
  const size = doc.s ?? 12;
  const scale = size / 100;
  const tracking = ((doc.tr ?? 0) / 1000) * size;
  const lineHeight = doc.lh ?? size * 1.2;
  const font = doc.f ? env.fonts.get(doc.f) : undefined;
  const family = font?.fFamily ?? '';
  const style = font?.fStyle ?? '';
  const boxWidth = Array.isArray(doc.sz) ? doc.sz[0] : undefined;
  const origin: [number, number] = Array.isArray(doc.ps)
    ? [doc.ps[0] ?? 0, (doc.ps[1] ?? 0) + lineHeight]
    : [0, 0];

  const advanceOf = (ch: string): { glyph: GlyphDef | undefined; adv: number } => {
    if (ch === ' ') {
      const g = env.chars.get(glyphKey(' ', family, style));
      return { glyph: g, adv: (g ? g.w : 33.3) * scale };
    }
    const g = env.chars.get(glyphKey(ch, family, style));
    return { glyph: g, adv: (g ? g.w : 60) * scale };
  };

  const paragraphs = text.split(/\r\n|\r|\n|\u0003/);
  const lines: Array<Array<{ ch: string; glyph: GlyphDef | undefined; adv: number; charIndex: number }>> = [];
  let charIndex = 0;

  for (const para of paragraphs) {
    if (boxWidth) {
      let current: Array<{ ch: string; glyph: GlyphDef | undefined; adv: number; charIndex: number }> = [];
      let width = 0;
      let wordStart = 0;
      const flush = () => {
        while (current.length && current[current.length - 1].ch === ' ') current.pop();
        lines.push(current);
        current = [];
        width = 0;
        wordStart = 0;
      };
      for (const ch of para) {
        const { glyph, adv } = advanceOf(ch);
        if (width + adv > boxWidth && current.length) {
          if (ch === ' ') {
            flush();
            charIndex++;
            continue;
          }
          if (wordStart > 0 && wordStart < current.length) {
            const carried = current.splice(wordStart);
            flush();
            current = carried;
            for (const c of current) width += c.adv + tracking;
          } else {
            flush();
          }
        }
        current.push({ ch, glyph, adv, charIndex });
        width += adv + tracking;
        if (ch === ' ') wordStart = current.length;
        charIndex++;
      }
      flush();
    } else {
      const line: Array<{ ch: string; glyph: GlyphDef | undefined; adv: number; charIndex: number }> = [];
      for (const ch of para) {
        const { glyph, adv } = advanceOf(ch);
        line.push({ ch, glyph, adv, charIndex });
        charIndex++;
      }
      lines.push(line);
    }
    charIndex++;
  }

  const placed: PlacedGlyph[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let lineWidth = 0;
    for (const item of line) lineWidth += item.adv + tracking;
    if (line.length) lineWidth -= tracking;
    const shift = doc.j === 1 ? -lineWidth : doc.j === 2 ? -lineWidth / 2 : 0;
    let pen = origin[0] + (boxWidth && doc.j ? (doc.j === 1 ? boxWidth : boxWidth / 2) : 0) + shift;
    const y = origin[1] + li * lineHeight + (doc.ls ?? 0);
    for (const item of line) {
      if (item.glyph && item.ch !== ' ') {
        placed.push({ glyph: item.glyph, x: pen, y, scale, charIndex: item.charIndex });
      }
      pen += item.adv + tracking;
    }
  }
  return placed;
}
