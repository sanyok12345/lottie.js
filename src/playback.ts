import { Emitter } from './events.js';
import type { Animation } from './animation.js';
import type { RenderOptions, Surface } from './surface/surface.js';

export type PlaybackMode = 'forward' | 'reverse' | 'bounce';

export interface PlaybackOptions {
  animation: Animation;
  surface: Surface<any>;
  render?: RenderOptions;
  loop?: boolean;
  speed?: number;
  mode?: PlaybackMode;
  segment?: [number, number];
  autoplay?: boolean;
  respectReducedMotion?: boolean;
}

export interface FrameEvent {
  frame: number;
  progress: number;
}

interface PlaybackEvents {
  frame: FrameEvent;
  loop: void;
  complete: void;
  error: any;
}

export class Playback {
  frame: number;
  playing = false;

  private anim: Animation;
  private surface: Surface<any>;
  private opts: RenderOptions;
  private lo: number;
  private hi: number;
  private dir: 1 | -1;
  private loop: boolean;
  private speed: number;
  private mode: PlaybackMode;
  private emitter = new Emitter<PlaybackEvents>();
  private rafId: number | null = null;
  private lastNow = 0;
  private resolveFinished!: () => void;
  private _finished: Promise<void>;

  constructor(o: PlaybackOptions) {
    this.anim = o.animation;
    this.surface = o.surface;
    this.opts = o.render ?? {};
    const [lo, hi] = o.segment ?? [o.animation.inPoint, o.animation.outPoint];
    this.lo = lo;
    this.hi = hi;
    this.loop = o.loop ?? false;
    this.speed = o.speed ?? 1;
    this.mode = o.mode ?? 'forward';
    this.dir = this.mode === 'reverse' ? -1 : 1;
    this.frame = this.dir === -1 ? hi : lo;
    this._finished = new Promise((res) => (this.resolveFinished = res));

    if (o.respectReducedMotion) {
      this.frame = hi;
      this.renderFrame();
      return;
    }
    this.renderFrame();
    if (o.autoplay) this.start();
  }

  get progress(): number {
    const span = this.hi - this.lo;
    return span ? (this.frame - this.lo) / span : 0;
  }

  get finished(): Promise<void> {
    return this._finished;
  }

  tick(dtMs: number): void {
    if (!this.playing) return;
    const span = this.hi - this.lo || 1;
    let f = this.frame + (dtMs / 1000) * this.anim.frameRate * this.speed * this.dir;

    while (f > this.hi || f < this.lo) {
      if (f > this.hi) {
        if (this.mode === 'bounce') {
          f = this.hi - (f - this.hi);
          this.dir = -1;
          this.emitter.emit('loop', undefined);
        } else if (this.loop) {
          f = this.lo + ((f - this.lo) % span);
          this.emitter.emit('loop', undefined);
        } else {
          f = this.hi;
          this.finish();
          break;
        }
      } else if (f < this.lo) {
        if (this.mode === 'bounce') {
          f = this.lo + (this.lo - f);
          this.dir = 1;
          this.emitter.emit('loop', undefined);
        } else if (this.loop) {
          f = this.hi - ((this.lo - f) % span);
          this.emitter.emit('loop', undefined);
        } else {
          f = this.lo;
          this.finish();
          break;
        }
      }
    }

    this.frame = f;
    this.renderFrame();
    this.emitter.emit('frame', { frame: f, progress: this.progress });
  }

  play(): void {
    if (!this.playing) this.start();
  }

  pause(): void {
    this.playing = false;
    this.cancelRaf();
  }

  start(): void {
    this.playing = true;
    const raf = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number })
      .requestAnimationFrame;
    if (!raf) return;
    this.lastNow = 0;
    const step = (now: number): void => {
      if (!this.playing) return;
      if (this.lastNow) this.tick(now - this.lastNow);
      this.lastNow = now;
      this.rafId = raf(step);
    };
    this.rafId = raf(step);
  }

  stop(): void {
    this.pause();
    this.frame = this.dir === -1 ? this.hi : this.lo;
    this.renderFrame();
  }

  seek(frame: number): void {
    this.frame = Math.min(this.hi, Math.max(this.lo, frame));
    this.renderFrame();
    this.emitter.emit('frame', { frame: this.frame, progress: this.progress });
  }

  seekTime(seconds: number): void {
    this.seek(this.anim.frameAtTime(seconds));
  }

  on<K extends keyof PlaybackEvents>(type: K, cb: (payload: PlaybackEvents[K]) => void): () => void {
    return this.emitter.on(type, cb);
  }

  destroy(): void {
    this.pause();
    this.emitter.clear();
    this.surface.dispose();
  }

  private renderFrame(): void {
    try {
      this.surface.render(this.anim, this.frame, this.opts);
    } catch (err) {
      this.emitter.emit('error', err);
    }
  }

  private finish(): void {
    this.playing = false;
    this.cancelRaf();
    this.emitter.emit('complete', undefined);
    this.resolveFinished();
  }

  private cancelRaf(): void {
    const cancel = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
    if (this.rafId !== null && cancel) cancel(this.rafId);
    this.rafId = null;
  }
}
