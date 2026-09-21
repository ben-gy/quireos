/**
 * Dependency-free PNG encoder for 4-bit palette images with a 16-entry grey ramp — the format the
 * device decodes fastest (§6.2 `image`). Deflate comes from the platform's `CompressionStream`.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of `bytes`, optionally continuing from `seed`. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const enc = new TextEncoder();

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(enc.encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib-wrapped deflate via `CompressionStream("deflate")` (Workers, Node ≥ 18, browsers). */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** The 16-entry grey ramp used by `encodePng4`: index `i` → grey `i * 17`. */
export const GREY16_PALETTE: Uint8Array = (() => {
  const p = new Uint8Array(48);
  for (let i = 0; i < 16; i++) p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = i * 17;
  return p;
})();

/**
 * Encodes `w × h` 4-bit indices (0 = black … 15 = white, one per byte) as a palette PNG:
 * IHDR (bit depth 4, colour type 3), PLTE grey ramp, one IDAT, IEND. No alpha, no interlace.
 */
export async function encodePng4(indices: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  if (indices.length < w * h) throw new Error(`encodePng4: expected ${w * h} indices, got ${indices.length}`);
  const stride = Math.ceil(w / 2);
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x += 2) {
      const hi = indices[y * w + x]! & 0x0f;
      const lo = x + 1 < w ? indices[y * w + x + 1]! & 0x0f : 0;
      raw[row + 1 + (x >> 1)] = (hi << 4) | lo;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 4; // bit depth
  ihdr[9] = 3; // palette
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = await deflate(raw);
  return concat([SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", GREY16_PALETTE), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

/** Encodes an 8-bit greyscale PNG (colour type 0) from a grey plane; also accepted by the device. */
export async function encodePngGrey8(grey: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  if (grey.length < w * h) throw new Error(`encodePngGrey8: expected ${w * h} bytes, got ${grey.length}`);
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(grey.subarray(y * w, y * w + w), y * (w + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const idat = await deflate(raw);
  return concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}
