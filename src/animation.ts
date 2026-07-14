import { sceneAt } from './scene/evaluate.js';
import type { LottieData, Marker } from './model/types.js';
import type { Scene } from './ir.js';

export class Animation {
  readonly data: LottieData;

  constructor(data: LottieData) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.layers)) {
      throw new TypeError('Not a Lottie animation: expected an object with a "layers" array');
    }
    this.data = data;
  }

  get name(): string {
    return this.data.nm ?? '';
  }

  get version(): string {
    return this.data.v ?? '';
  }

  get width(): number {
    return this.data.w;
  }

  get height(): number {
    return this.data.h;
  }

  get frameRate(): number {
    return this.data.fr ?? 30;
  }

  get inPoint(): number {
    return this.data.ip ?? 0;
  }

  get outPoint(): number {
    return this.data.op ?? 0;
  }

  get totalFrames(): number {
    return this.outPoint - this.inPoint;
  }

  get duration(): number {
    return this.frameRate ? this.totalFrames / this.frameRate : 0;
  }

  get markers(): Marker[] {
    return this.data.markers ?? [];
  }

  frameAtTime(seconds: number): number {
    const total = this.totalFrames;
    if (!total) return this.inPoint;
    const f = (seconds * this.frameRate) % total;
    return this.inPoint + (f < 0 ? f + total : f);
  }

  frameAtProgress(t: number): number {
    return this.inPoint + Math.min(1, Math.max(0, t)) * this.totalFrames;
  }

  sceneAt(frame: number = this.inPoint): Scene {
    return sceneAt(this.data, frame);
  }
}
