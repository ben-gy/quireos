import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { canonicalJson, countWidgets, pngInfo, validateManifest, validateScreen } from "@quireos/sdk";
import type { Screen } from "@quireos/sdk";
import { PNG } from "pngjs";
import { createFrameApp, manifest } from "../src/app.js";
import { makeRenderer } from "../src/render.js";
import type { Renderer } from "../src/render.js";
import { quoteFor, QUOTES } from "../src/quotes.js";
import { cardUrl, homeScreen, hourlySeed, parseMode } from "../src/screens.js";

const icons = (JSON.parse(readFileSync(new URL("../../../../spec/icons.json", import.meta.url), "utf8")) as { icons: string[] }).icons;
const PORTRAIT = { w: 540, h: 960 };
const LANDSCAPE = { w: 960, h: 540 };
const ORIGIN = "https://quireos-app-frame.example.workers.dev";
const require = createRequire(import.meta.url);
const fontsDir = new URL("../../../../firmware/fonts/", import.meta.url);
const haveFonts = existsSync(new URL("Roboto-Regular.ttf", fontsDir));

function check(s: Screen, label: string, screen = PORTRAIT) {
  const r = validateScreen(s, { manifest, origin: ORIGIN, icons, screen });
  expect(r.errors, `${label}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`).toEqual([]);
  expect(countWidgets(s.widgets)).toBeLessThanOrEqual(96);
  expect(new TextEncoder().encode(canonicalJson(s)).byteLength).toBeLessThan(32 * 1024);
}

