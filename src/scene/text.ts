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
