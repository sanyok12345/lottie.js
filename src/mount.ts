import { load } from './load.js';
import { CanvasSurface } from './surface/canvas.js';
import { Playback } from './playback.js';
import type { Animation } from './animation.js';
import type { AnimationSource } from './types.js';
import type { RenderOptions } from './surface/surface.js';
import type { PlaybackMode } from './playback.js';

export interface MountOptions {
  canvas: { getContext(id: '2d'): CanvasRenderingContext2D | null };
  src?: AnimationSource | string | URL;
  animation?: Animation;
  render?: RenderOptions;
  loop?: boolean;
  speed?: number;
  mode?: PlaybackMode;
  segment?: [number, number];
  autoplay?: boolean;
  respectReducedMotion?: boolean;
}

export async function mount(opts: MountOptions): Promise<Playback> {
  const animation = opts.animation ?? (await load(opts.src as AnimationSource | string | URL));
  const ctx = opts.canvas.getContext('2d');
  if (!ctx) throw new Error('mount: canvas has no 2d context');
  const surface = new CanvasSurface(ctx);
  let render = opts.render;
  const dpr = render?.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const canvas = opts.canvas as {
    width?: number;
    height?: number;
    style?: { width: string; height: string };
  };
  if (dpr !== 1 && render?.width === undefined && typeof canvas.width === 'number' && typeof canvas.height === 'number') {
    const cssW = canvas.width;
    const cssH = canvas.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (canvas.style) {
      if (!canvas.style.width) canvas.style.width = `${cssW}px`;
      if (!canvas.style.height) canvas.style.height = `${cssH}px`;
    }
    render = { ...render, width: canvas.width, height: canvas.height };
  }
  return new Playback({
    animation,
    surface,
    render,
    loop: opts.loop,
    speed: opts.speed,
    mode: opts.mode,
    segment: opts.segment,
    autoplay: opts.autoplay ?? true,
    respectReducedMotion: opts.respectReducedMotion,
  });
}
