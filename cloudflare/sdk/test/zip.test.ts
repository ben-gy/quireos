import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../src/zip.js";
import { validateBundle } from "../src/validate.js";
import { encodePng4 } from "../src/png/encode.js";

describe("zip", () => {
  it("round-trips stored archives", async () => {
    const enc = new TextEncoder();
    const files = new Map<string, Uint8Array>([
      ["manifest.json", enc.encode('{"a":1}')],
      ["dir/x.bin", new Uint8Array([0, 1, 2, 255])],
      ["empty.txt", new Uint8Array(0)],
    ]);
    const zip = writeZip(files);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const back = await readZip(zip);
    expect([...back.keys()]).toEqual([...files.keys()]);
    for (const [k, v] of files) expect(Array.from(back.get(k)!)).toEqual(Array.from(v));
  });
  it("reads deflated entries", async () => {
    // zlib.deflateRawSync("hello hello hello") in a hand-assembled zip
    const raw = new Uint8Array(deflateRawSync("hello hello hello"));
    const name = new TextEncoder().encode("h.txt");
    const crc = 0x2d7c5c5e; // placeholder, not checked by reader
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(8, 8, true); l.setUint32(14, crc, true);
    l.setUint32(18, raw.length, true); l.setUint32(22, 17, true); l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, crc, true); c.setUint32(20, raw.length, true); c.setUint32(24, 17, true);
    c.setUint16(28, name.length, true); c.setUint32(42, 0, true);
    ch.set(name, 46);
    const eocd = new Uint8Array(22);
    const e = new DataView(eocd.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, ch.length, true); e.setUint32(16, lh.length + raw.length, true);
    const zip = new Uint8Array([...lh, ...raw, ...ch, ...eocd]);
    const back = await readZip(zip);
    expect(new TextDecoder().decode(back.get("h.txt"))).toBe("hello hello hello");
  });
  it("feeds validateBundle", async () => {
    const enc = new TextEncoder();
    const files = new Map<string, Uint8Array>([
      ["manifest.json", enc.encode(JSON.stringify({ spec_version: 1, id: "z", name: "Z", version: "1.0.0", min_os: "0.1.0", icon: "star", entry: "/z/s.json" }))],
      ["s.json", enc.encode(JSON.stringify({ spec_version: 1, id: "s", widgets: [] }))],
      ["icon.png", await encodePng4(new Uint8Array(96 * 96), 96, 96)],
    ]);
    expect(validateBundle(await readZip(writeZip(files))).errors).toEqual([]);
  });
});
