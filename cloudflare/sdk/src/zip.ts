/**
 * Minimal zip support for bundles (§9): read `stored` and `deflate` entries, write `stored`
 * archives. Enough for `validateBundle` inputs and the app bundle scripts; not a general library.
 */
import { concat, crc32 } from "./png/encode.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** Extracts a zip into `Map<name, bytes>`. Directory entries are skipped. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // locate end of central directory
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
  }
  return out;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Writes a `stored` (uncompressed) zip; entries are emitted in map order. */
export function writeZip(files: Map<string, Uint8Array>, when: Date = new Date(2026, 0, 1)): Uint8Array {
  const { time, date } = dosTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0x0800, true); // UTF-8 names
    ldv.setUint16(8, 0, true);
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, date, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.size, true);
  edv.setUint16(10, files.size, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);
  return concat([...locals, ...centrals, eocd]);
}
