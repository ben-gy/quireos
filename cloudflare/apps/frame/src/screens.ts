/**
 * One full-bleed image plus two invisible tap zones. The seed selects the card; the screen's
 * `ttl` (an hour) turns the frame over on its own, `submit` events step through it by hand.
 */
import { rect, image, screen, submit } from "@quireos/sdk";
import type { Screen } from "@quireos/sdk";

export type Mode = "quote" | "image";

export interface HomeInput {
  seed: number;
  mode: Mode;
  imageUrl?: string;
  screen: { w: number; h: number };
}

/** Seed for the current hour: the frame changes on its own when the screen re-fetches. */
export function hourlySeed(now = Date.now()): number {
  return Math.floor(now / 3_600_000) % 1_000_000;
}

export function parseMode(settings: Record<string, unknown>): { mode: Mode; imageUrl?: string } {
  const url = typeof settings.image_url === "string" && /^https?:\/\/\S+$/.test(settings.image_url) && settings.image_url.length <= 400 ? settings.image_url : undefined;
  const mode: Mode = settings.mode === "image" && url ? "image" : "quote";
  return url ? { mode, imageUrl: url } : { mode };
}

export function cardUrl(input: HomeInput): string {
  const q = new URLSearchParams({ seed: String(input.seed), mode: input.mode });
  if (input.mode === "image" && input.imageUrl) q.set("u", input.imageUrl);
  return `/img/card.png?${q.toString()}`;
}

export function homeScreen(input: HomeInput): Screen {
  const { w, h } = input.screen;
  const half = Math.floor(w / 2);
  const step = (dir: "prev" | "next") => submit(dir, { args: { seed: "{{vars.seed}}" } });
  return screen({
    id: "home",
    url: "/screens/home.json",
    ttl: 3600,
    refresh: "full",
    vars: { seed: String(input.seed) },
    keys: { short: step("next"), double: step("prev") },
    widgets: [
      image({ id: "card", x: 0, y: 0, w, h, src: cardUrl(input), ttl: 0 }),
      rect({ id: "prev", x: 0, y: 0, w: half, h, on_tap: step("prev") }),
      rect({ id: "next", x: half, y: 0, w: w - half, h, on_tap: step("next") }),
    ],
  });
}
