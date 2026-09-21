/** RGBA → 16-grey palette indices (0 = black … 15 = white), optionally Floyd–Steinberg dithered. */

export interface QuantizeOptions {
  /** Gamma applied to luma before quantising (`1` = none; ~`1.2` lightens mid-greys on e-paper). */
  gamma?: number;
  /** `fs` Floyd–Steinberg error diffusion (default) or `none` for nearest level. */
  dither?: "fs" | "none";
}

/**
 * Converts `w × h` RGBA pixels to 4-bit grey indices. Alpha is composited on white. Luma uses
 * Rec. 709 weights. Returns one index per pixel (`Uint8Array` of length `w * h`).
 */
export function quantize16(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: QuantizeOptions = {}): Uint8Array {
  if (rgba.length < w * h * 4) throw new Error(`quantize16: expected ${w * h * 4} bytes, got ${rgba.length}`);
  const gamma = opts.gamma ?? 1;
  const dither = opts.dither ?? "fs";
  const out = new Uint8Array(w * h);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = gamma === 1 ? i : 255 * Math.pow(i / 255, gamma);

  // luma plane (float, 0..255)
  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = rgba[p + 3]! / 255;
    const r = rgba[p]! * a + 255 * (1 - a);
    const g = rgba[p + 1]! * a + 255 * (1 - a);
    const b = rgba[p + 2]! * a + 255 * (1 - a);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = lut[Math.round(Math.min(255, Math.max(0, y)))]!;
  }

  if (dither === "none") {
    for (let i = 0; i < w * h; i++) out[i] = clampIdx(Math.round(luma[i]! / 17));
    return out;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = luma[i]!;
      const idx = clampIdx(Math.round(old / 17));
      out[i] = idx;
      const err = old - idx * 17;
      if (x + 1 < w) luma[i + 1]! += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) luma[i + w - 1]! += (err * 3) / 16;
        luma[i + w]! += (err * 5) / 16;
        if (x + 1 < w) luma[i + w + 1]! += (err * 1) / 16;
      }
    }
  }
  return out;
}

function clampIdx(v: number): number {
  return v < 0 ? 0 : v > 15 ? 15 : v;
}

/** Convenience: an 8-bit grey plane (0..255) to indices, no colour conversion. */
export function quantizeGrey(grey: Uint8Array, w: number, h: number, opts: QuantizeOptions = {}): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = grey[i]!;
    rgba[p + 3] = 255;
  }
  return quantize16(rgba, w, h, opts);
}
