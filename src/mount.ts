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
  return new Playback({
    animation,
    surface,
    render: opts.render,
    loop: opts.loop,
    speed: opts.speed,
    mode: opts.mode,
    segment: opts.segment,
    autoplay: opts.autoplay ?? true,
    respectReducedMotion: opts.respectReducedMotion,
  });
}
