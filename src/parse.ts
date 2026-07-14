import { Animation } from './animation.js';
import type { AnimationSource } from './types.js';

/** Parse Lottie JSON (object, string, or UTF-8 bytes) into an Animation. */
export function parse(source: AnimationSource): Animation {
  if (typeof source === 'string') return new Animation(JSON.parse(source));
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return new Animation(JSON.parse(new TextDecoder().decode(source)));
  }
  return new Animation(source);
}
