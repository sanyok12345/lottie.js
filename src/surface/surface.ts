import type { Animation } from '../animation.js';

export interface RenderOptions {
  width?: number;
  height?: number;
  dpr?: number;
  idPrefix?: string;
}

export interface Surface<Out = void> {
  render(anim: Animation, frame?: number, options?: RenderOptions): Out;
  dispose(): void;
}

export function outputSize(
  sceneW: number,
  sceneH: number,
  opts: RenderOptions
): { width: number; height: number; sx: number; sy: number } {
  const width = Number(opts.width ?? sceneW);
  const height = Number(opts.height ?? sceneH);
  return { width, height, sx: width / (sceneW || width), sy: height / (sceneH || height) };
}
