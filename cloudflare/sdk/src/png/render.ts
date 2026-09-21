/**
 * `renderPng`: a satori element tree → SVG (satori) → RGBA (resvg-wasm) → 16-grey palette PNG.
 * Both WASM modules are initialised once at module scope; on Workers they must be imported as
 * modules (see README.md in this package for the pitfalls).
 */
import { encodePng4 } from "./encode.js";
import { quantize16 } from "./quantize.js";
import type { QuantizeOptions } from "./quantize.js";
import type { Font as SatoriFont, SatoriOptions } from "satori/standalone";

export type { SatoriFont };

type WasmInput = WebAssembly.Module | BufferSource | Response | Promise<WebAssembly.Module | BufferSource | Response>;

export interface RenderInit {
  /** satori's `yoga.wasm` (`import yoga from "satori/yoga.wasm"` on Workers). */
  yoga: WasmInput;
  /** `@resvg/resvg-wasm/index_bg.wasm`. */
  resvg: WasmInput;
}

export interface RenderOptions extends QuantizeOptions {
  w: number;
  h: number;
  fonts: SatoriFont[];
  /** Extra satori options (e.g. `graphemeImages`, `loadAdditionalAsset`). */
  satori?: Partial<Omit<SatoriOptions, "width" | "height" | "fonts">>;
}

let initPromise: Promise<void> | undefined;
let satoriFn: typeof import("satori/standalone").default | undefined;
let ResvgCtor: typeof import("@resvg/resvg-wasm").Resvg | undefined;

/** Loads satori + resvg and initialises their WASM once. Safe to call repeatedly. */
export function initRenderer(init: RenderInit): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const [satoriMod, resvgMod] = await Promise.all([import("satori/standalone"), import("@resvg/resvg-wasm")]);
      satoriFn = satoriMod.default;
      ResvgCtor = resvgMod.Resvg;
      await Promise.all([satoriMod.init(await init.yoga), resvgMod.initWasm(await init.resvg)]);
    })().catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  return initPromise;
}

/** Renders a satori element (`{ type: "div", props: { style, children } }`) to an SVG string. */
export async function renderSvg(node: unknown, opts: RenderOptions): Promise<string> {
  if (!satoriFn) throw new Error("renderPng: call initRenderer({ yoga, resvg }) first");
  return satoriFn(node as Parameters<typeof satoriFn>[0], { width: opts.w, height: opts.h, fonts: opts.fonts, ...opts.satori });
}

/** Rasterises an SVG string to `w × h` RGBA. */
export function rasterize(svg: string, w: number, h: number): Uint8Array {
  if (!ResvgCtor) throw new Error("renderPng: call initRenderer({ yoga, resvg }) first");
  const r = new ResvgCtor(svg, { fitTo: { mode: "width", value: w }, background: "white" });
  const img = r.render();
  const pixels = img.pixels;
  const iw = img.width;
  const ih = img.height;
  img.free();
  r.free();
  if (iw === w && ih === h) return pixels;
  // clip or pad onto a white canvas of the requested size
  const out = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < Math.min(h, ih); y++) out.set(pixels.subarray(y * iw * 4, y * iw * 4 + Math.min(w, iw) * 4), y * w * 4);
  return out;
}

/** Full pipeline: satori → resvg → quantize16 → encodePng4. Requires `initRenderer` first. */
export async function renderPng(node: unknown, opts: RenderOptions): Promise<Uint8Array> {
  const svg = await renderSvg(node, opts);
  const rgba = rasterize(svg, opts.w, opts.h);
  const idx = quantize16(rgba, opts.w, opts.h, { gamma: opts.gamma, dither: opts.dither });
  return encodePng4(idx, opts.w, opts.h);
}

/** Minimal element helper so apps need no JSX: `h("div", { style }, child, ...)`. */
export function h(type: string, props: Record<string, unknown> | null, ...children: unknown[]): { type: string; props: Record<string, unknown> } {
  const p: Record<string, unknown> = { ...(props ?? {}) };
  if (children.length === 1) p.children = children[0];
  else if (children.length > 1) p.children = children;
  return { type, props: p };
}
