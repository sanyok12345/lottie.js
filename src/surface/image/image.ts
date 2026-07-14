import { rasterize } from './raster.js';
import { encodePNG } from './png.js';
import { type RenderOptions, type Surface } from '../surface.js';
import type { Animation } from '../../animation.js';
import type { RGBAImage } from '../../types.js';

export class ImageSurface implements Surface<RGBAImage> {
  private width?: number;
  private height?: number;

  constructor(width?: number, height?: number) {
    this.width = width;
    this.height = height;
  }

  render(anim: Animation, frame?: number, options: RenderOptions = {}): RGBAImage {
    return rasterize(anim.sceneAt(frame), {
      width: options.width ?? this.width,
      height: options.height ?? this.height,
    });
  }

  async png(anim: Animation, frame?: number, options: RenderOptions = {}): Promise<Uint8Array> {
    const img = this.render(anim, frame, options);
    return encodePNG(img.data, img.width, img.height);
  }

  dispose(): void { }
}