function nodeRenderer(): Renderer {
  const buf = (name: string) => {
    const b = readFileSync(new URL(name, fontsDir));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  return makeRenderer({ yoga: readFileSync(require.resolve("satori/yoga.wasm")), resvg: readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")), fonts: { regular: buf("Roboto-Regular.ttf"), bold: buf("Roboto-Bold.ttf") } });
}

describe("screens", () => {
  it("validates the manifest and the home screen in both modes and orientations", () => {
    expect(validateManifest(manifest, { icons }).errors).toEqual([]);
    for (const screen of [{ w: 540, h: 960 }, { w: 960, h: 540 }]) {
      const q = homeScreen({ seed: 7, mode: "quote", screen });
      check(q, "quote");
      expect(q.refresh).toBe("full");
      expect(q.ttl).toBe(3600);
      expect(q.widgets).toHaveLength(3);
      expect(q.widgets[0]).toMatchObject({ type: "image", x: 0, y: 0, w: screen.w, h: screen.h, src: "/img/card.png?seed=7&mode=quote", ttl: 0 });
      expect(q.widgets[1]).toMatchObject({ type: "rect", x: 0, w: screen.w / 2, on_tap: { type: "submit", event: "prev", args: { seed: "{{vars.seed}}" } } });
      const i = homeScreen({ seed: 7, mode: "image", imageUrl: "https://example.com/a.jpg", screen });
      check(i, "image");
      expect(cardUrl({ seed: 7, mode: "image", imageUrl: "https://example.com/a.jpg", screen })).toBe("/img/card.png?seed=7&mode=image&u=https%3A%2F%2Fexample.com%2Fa.jpg");
    }
  });
  it("parses mode settings and picks quotes deterministically", () => {
    expect(parseMode({})).toEqual({ mode: "quote" });
    expect(parseMode({ mode: "image" })).toEqual({ mode: "quote" }); // no URL → quotes
    expect(parseMode({ mode: "image", image_url: "https://x.y/z.png" })).toEqual({ mode: "image", imageUrl: "https://x.y/z.png" });
    expect(QUOTES).toHaveLength(20);
    expect(quoteFor(21)).toBe(QUOTES[1]);
    expect(quoteFor(-1)).toBe(QUOTES[19]);
    expect(hourlySeed(3_600_000 * 5)).toBe(5);
  });
});

describe("worker", () => {
  it("steps the seed through events and serves screens with ETags", async () => {
    const app = createFrameApp(undefined);
    const res = await app.fetch(new Request(`${ORIGIN}/screens/home.json`, { headers: { "X-Screen": "540x960x16@235" } }), { DEV: "1" });
    expect(res.status).toBe(200);
    const s = (await res.json()) as Screen;
    expect(s.vars?.seed).toBe(String(hourlySeed()));
    const next = await app.fetch(new Request(`${ORIGIN}/event`, { method: "POST", body: JSON.stringify({ spec_version: 1, event: "next", screen: "home", widget: "next", args: { seed: "41" } }) }), { DEV: "1" });
    expect(((await next.json()) as Screen).vars?.seed).toBe("42");
    const prev = await app.fetch(new Request(`${ORIGIN}/event`, { method: "POST", body: JSON.stringify({ spec_version: 1, event: "prev", screen: "home", widget: "prev", args: { seed: "0" } }) }), { DEV: "1" });
    expect(((await prev.json()) as Screen).vars?.seed).toBe("-1");
    expect((await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=1`), {})).status).toBe(503);
  });
});

describe.skipIf(!haveFonts)("rendering (satori + resvg)", () => {
  it("renders a quote card as a 4-bit PNG, caches nothing in Node, and answers 304 by seed", async () => {
    const app = createFrameApp(nodeRenderer());
    const res = await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=3&mode=quote`, { headers: { "X-Screen": "540x960x16@235", Accept: "image/png" } }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const info = pngInfo(bytes)!;
    expect(info).toMatchObject({ width: 540, height: 960, bitDepth: 4, colorType: 3 });
    expect(bytes.byteLength).toBeLessThan(256 * 1024);
    const png = PNG.sync.read(Buffer.from(bytes));
    let dark = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i]! < 128) dark++;
    expect(dark).toBeGreaterThan(2000);
    expect(dark).toBeLessThan(540 * 960 * 0.4);
    const tag = res.headers.get("ETag")!;
    const again = await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=3&mode=quote`, { headers: { "X-Screen": "540x960x16@235", "If-None-Match": tag } }), {});
    expect(again.status).toBe(304);
    const land = await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=4&mode=quote`, { headers: { "X-Screen": "960x540x16@235" } }), {});
    expect(pngInfo(new Uint8Array(await land.arrayBuffer()))).toMatchObject({ width: 960, height: 540 });
  });
  it("renders a fetched image with dithering and falls back to a message card", async () => {
    // a tiny 2×2 grey PNG served by the fake fetch, cropped to the screen
    const src = new PNG({ width: 2, height: 2 });
    src.data.set([40, 40, 40, 255, 200, 200, 200, 255, 120, 120, 120, 255, 255, 255, 255, 255]);
    const srcBytes = PNG.sync.write(src);
    const fake: typeof fetch = async (input) => (String(input).endsWith("ok.png") ? new Response(srcBytes, { headers: { "Content-Type": "image/png" } }) : new Response("nope", { status: 404 }));
    const app = createFrameApp(nodeRenderer(), fake);
    const res = await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=1&mode=image&u=${encodeURIComponent("https://pics.example/ok.png")}`, { headers: { "X-Screen": "540x960x16@235" } }), {});
    expect(res.status).toBe(200);
    const info = pngInfo(new Uint8Array(await res.arrayBuffer()))!;
    expect(info).toMatchObject({ width: 540, height: 960, bitDepth: 4 });
    const bad = await app.fetch(new Request(`${ORIGIN}/img/card.png?seed=1&mode=image&u=${encodeURIComponent("https://pics.example/missing.jpg")}`, { headers: { "X-Screen": "540x960x16@235" } }), {});
    expect(bad.status).toBe(200);
    expect(pngInfo(new Uint8Array(await bad.arrayBuffer()))).toMatchObject({ width: 540, height: 960 });
  });
});
