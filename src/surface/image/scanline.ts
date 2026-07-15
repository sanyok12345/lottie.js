import { LUT_SIZE, type DevicePaint } from './paint.js';
import type { Ring } from './flatten.js';
import type { RGBAImage } from '../../types.js';

const SUBS = 4;
const SUB_COVER = 1 / SUBS;

let cached: Raster | null = null;

export function getRaster(w: number, h: number): Raster {
  if (!cached || cached.w !== w || cached.h !== h) cached = new Raster(w, h);
  return cached;
}

type BlendFn = (b: number, s: number) => number;

const BLENDS: Record<number, BlendFn> = {
  1: (b, s) => b * s,
  2: (b, s) => b + s - b * s,
  3: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  4: (b, s) => Math.min(b, s),
  5: (b, s) => Math.max(b, s),
  6: (b, s) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s))),
  7: (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  8: (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  9: (b, s) =>
    s <= 0.5
      ? b - (1 - 2 * s) * b * (1 - b)
      : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  10: (b, s) => Math.abs(b - s),
  11: (b, s) => b + s - 2 * b * s,
  16: (b, s) => Math.min(1, b + s),
};

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
  private clipBuf: Float32Array | null = null;
  private stageBuf: Float32Array | null = null;

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

  acquireClipBuf(): Float32Array {
    if (!this.clipBuf) this.clipBuf = new Float32Array(this.w * this.h);
    this.clipBuf.fill(1);
    return this.clipBuf;
  }

  acquireStageBuf(): Float32Array {
    if (!this.stageBuf) this.stageBuf = new Float32Array(this.w * this.h);
    this.stageBuf.fill(0);
    return this.stageBuf;
  }

  fillRings(
    rings: Ring[],
    rule: number,
    paint: DevicePaint,
    clip: Float32Array | null = null,
    blend = 0
  ): void {
    const blendFn = blend ? BLENDS[blend] : undefined;
    this.scan(rings, rule, paint, clip, blendFn, null);
  }

  coverageRings(rings: Ring[], out: Float32Array): void {
    this.scan(rings, 1, null, null, undefined, out);
  }

  private coverageRow(py: number, x0: number, x1: number, out: Float32Array): void {
    const cov = this.cov;
    const off = py * this.w;
    for (let x = x0; x <= x1; x++) {
      const c = cov[x];
      if (c > 0) {
        cov[x] = 0;
        out[off + x] = c > 1 ? 1 : c;
      }
    }
  }

  private scan(
    rings: Ring[],
    rule: number,
    paint: DevicePaint,
    clip: Float32Array | null,
    blendFn: BlendFn | undefined,
    covOut: Float32Array | null
  ): void {
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

      if (rowMax >= rowMin) {
        if (covOut) this.coverageRow(py, rowMin, rowMax, covOut);
        else if (blendFn) this.blendRowMixed(py, rowMin, rowMax, paint, clip, blendFn);
        else this.blendRow(py, rowMin, rowMax, paint, clip);
      }
    }
  }

  private gradT(paint: DevicePaint, x: number, py: number): number {
    let t: number;
    if (paint.grad === 'focal') {
      const dx = x + 0.5 - paint.fx;
      const dy = py + 0.5 - paint.fy;
      const fcx = paint.fx - paint.cx;
      const fcy = paint.fy - paint.cy;
      const dd = dx * dx + dy * dy;
      if (!dd) return 0;
      const dfc = dx * fcx + dy * fcy;
      const disc = dfc * dfc - dd * (fcx * fcx + fcy * fcy - paint.r * paint.r);
      const denom = -dfc + Math.sqrt(Math.max(0, disc));
      t = denom > 0 ? dd / denom : 1;
    } else if (paint.grad === 'radial') {
      const dx = x + 0.5 - paint.gx;
      const dy = py + 0.5 - paint.gy;
      t = Math.sqrt(dx * dx + dy * dy) * paint.invR;
    } else {
      t = (x + 0.5 - paint.gx) * paint.gdx + (py + 0.5 - paint.gy) * paint.gdy;
    }
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t;
  }

  blendRow(
    py: number,
    x0: number,
    x1: number,
    paint: DevicePaint,
    clip: Float32Array | null
  ): void {
    const { buf, cov, w } = this;
    const rowOff = py * w * 4;
    const clipOff = py * w;

    if (!paint.grad) {
      const pa = paint.a;
      const pr = paint.r;
      const pg = paint.g;
      const pb = paint.b;
      if (!clip) {
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
      for (let x = x0; x <= x1; x++) {
        let c = cov[x];
        if (c > 0) {
          cov[x] = 0;
          if (c > 1) c = 1;
          c *= clip[clipOff + x];
          if (c <= 0) continue;
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
    for (let x = x0; x <= x1; x++) {
      let c = cov[x];
      if (c <= 0) continue;
      cov[x] = 0;
      if (c > 1) c = 1;
      if (clip) {
        c *= clip[clipOff + x];
        if (c <= 0) continue;
      }

      const t = this.gradT(paint, x, py);
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

  private blendRowMixed(
    py: number,
    x0: number,
    x1: number,
    paint: DevicePaint,
    clip: Float32Array | null,
    blendFn: BlendFn
  ): void {
    const { buf, cov, w } = this;
    const rowOff = py * w * 4;
    const clipOff = py * w;
    const lut = paint.grad ? paint.lut : null;

    for (let x = x0; x <= x1; x++) {
      let c = cov[x];
      if (c <= 0) continue;
      cov[x] = 0;
      if (c > 1) c = 1;
      if (clip) c *= clip[clipOff + x];
      if (c <= 0) continue;

      let sr: number;
      let sg: number;
      let sb: number;
      let as: number;
      if (lut) {
        const t = this.gradT(paint, x, py);
        const li = (t * (LUT_SIZE - 1)) << 2;
        const la = lut[li + 3] / 255;
        as = la * c;
        sr = la > 0 ? lut[li] / 255 / la : 0;
        sg = la > 0 ? lut[li + 1] / 255 / la : 0;
        sb = la > 0 ? lut[li + 2] / 255 / la : 0;
      } else {
        as = paint.a * c;
        sr = paint.r / 255;
        sg = paint.g / 255;
        sb = paint.b / 255;
      }
      if (as <= 0) continue;

      const idx = rowOff + x * 4;
      const ab = buf[idx + 3] / 255;
      const br = ab > 0 ? buf[idx] / 255 / ab : 0;
      const bg = ab > 0 ? buf[idx + 1] / 255 / ab : 0;
      const bb = ab > 0 ? buf[idx + 2] / 255 / ab : 0;

      const rr = as * (1 - ab) * sr + as * ab * blendFn(br, sr) + (1 - as) * ab * br;
      const rg = as * (1 - ab) * sg + as * ab * blendFn(bg, sg) + (1 - as) * ab * bg;
      const rb = as * (1 - ab) * sb + as * ab * blendFn(bb, sb) + (1 - as) * ab * bb;
      const ra = as + ab * (1 - as);

      buf[idx] = rr * 255;
      buf[idx + 1] = rg * 255;
      buf[idx + 2] = rb * 255;
      buf[idx + 3] = ra * 255;
    }
  }

  drawImage(
    img: RGBAImage,
    m: number[],
    alpha: number,
    clip: Float32Array | null,
    blend = 0
  ): void {
    const { buf, w, h } = this;
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return;
    const id = 1 / det;
    const i0 = m[3] * id;
    const i1 = -m[1] * id;
    const i2 = -m[2] * id;
    const i3 = m[0] * id;
    const i4 = (m[2] * m[5] - m[3] * m[4]) * id;
    const i5 = (m[1] * m[4] - m[0] * m[5]) * id;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (const [cx, cy] of [[0, 0], [img.width, 0], [0, img.height], [img.width, img.height]]) {
      const dx = m[0] * cx + m[2] * cy + m[4];
      const dy = m[1] * cx + m[3] * cy + m[5];
      if (dx < minX) minX = dx;
      if (dx > maxX) maxX = dx;
      if (dy < minY) minY = dy;
      if (dy > maxY) maxY = dy;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));

    const data = img.data;
    const iw = img.width;
    const ih = img.height;
    const blendFn = blend ? BLENDS[blend] : undefined;

    for (let py = y0; py <= y1; py++) {
      const clipOff = py * w;
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        const u = i0 * cx + i2 * cy + i4 - 0.5;
        const v = i1 * cx + i3 * cy + i5 - 0.5;
        if (u < -1 || v < -1 || u > iw || v > ih) continue;

        const uf = Math.floor(u);
        const vf = Math.floor(v);
        const fu = u - uf;
        const fv = v - vf;
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy <= 1; dy++) {
          const sy = vf + dy;
          if (sy < 0 || sy >= ih) continue;
          const wy = dy ? fv : 1 - fv;
          for (let dx = 0; dx <= 1; dx++) {
            const sx = uf + dx;
            if (sx < 0 || sx >= iw) continue;
            const wt = wy * (dx ? fu : 1 - fu);
            if (!wt) continue;
            const si = (sy * iw + sx) * 4;
            const sa = (data[si + 3] / 255) * wt;
            r += data[si] * sa;
            g += data[si + 1] * sa;
            b += data[si + 2] * sa;
            a += sa;
          }
        }
        let sa = a * alpha;
        if (clip) sa *= clip[clipOff + px];
        if (sa <= 0) continue;
        if (sa > 1) sa = 1;
        const scale = a > 0 ? sa / a : 0;

        const idx = (py * w + px) * 4;
        if (blendFn) {
          const ab = buf[idx + 3] / 255;
          const br = ab > 0 ? buf[idx] / 255 / ab : 0;
          const bg = ab > 0 ? buf[idx + 1] / 255 / ab : 0;
          const bb = ab > 0 ? buf[idx + 2] / 255 / ab : 0;
          const sr = a > 0 ? r / a / 255 : 0;
          const sg = a > 0 ? g / a / 255 : 0;
          const sb = a > 0 ? b / a / 255 : 0;
          buf[idx] = (sa * (1 - ab) * sr + sa * ab * blendFn(br, sr) + (1 - sa) * ab * br) * 255;
          buf[idx + 1] = (sa * (1 - ab) * sg + sa * ab * blendFn(bg, sg) + (1 - sa) * ab * bg) * 255;
          buf[idx + 2] = (sa * (1 - ab) * sb + sa * ab * blendFn(bb, sb) + (1 - sa) * ab * bb) * 255;
          buf[idx + 3] = (sa + ab * (1 - sa)) * 255;
        } else {
          const ia = 1 - sa;
          buf[idx] = buf[idx] * ia + r * scale;
          buf[idx + 1] = buf[idx + 1] * ia + g * scale;
          buf[idx + 2] = buf[idx + 2] * ia + b * scale;
          buf[idx + 3] = buf[idx + 3] * ia + 255 * sa;
        }
      }
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
