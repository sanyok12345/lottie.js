import { parse } from './parse.js';
import type { Animation } from './animation.js';
import type { AnimationSource } from './types.js';

export interface LoadOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export async function load(
  src: AnimationSource | string | URL,
  opts: LoadOptions = {}
): Promise<Animation> {
  if (src instanceof URL) return parse(await fetchBytes(src.href, opts));
  if (typeof src === 'string') {
    const t = src.trimStart();
    if (t[0] === '{' || t[0] === '[') return parse(src);
    return parse(await fetchBytes(src, opts));
  }
  return parse(src);
}

async function fetchBytes(url: string, opts: LoadOptions): Promise<Uint8Array> {
  const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error('load: no fetch available; pass one via options');
  const res = await f(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`load: fetch ${url} failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
