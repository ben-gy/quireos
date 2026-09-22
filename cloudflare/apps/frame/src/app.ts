/**
 * The Worker without the asset imports, so tests can build it with a Node renderer (or none).
 * Routes: GET /manifest.json, GET /screens/home.json, POST /event (prev/next), GET /img/card.png.
 */
import { createApp, error, etag, matchesEtag, notModified, png } from "@quireos/sdk";
import { manifest } from "./manifest.js";
import { cardUrl, homeScreen, hourlySeed, parseMode } from "./screens.js";
import type { HomeInput } from "./screens.js";
import type { Renderer } from "./render.js";

export interface Env {
  DEV?: string;
}

export { manifest };

const CARD_TTL = 24 * 3600;

function cacheApi(): Cache | undefined {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

async function hash(s: string): Promise<string> {
  return (await etag(s)).slice(1, 17);
}

export function createFrameApp(renderer: Renderer | undefined, fetchFn: typeof fetch = fetch) {
  const stepSeed = (raw: unknown, dir: 1 | -1): number => {
    const n = Number(raw);
    const seed = Number.isFinite(n) ? Math.trunc(n) : hourlySeed();
    return seed + dir;
  };
  return createApp<Env>({
    manifest,
    screens: {
      home: (ctx) => homeScreen({ ...parseMode(ctx.device.settings), seed: hourlySeed(), screen: ctx.device.screen }),
    },
    onEvent: (ev, ctx) => {
      if (ev.event !== "next" && ev.event !== "prev") return null;
      const seed = stepSeed(ev.args?.seed, ev.event === "next" ? 1 : -1);
      return homeScreen({ ...parseMode(ctx.device.settings), seed, screen: ctx.device.screen });
    },
    images: {
      card: async (ctx, url) => {
        if (!renderer) return error("unavailable", "Card rendering is not initialised on this Worker", 503);
        const seed = Math.trunc(Number(url.searchParams.get("seed")) || 0);
        const imageUrl = url.searchParams.get("u") ?? undefined;
        const mode = url.searchParams.get("mode") === "image" && imageUrl ? "image" : "quote";
        const { w, h } = ctx.device.screen;
        const input: HomeInput = { seed, mode, imageUrl, screen: { w, h } };
        // ETag from the request identity, so a device that already holds this card gets 304 before any rendering.
        const key = `card/${w}x${h}/${mode}/${seed}/${mode === "image" ? await hash(imageUrl!) : "-"}`;
        const tag = await etag(key);
        if (matchesEtag(ctx.request, tag)) return notModified(tag);
        const cacheKey = `https://cache.quireos-frame.invalid/${key}`;
        const cache = cacheApi();
        if (cache) {
          try {
            const hit = await cache.match(cacheKey);
            if (hit) return png(new Uint8Array(await hit.arrayBuffer()), ctx.request, key);
          } catch {
            /* render instead */
          }
        }
        const bytes = await renderer.card({ w, h, seed, mode, imageUrl }, fetchFn);
        if (cache) {
          const put = cache.put(cacheKey, new Response(bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${mode === "image" ? 3600 : CARD_TTL}` } })).catch(() => undefined);
          if (ctx.ec) ctx.ec.waitUntil(put);
          else await put;
        }
        void cardUrl;
        return png(bytes, ctx.request, key);
      },
    },
  });
}
