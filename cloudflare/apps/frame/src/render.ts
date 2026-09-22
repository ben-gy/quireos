/**
 * Card rendering with `renderPng` from `@quireos/sdk/png` (satori → resvg → 16 greys). The
 * WASM modules and fonts are injected so the same code runs on Workers (module imports) and in
 * Node tests (file bytes).
 */
import { h, initRenderer, renderPng } from "@quireos/sdk/png";
import type { RenderInit, SatoriFont } from "@quireos/sdk/png";
import { quoteFor } from "./quotes.js";

export interface RendererInit extends RenderInit {
  fonts: { regular: ArrayBuffer; bold: ArrayBuffer };
}

export interface CardRequest {
  w: number;
  h: number;
  seed: number;
  mode: "quote" | "image";
  imageUrl?: string;
}

export interface Renderer {
  card(req: CardRequest, fetchFn?: typeof fetch): Promise<Uint8Array>;
}

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/** Fetches the image (PNG/JPEG/GIF, ≤ 6 MB, 10 s) as a data URL for satori. */
export async function fetchImageDataUrl(url: string, fetchFn: typeof fetch = fetch): Promise<{ ok: true; dataUrl: string } | { ok: false; reason: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetchFn(url, { headers: { Accept: "image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5", "User-Agent": "QuireOS-frame/1.0" }, signal: ctl.signal });
    if (!res.ok) return { ok: false, reason: `The server answered ${res.status}` };
    const ct = (res.headers.get("Content-Type") ?? "").toLowerCase().split(";")[0]!.trim();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: `Image is ${(buf.byteLength / 1048576).toFixed(1)} MB; the limit is 6 MB` };
    const sniffed = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf[0] === 0x47 && buf[1] === 0x49 ? "image/gif" : "";
    const type = sniffed || ct;
    if (!["image/png", "image/jpeg", "image/gif"].includes(type)) return { ok: false, reason: `Not a PNG, JPEG or GIF (${ct || "unknown type"})` };
    return { ok: true, dataUrl: `data:${type};base64,${toBase64(buf)}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).name === "AbortError" ? "Timed out fetching the image" : `Could not fetch the image: ${(err as Error).message}`.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function quoteNode(w: number, hh: number, text: string, author: string, footer: string, small = false) {
  const scale = w / 540;
  const chars = text.length;
  const size = Math.round((small ? 28 : chars <= 60 ? 54 : chars <= 100 ? 46 : chars <= 160 ? 40 : 34) * scale);
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", width: w, height: hh, background: "#fff", color: "#000", fontFamily: "Roboto", padding: Math.round(56 * scale), justifyContent: "center" } },
    h("div", { style: { display: "flex", fontSize: Math.round(120 * scale), lineHeight: 0.6, color: "#777", fontWeight: 700, marginBottom: Math.round(12 * scale) } }, "“"),
    h("div", { style: { display: "flex", fontSize: size, lineHeight: 1.25, fontWeight: 700, letterSpacing: -0.5 } }, text),
    h("div", { style: { display: "flex", width: Math.round(96 * scale), height: 3, background: "#000", marginTop: Math.round(36 * scale), marginBottom: Math.round(24 * scale) } }),
    h("div", { style: { display: "flex", fontSize: Math.round(30 * scale), color: "#333" } }, author),
    h("div", { style: { display: "flex", position: "absolute", bottom: Math.round(28 * scale), left: Math.round(56 * scale), fontSize: Math.round(18 * scale), color: "#888" } }, footer),
  );
}

export function makeRenderer(init: RendererInit): Renderer {
  const ready = initRenderer({ yoga: init.yoga, resvg: init.resvg });
  const fonts: SatoriFont[] = [
    { name: "Roboto", data: init.fonts.regular, weight: 400, style: "normal" },
    { name: "Roboto", data: init.fonts.bold, weight: 700, style: "normal" },
  ];
  return {
    async card(req, fetchFn = fetch) {
      await ready;
      const { w, h: hh } = req;
      if (req.mode === "image" && req.imageUrl) {
        const img = await fetchImageDataUrl(req.imageUrl, fetchFn);
        if (img.ok) {
          const node = h("div", { style: { display: "flex", width: w, height: hh, background: "#fff" } }, h("img", { src: img.dataUrl, width: w, height: hh, style: { objectFit: "cover", width: w, height: hh } }));
          return renderPng(node, { w, h: hh, fonts, dither: "fs", gamma: 0.85 });
        }
        return renderPng(quoteNode(w, hh, "Could not load the image", img.reason, `Frame · ${req.imageUrl.slice(0, 60)}`, true), { w, h: hh, fonts, dither: "none" });
      }
      const q = quoteFor(req.seed);
      return renderPng(quoteNode(w, hh, q.text, `— ${q.author}`, `Frame · quote ${(((req.seed % 20) + 20) % 20) + 1} of 20`), { w, h: hh, fonts, dither: "none" });
    },
  };
}
