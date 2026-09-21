import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { crc32, encodePng4, encodePngGrey8, GREY16_PALETTE } from "../src/png/encode.js";
import { quantize16, quantizeGrey } from "../src/png/quantize.js";
import { pngInfo } from "../src/validate.js";

describe("crc32", () => {
  it("matches the reference value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("quantize16", () => {
  it("maps black and white without dither", () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 0]);
    expect(Array.from(quantize16(rgba, 4, 1, { dither: "none" }))).toEqual([0, 15, 8, 15]);
  });
  it("composites alpha on white and applies gamma", () => {
    const rgba = new Uint8Array([0, 0, 0, 128]);
    expect(quantize16(rgba, 1, 1, { dither: "none" })[0]).toBe(7);
    expect(quantize16(new Uint8Array([100, 100, 100, 255]), 1, 1, { dither: "none", gamma: 0.5 })[0]).toBe(9);
  });
  it("dithers a flat mid-grey to the right average", () => {
    const w = 64;
    const h = 64;
    const grey = new Uint8Array(w * h).fill(40); // 40/17 = 2.35 → mix of 2 and 3
    const idx = quantizeGrey(grey, w, h, { dither: "fs" });
    const avg = idx.reduce((a, b) => a + b, 0) / (w * h);
    expect(avg).toBeGreaterThan(2.25);
    expect(avg).toBeLessThan(2.45);
    expect(new Set(idx).size).toBe(2);
  });
});

describe("encodePng4", () => {
  it("round-trips through pngjs", async () => {
    const w = 37;
    const h = 11;
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < idx.length; i++) idx[i] = i % 16;
    const bytes = await encodePng4(idx, w, h);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const info = pngInfo(bytes)!;
    expect(info).toEqual({ width: w, height: h, bitDepth: 4, colorType: 3, hasAlpha: false });
    const png = PNG.sync.read(Buffer.from(bytes));
    expect(png.width).toBe(w);
    expect(png.height).toBe(h);
    for (let i = 0; i < w * h; i++) {
      const g = idx[i]! * 17;
      expect(png.data[i * 4]).toBe(g);
      expect(png.data[i * 4 + 1]).toBe(g);
      expect(png.data[i * 4 + 2]).toBe(g);
      expect(png.data[i * 4 + 3]).toBe(255);
    }
    expect(GREY16_PALETTE[45]).toBe(255);
  });
  it("encodes 8-bit grey too", async () => {
    const grey = new Uint8Array([0, 64, 128, 255]);
    const bytes = await encodePngGrey8(grey, 2, 2);
    expect(pngInfo(bytes)).toMatchObject({ width: 2, height: 2, bitDepth: 8, colorType: 0 });
    const png = PNG.sync.read(Buffer.from(bytes));
    expect([png.data[0], png.data[4], png.data[8], png.data[12]]).toEqual([0, 64, 128, 255]);
  });
});

const roboto = new URL("../../../firmware/fonts/Roboto-Regular.ttf", import.meta.url);
describe.skipIf(!existsSync(roboto))("renderPng (satori + resvg)", () => {
  it("renders text to a 16-grey PNG", async () => {
    const { initRenderer, renderPng, h } = await import("../src/png/render.js");
    const require = createRequire(import.meta.url);
    const yoga = readFileSync(require.resolve("satori/yoga.wasm"));
    const resvg = readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
    await initRenderer({ yoga, resvg });
    await initRenderer({ yoga, resvg }); // idempotent
    const font = readFileSync(roboto);
    const node = h("div", { style: { display: "flex", width: 200, height: 100, background: "white", color: "black", fontSize: 40, fontFamily: "Roboto", alignItems: "center", justifyContent: "center" } }, "Hi");
    const bytes = await renderPng(node, { w: 200, h: 100, fonts: [{ name: "Roboto", data: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), weight: 400, style: "normal" }], dither: "none" });
    const info = pngInfo(bytes)!;
    expect(info).toMatchObject({ width: 200, height: 100, bitDepth: 4, colorType: 3 });
    const png = PNG.sync.read(Buffer.from(bytes));
    let dark = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i]! < 128) dark++;
    expect(dark).toBeGreaterThan(50); // some ink
    expect(dark).toBeLessThan(200 * 100 * 0.5); // mostly paper
  }, 30_000);
});
