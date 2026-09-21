/**
 * A minimal QuireOS app on Cloudflare Workers. Routes (all provided by createApp):
 *   GET  /manifest.json        the manifest
 *   GET  /screens/:id.json     one screen per key of `screens`
 *   POST /event                `submit` actions land here
 *   GET  /img/:name.png        one image per key of `images` (none here)
 *
 * Screens are plain JSON documents: absolute coordinates for a 540×960 portrait device (read
 * ctx.device.screen to adapt). Templates such as {{settings.name}} are substituted on the device,
 * so the same document can be cached per app rather than per user.
 */
import { back, bind, button, cond, createApp, f, line, navigate, screen, set, submit, text } from "@quireos/sdk";
import type { Screen } from "@quireos/sdk";
import { manifest } from "./manifest.js";

export interface Env {
  DEV?: string;
}

const W = 540;
const M = 24; // margin

function home(count: number): Screen {
  return screen({
    id: "home",
    ttl: 0, // only re-fetched on open, refresh or settings change; the clock below updates locally
    vars: { count: String(count) },
    widgets: [
      text({ x: M, y: 40, w: W - 2 * M, text: `Hello, ${bind("settings.name", f.default("friend"))}`, size: "2xl", weight: "bold", lines: 2 }),
      text({ x: M, y: 200, w: W - 2 * M, text: bind("device.time", f.time("EEEE d MMMM")), size: "md", color: 5 }),
      text({ x: M, y: 240, w: W - 2 * M, h: 150, text: bind("device.time", f.time("HH:mm")), size: "digits" }),
      line({ x1: M, y1: 420, x2: W - M, y2: 420 }),
      text({ x: M, y: 440, w: W - 2 * M, text: "Count: {{vars.count}}", size: "lg" }),
      button({
        id: "plus",
        x: M,
        y: 500,
        w: 236,
        h: 96,
        label: "+1 (local)",
        sub: "set action, no network",
        on_tap: set({ count: bind("vars.count") }), // the device cannot add; see the event handler for the server-side version
      }),
      button({
        id: "next",
        x: W - M - 236,
        y: 500,
        w: 236,
        h: 96,
        label: "+1 (server)",
        sub: "submit → /event",
        fill: cond("vars.count > 4", 0, 15),
        on_tap: submit("increment", { args: { count: bind("vars.count") } }),
      }),
      button({ id: "about", x: M, y: 620, w: W - 2 * M, h: 88, label: "About", on_tap: navigate("/screens/about.json") }),
      text({ x: M, y: 900, w: W - 2 * M, text: "{{device.battery}}% · {{device.name}}", size: "xs", align: "center", color: 8 }),
    ],
  });
}

export default createApp<Env>({
  manifest,
  screens: {
    home: (ctx) => home(Number(ctx.device.settings.count ?? 0) || 0),
    about: () =>
      screen({
        id: "about",
        widgets: [
          text({ x: M, y: 40, w: W - 2 * M, text: "About", size: "xl", weight: "bold" }),
          text({ x: M, y: 120, w: W - 2 * M, lines: 6, text: "This app is served by a Cloudflare Worker using @quireos/sdk. Copy cloudflare/apps/_template, change the id in src/manifest.ts and the name in wrangler.jsonc, then `npm run dev`." }),
          button({ x: M, y: 800, w: W - 2 * M, h: 88, label: "Back", on_tap: back() }),
        ],
      }),
  },
  onEvent: (event) => {
    if (event.event === "increment") return home((Number(event.args?.count) || 0) + 1);
    return null; // 204: nothing to do
  },
});
