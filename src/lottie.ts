export { parse } from './parse.js';
export { load } from './load.js';
export { Animation } from './animation.js';
export { Playback } from './playback.js';
export { mount } from './mount.js';
export { Emitter } from './events.js';

export { CanvasSurface } from './surface/canvas.js';
export { SvgSurface } from './surface/svg.js';
export { ImageSurface } from './surface/image/image.js';
export { encodePNG } from './surface/image/png.js';

export type { Surface, RenderOptions } from './surface/surface.js';
export type { PlaybackOptions, PlaybackMode, FrameEvent } from './playback.js';
export type { LoadOptions } from './load.js';
export type { MountOptions } from './mount.js';
export type { Matrix } from './math/matrix.js';
export type {
  Scene,
  DrawOp,
  FillPaint,
  ColorPaint,
  GradientPaint,
  GradientStop,
  PathData,
  Point,
} from './ir.js';
export type { LottieData, Layer, Asset, Marker } from './model/types.js';
export type { AnimationSource, BinarySource, RGBAImage } from './types.js';
