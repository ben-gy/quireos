// The gallery Worker: serves the manifest and one screen per component group, laid out for the
// device in `X-Screen`. Copy this file and screens.ts to start an app.
import { kitFromRequest } from "@quireos/ui";
import { json, error } from "@quireos/sdk";
import { SCREENS } from "./screens.js";

export default {
  async fetch(req: Request, env: { ASSETS?: { fetch(r: Request): Promise<Response> } }): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/screens\/([a-z][a-z0-9-]*)\.json$/.exec(url.pathname);
    if (m) {
      const build = SCREENS[m[1]!];
      if (!build) return error("not_found", "No such screen", 404);
      const ui = kitFromRequest(req, { theme: url.searchParams.get("theme") === "dark" ? "dark" : "light" });
      const screen = build(ui, Math.max(1, Number(url.searchParams.get("p") ?? 1) || 1));
      screen.url = url.pathname;
      const problems = ui.validate(screen);
      if (problems.length) console.warn(`${m[1]}: ${problems.map((p) => `${p.path} ${p.message}`).join("; ")}`);
      return json(screen, req);   // canonical JSON, strong ETag, 304 on If-None-Match
    }
    if (url.pathname === "/event" && req.method === "POST") return new Response(null, { status: 204 });
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("Not found", { status: 404 });
  },
};
