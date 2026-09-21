import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/response.js";
import { screen, text, button } from "../src/screen.js";
import { navigate, submit } from "../src/actions.js";
import type { Manifest } from "../src/types.js";

const manifest: Manifest = { spec_version: 1, id: "demo", name: "Demo", version: "1.0.0", min_os: "0.1.0", icon: "star", entry: "" as string };
delete (manifest as Partial<Manifest>).entry;

const app = createApp<{ DEV?: string }>({
  manifest,
  screens: {
    home: (ctx, url) =>
      screen({ id: "home", widgets: [text({ x: 0, y: 0, w: 100, text: `Hello ${ctx.device.screen.w} ${url.searchParams.get("q") ?? ""}` }), button({ x: 0, y: 50, w: 100, h: 40, label: "Next", on_tap: submit("next", { args: { seed: 5 } }) })] }),
    broken: () => ({ spec_version: 1, id: "broken", widgets: [{ type: "text", x: 0, y: 0 } as never] }),
    boom: () => {
      throw new AppError("settings_missing", "Add a token", 412);
    },
    crash: () => {
      throw new Error("nope");
    },
  },
  onEvent: (ev) => (ev.event === "next" ? screen({ id: "two", widgets: [text({ x: 0, y: 0, w: 1, text: String(ev.args?.seed) })] }) : null),
  images: { chart: () => ({ bytes: new Uint8Array([9, 9]), seed: "s" }) },
});

const dev = { DEV: "1" };
const get = (path: string, headers: Record<string, string> = {}, env: { DEV?: string } = {}) => app.fetch(new Request(`https://demo.example.com${path}`, { headers }), env);

describe("createApp", () => {
  it("serves the manifest with defaults filled", async () => {
    const res = await get("/manifest.json");
    expect(res.status).toBe(200);
    const m = (await res.json()) as Manifest;
    expect(m.entry).toBe("/screens/home.json");
    expect(m.event).toBe("/event");
    expect(res.headers.get("ETag")).toBeTruthy();
  });
  it("serves screens with device context and url", async () => {
    const res = await get("/screens/home.json?q=hi", { "X-Screen": "960x540x16@235" }, dev);
    expect(res.status).toBe(200);
    const s = (await res.json()) as { url: string; widgets: { text: string }[] };
    expect(s.widgets[0]!.text).toBe("Hello 960 hi");
    expect(s.url).toBe("/screens/home.json");
    expect((await get("/screens/nope.json")).status).toBe(404);
    expect((await app.fetch(new Request("https://x/screens/home.json", { method: "POST" }), {})).status).toBe(405);
  });
  it("answers 304 on matching ETag", async () => {
    const first = await get("/screens/home.json");
    const tag = first.headers.get("ETag")!;
    expect((await get("/screens/home.json", { "If-None-Match": tag })).status).toBe(304);
  });
  it("validates screens in dev only", async () => {
    // vitest sets import.meta.env.DEV, so the default is "dev" here; opt out explicitly for the prod case
    const prodApp = createApp({ manifest, screens: { broken: () => ({ spec_version: 1, id: "broken", widgets: [{ type: "text", x: 0, y: 0 } as never] }) }, validate: false });
    const prod = await prodApp.fetch(new Request("https://x/screens/broken.json"), {});
    expect(prod.status).toBe(200);
    const devRes = await get("/screens/broken.json", {}, dev);
    expect(devRes.status).toBe(500);
    expect(((await devRes.json()) as { error: { code: string } }).error.code).toBe("invalid_screen");
  });
  it("handles events", async () => {
    const res = await app.fetch(new Request("https://x/event", { method: "POST", body: JSON.stringify({ spec_version: 1, event: "next", screen: "home", widget: "#1", args: { seed: "5" } }) }), {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe("two");
    const none = await app.fetch(new Request("https://x/event", { method: "POST", body: JSON.stringify({ event: "other" }) }), {});
    expect(none.status).toBe(204);
    expect((await app.fetch(new Request("https://x/event", { method: "POST", body: "{" }), {})).status).toBe(400);
    expect((await app.fetch(new Request("https://x/event"), {})).status).toBe(405);
  });
  it("serves images", async () => {
    const res = await get("/img/chart.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect((await get("/img/nope.png")).status).toBe(404);
  });
  it("maps errors", async () => {
    const res = await get("/screens/boom.json");
    expect(res.status).toBe(412);
    expect((await res.json()) as object).toEqual({ spec_version: 1, error: { code: "settings_missing", message: "Add a token" } });
    expect((await get("/screens/crash.json")).status).toBe(500);
    expect((await get("/nothing")).status).toBe(404);
  });
  it("builders produce compact documents", () => {
    expect(navigate("/x.json")).toEqual({ type: "navigate", url: "/x.json" });
    expect(navigate("/x.json", { replace: true })).toEqual({ type: "navigate", url: "/x.json", replace: true });
    expect(text({ x: 1, y: 2, w: 3, text: "t", size: undefined })).toEqual({ type: "text", x: 1, y: 2, w: 3, text: "t" });
  });
});
