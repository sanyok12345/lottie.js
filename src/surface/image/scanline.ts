import { LUT_SIZE, type DevicePaint } from './paint.js';
import type { Ring } from './flatten.js';

const SUBS = 4;
const SUB_COVER = 1 / SUBS;

let cached: Raster | null = null;

export function getRaster(w: number, h: number): Raster {
  if (!cached || cached.w !== w || cached.h !== h) cached = new Raster(w, h);
  return cached;
}

export class Raster {
  w: number;
  h: number;
  buf: Uint8ClampedArray;
  out: Uint8ClampedArray;
  cov: Float32Array;
  cap!: number;
  ex!: Float64Array;
  eslope!: Float64Array;
  ey0!: Float64Array;
  ey1!: Float64Array;
  edir!: Int8Array;
  order: Int32Array;
  xs: Float64Array;
  ws: Int8Array;
  active: Int32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8ClampedArray(w * h * 4);
    this.out = new Uint8ClampedArray(w * h * 4);
    this.cov = new Float32Array(w + 2);
    this.growEdges(1024);
    this.xs = new Float64Array(256);
    this.ws = new Int8Array(256);
    this.active = new Int32Array(256);
    this.order = new Int32Array(1024);
  }

  growEdges(n: number): void {
    this.cap = n;
    this.ex = new Float64Array(n);
    this.eslope = new Float64Array(n);
    this.ey0 = new Float64Array(n);
    this.ey1 = new Float64Array(n);
    this.edir = new Int8Array(n);
    this.order = new Int32Array(n);
  }

  clear(): void {
    this.buf.fill(0);
  }

  fillRings(rings: Ring[], rule: number, paint: DevicePaint): void {
    const { w, h } = this;

    let ne = 0;
    let minY = h;
    let maxY = 0;
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let x0 = ring[i * 2];
        let y0 = ring[i * 2 + 1];
        let x1 = ring[j * 2];
        let y1 = ring[j * 2 + 1];
        if (y0 === y1) continue;
        let dir = 1;
        if (y0 > y1) {
          [x0, x1] = [x1, x0];
          [y0, y1] = [y1, y0];
          dir = -1;
        }
        if (y1 <= 0 || y0 >= h) continue;
        if (ne >= this.cap) {
          const [ex, es, e0, e1, ed] = [this.ex, this.eslope, this.ey0, this.ey1, this.edir];
          this.growEdges(this.cap * 2);
          this.ex.set(ex); this.eslope.set(es); this.ey0.set(e0); this.ey1.set(e1); this.edir.set(ed);
        }
        this.ex[ne] = x0;
        this.eslope[ne] = (x1 - x0) / (y1 - y0);
        this.ey0[ne] = y0;
        this.ey1[ne] = y1;
        this.edir[ne] = dir;
        ne++;
        if (y0 < minY) minY = y0;
        if (y1 > maxY) maxY = y1;
      }
    }
    if (!ne) return;

    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(h - 1, Math.ceil(maxY));

    const order = this.order;
    for (let i = 0; i < ne; i++) order[i] = i;
    const ey0 = this.ey0;
    order.subarray(0, ne).sort((a, b) => ey0[a] - ey0[b]);

    if (this.active.length < ne) this.active = new Int32Array(ne);
    if (this.xs.length < ne) {
      this.xs = new Float64Array(ne);
      this.ws = new Int8Array(ne);
    }
    const active = this.active;
    const xs = this.xs;
    const ws = this.ws;
    const cov = this.cov;
    let nActive = 0;
    let ptr = 0;

    for (let py = yStart; py <= yEnd; py++) {
      let rowMin = w;
      let rowMax = -1;

      for (let sub = 0; sub < SUBS; sub++) {
        const ys = py + (sub + 0.5) / SUBS;

        while (ptr < ne && ey0[order[ptr]] <= ys) active[nActive++] = order[ptr++];

        let nx = 0;
        let write = 0;
        for (let i = 0; i < nActive; i++) {
          const e = active[i];
          if (this.ey1[e] <= ys) continue;
          active[write++] = e;
          if (this.ey0[e] <= ys) {
            xs[nx] = this.ex[e] + (ys - this.ey0[e]) * this.eslope[e];
            ws[nx] = this.edir[e];
            nx++;
          }
        }
        nActive = write;
        if (nx < 2) continue;

        for (let i = 1; i < nx; i++) {
          const x = xs[i];
          const wd = ws[i];
          let k = i - 1;
          while (k >= 0 && xs[k] > x) {
            xs[k + 1] = xs[k];
            ws[k + 1] = ws[k];
            k--;
          }
          xs[k + 1] = x;
          ws[k + 1] = wd;
        }

        let winding = 0;
        for (let i = 0; i < nx - 1; i++) {
          winding += ws[i];
          const inside = rule === 2 ? (i & 1) === 0 : winding !== 0;
          if (!inside) continue;
          let xa = xs[i];
          let xb = xs[i + 1];
          if (xb <= 0 || xa >= w) continue;
          if (xa < 0) xa = 0;
          if (xb > w) xb = w;
          if (xb <= xa) continue;

          const ia = Math.floor(xa);
          const ib = Math.min(Math.floor(xb), w - 1);
          if (ia === ib) {
            cov[ia] += (xb - xa) * SUB_COVER;
          } else {
            cov[ia] += (ia + 1 - xa) * SUB_COVER;
            for (let x = ia + 1; x < ib; x++) cov[x] += SUB_COVER;
            cov[ib] += (xb - ib) * SUB_COVER;
          }
          if (ia < rowMin) rowMin = ia;
          if (ib > rowMax) rowMax = ib;
        }
      }

      if (rowMax >= rowMin) this.blendRow(py, rowMin, rowMax, paint);
    }
  }

  blendRow(py: number, x0: number, x1: number, paint: DevicePaint): void {
    const { buf, cov, w } = this;
    const rowOff = py * w * 4;

    if (!paint.grad) {
      const pa = paint.a;
      const pr = paint.r;
      const pg = paint.g;
      const pb = paint.b;
      for (let x = x0; x <= x1; x++) {
        let c = cov[x];
        if (c > 0) {
          cov[x] = 0;
          if (c > 1) c = 1;
          const a = c * pa;
          const ia = 1 - a;
          const idx = rowOff + x * 4;
          buf[idx] = buf[idx] * ia + pr * a;
          buf[idx + 1] = buf[idx + 1] * ia + pg * a;
          buf[idx + 2] = buf[idx + 2] * ia + pb * a;
          buf[idx + 3] = buf[idx + 3] * ia + 255 * a;
        }
      }
      return;
    }

    const lut = paint.lut;
    const radial = paint.grad === 'radial';
    for (let x = x0; x <= x1; x++) {
      let c = cov[x];
      if (c <= 0) continue;
      cov[x] = 0;
      if (c > 1) c = 1;

      let t;
      if (radial) {
        const dx = x + 0.5 - paint.gx;
        const dy = py + 0.5 - paint.gy;
        t = Math.sqrt(dx * dx + dy * dy) * paint.invR;
      } else {
        t = (x + 0.5 - paint.gx) * paint.gdx + (py + 0.5 - paint.gy) * paint.gdy;
      }
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const li = (t * (LUT_SIZE - 1)) << 2;

      const a = (lut[li + 3] / 255) * c;
      const ia = 1 - a;
      const idx = rowOff + x * 4;
      buf[idx] = buf[idx] * ia + lut[li] * c;
      buf[idx + 1] = buf[idx + 1] * ia + lut[li + 1] * c;
      buf[idx + 2] = buf[idx + 2] * ia + lut[li + 2] * c;
      buf[idx + 3] = buf[idx + 3] * ia + 255 * a;
    }
  }

  unpremultiplied(): Uint8ClampedArray {
    const { buf, out } = this;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3];
      if (a === 0) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      } else if (a === 255) {
        out[i] = buf[i];
        out[i + 1] = buf[i + 1];
        out[i + 2] = buf[i + 2];
        out[i + 3] = 255;
      } else {
        const inv = 255 / a;
        out[i] = buf[i] * inv;
        out[i + 1] = buf[i + 1] * inv;
        out[i + 2] = buf[i + 2] * inv;
        out[i + 3] = a;
      }
    }
    return out;
  }
}
