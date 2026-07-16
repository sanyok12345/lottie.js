# lottie.js

A fast, dependency-free Lottie engine for every JavaScript runtime and environment.

lottie.js parses a Lottie (Bodymovin) document into a renderer-agnostic scene
and draws that scene to Canvas2D, SVG, or raw pixels. It has no runtime
dependencies and makes no assumption about its host: no `node:` modules, no
DOM, no I/O in the core. It runs in the browser, on a server, in React Native,
Deno, Bun, and Web Workers, and it can render to PNG on a server without a
headless browser.

The project is pre-1.0 and covers a growing subset of the format; see
[Supported features](#supported-features).

[Install](#install) · [Quick start](#quick-start) · [How it works](#how-it-works) · [API](#api) · [Features](#supported-features)

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Loading a document](#loading-a-document)
- [Surfaces](#surfaces)
- [Playback](#playback)
- [Using it](#using-it)
  - [Browser](#browser)
  - [Server](#server)
  - [React](#react)
  - [Custom renderers](#custom-renderers)
- [API](#api)
- [Supported features](#supported-features)
- [License](#license)

## Install

```
npm install lottie.js
```

ESM and CommonJS are both supported.

```js
import { parse } from 'lottie.js';       // ESM
const { parse } = require('lottie.js');   // CommonJS
```

## Quick start

```js
import { parse, CanvasSurface } from 'lottie.js';

const anim = parse(json);
const surface = new CanvasSurface(canvas.getContext('2d'));

surface.render(anim, 0);                          // draw frame 0
surface.render(anim, 30, { width: 512, height: 512 });
```

On a server, render straight to PNG bytes:

```js
import { parse, ImageSurface } from 'lottie.js';

const anim = parse(json);
const png = await new ImageSurface(512, 512).png(anim, 0);
```

## How it works

There are three stages, kept separate.

1. **Parse.** `parse(json)` returns an immutable `Animation`: the document
   plus metadata (`width`, `height`, `frameRate`, `duration`, and so on).
2. **Evaluate.** `anim.sceneAt(frame)` resolves one frame into a `Scene`: a
   flat list of draw operations (geometry, transform, fills, strokes). The
   scene is the contract every surface consumes; it depends on nothing in the
   environment.
3. **Render.** A surface draws a scene. `CanvasSurface` issues native
   `Path2D` calls, `SvgSurface` returns an SVG string, `ImageSurface`
   rasterizes to pixels in pure JavaScript.

A `Playback` drives frames over time on top of a surface. Nothing above the
surface layer touches the DOM, so the same code renders on a server or in a
worker.

## Loading a document

`parse` is synchronous and does no I/O. Give it a parsed object, a JSON
string, or UTF-8 bytes.

```js
const anim = parse(await readFile('animation.json'));
```

`load` is the asynchronous form: it fetches a URL, otherwise it parses
directly.

```js
import { load } from 'lottie.js';

const anim = await load('https://example.com/animation.json');
```

## Surfaces

A surface is a drawing target of one kind. It holds its own state, so one
`Animation` can feed several surfaces at once. Every surface has
`render(anim, frame?, options?)` and `dispose()`.

`CanvasSurface` draws into a `CanvasRenderingContext2D`. It is the fast path
for playback in the browser and respects the context transform, so you can
tile it.

```js
const surface = new CanvasSurface(ctx);
surface.render(anim, frame, { width, height });
```

`SvgSurface` returns a string. Use it for static output or `image/svg+xml`.

```js
const svg = new SvgSurface().render(anim, frame, { width, height });
```

`ImageSurface` rasterizes to straight-alpha RGBA pixels, and encodes PNG on
top. This is server-side rendering with no native code and no browser.

```js
const image = new ImageSurface(512, 512);
const { data, width, height } = image.render(anim, frame); // RGBA
const png = await image.png(anim, frame);                  // PNG bytes
```

`render` options are `width`, `height`, `dpr`, (for SVG) `idPrefix`, and (for
`ImageSurface`) `images` with decoded pixels for image assets. Dimensions
default to the composition size.

## Playback

`Playback` owns time, looping, speed, and direction, and emits events. It has
no built-in clock, so it runs anywhere: `tick(dtMs)` is the primitive, and
`start()` is an optional `requestAnimationFrame` loop for the browser.

```js
import { Playback } from 'lottie.js';

const player = new Playback({
  animation: anim,
  surface,
  loop: true,
  speed: 1,
  mode: 'forward',          // 'forward' | 'reverse' | 'bounce'
  render: { width: 512, height: 512 },
});

player.play();
player.pause();
player.seek(30);
player.seekTime(1.5);

const off = player.on('frame', ({ frame, progress }) => {});
player.on('loop', () => {});
player.on('complete', () => {});
await player.finished;

player.destroy();           // stops, unsubscribes, disposes the surface
```

Drive it by hand where there is no animation frame callback:

```js
player.tick(16);            // advance ~16 ms
```

## Using it

### Browser

Without a bundler, load the single file and mount it. `mount` wires a
`CanvasSurface` and a `Playback` and starts playing.

```html
<canvas id="c" width="512" height="512"></canvas>
<script type="module">
  import { mount } from './lottie.js';
  await mount({ canvas: document.getElementById('c'), src: '/animation.json', loop: true });
</script>
```

### Server

```js
import { parse, ImageSurface } from 'lottie.js';
import { readFile, writeFile } from 'node:fs/promises';

const anim = parse(await readFile('animation.json'));
await writeFile('frame.png', await new ImageSurface(512, 512).png(anim, 30));
```

### React

The engine is not tied to any framework; a component is a few lines.

```jsx
import { useEffect, useRef } from 'react';
import { parse, CanvasSurface, Playback } from 'lottie.js';

function Lottie({ data, width = 512, height = 512 }) {
  const ref = useRef(null);
  useEffect(() => {
    const player = new Playback({
      animation: parse(data),
      surface: new CanvasSurface(ref.current.getContext('2d')),
      render: { width, height },
      loop: true,
      autoplay: true,
    });
    return () => player.destroy();
  }, [data, width, height]);
  return <canvas ref={ref} width={width} height={height} />;
}
```

### Custom renderers

Where there is no Canvas2D or DOM (React Native with Skia, WebGL, a native
backend), read the scene and issue your own draw calls.

```js
const anim = parse(data);
for (const op of anim.sceneAt(frame).ops) {
  // op.kind   : 'shape' | 'image'
  // op.matrix : [a, b, c, d, tx, ty]
  // op.paths  : cubic-bezier contours
  // op.fills  : solid colors and gradients
  // op.strokes: color or gradient, width, cap, join, dashes
  // op.clips  : optional mask/matte stages (intersect or subtract)
  // op.blend  : optional Lottie blend mode
}
```

## API

### `parse(source)`

Parse a document into an `Animation`. `source` is a parsed object, a JSON
string, or UTF-8 bytes.

### `load(source, options?)`

Asynchronous loader. Fetches a URL (string or `URL`), otherwise parses
directly. `options` are `fetch` and `signal`.

### `Animation`

Read-only: `name`, `version`, `width`, `height`, `frameRate`, `inPoint`,
`outPoint`, `totalFrames`, `duration`, `markers`.

- `frameAtTime(seconds)`: frame for a time, looped.
- `frameAtProgress(t)`: frame for progress `0..1`.
- `sceneAt(frame?)`: evaluate a frame into a `Scene`.

### Surfaces

`CanvasSurface(ctx)`, `SvgSurface()`, `ImageSurface(width?, height?)`. Each
has `render(anim, frame?, options?)` and `dispose()`; `ImageSurface` adds
`png(anim, frame?, options?)`. `encodePNG(rgba, width, height)` is available
on its own.

### `Playback(options)`

`options`: `animation`, `surface`, `loop`, `speed`, `mode`, `segment`,
`autoplay`, `respectReducedMotion`, `render`. Methods: `tick(dtMs)`,
`start()`, `stop()`, `play()`, `pause()`, `seek(frame)`, `seekTime(seconds)`,
`on(type, cb)`, `destroy()`. Properties: `frame`, `playing`, `progress`,
`finished`. Events: `frame`, `loop`, `complete`, `error`.

### `mount(options)`

Convenience for the browser. Wires a `CanvasSurface` and a `Playback`.
`options`: `canvas`, `src` or `animation`, plus the `Playback` options.

## Supported features

Supported across every surface: shape layers (paths, ellipses, rectangles,
polystars), groups, fills, strokes with caps, joins, miter limits, and dashes,
gradient fills and gradient strokes (linear and radial with highlight), trim
paths, rounded corners, repeaters, zig zag, pucker & bloat, twist, offset
paths with real joins, merge paths (fills compile to clip stages, stroked
shapes get true boolean outlines), masks with all seven modes plus opacity
and expansion, track mattes (alpha and luminance, both invertible), all blend
modes, motion blur, text layers from embedded glyphs (layout, justification,
tracking, boxed text, document keyframes, text animators with range
selectors, text on a path), image layers, slots, the full
transform stack with layer parenting and auto-orient, precompositions with
bounds clipping and collapse transform, time remapping, solid layers, and
keyframe interpolation with bezier easing, per-dimension easing, hold
keyframes, and spatial keyframes.

Image layers resolve to data URIs or URLs. `CanvasSurface` and `SvgSurface`
load them natively; for `ImageSurface`, pass decoded pixels via
`render(anim, frame, { images: { [assetId]: { data, width, height } } })`.

Expressions are supported through a pluggable evaluator: the core ships the
`setExpressionEvaluator(fn)` hook and stays eval-free, an interpreter package
provides the engine. Without an evaluator, expressions fall back to keyframed
values.

Not yet: layer effects, font-file text without embedded glyphs, and 3D
layers.

## License

[MIT](LICENSE)
