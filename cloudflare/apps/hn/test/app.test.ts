import { beforeEach, describe, expect, it } from "vitest";
import app, { deps } from "../src/index.js";
import { clearMemoryCache } from "../src/cache.js";
import { clearMemoryStore } from "../src/store.js";
import { deviceHeaders, fixture } from "./helpers.js";
import type { Screen } from "@quireos/sdk";

const calls: string[] = [];
deps.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("hn.algolia.com/api/v1/items/999")) return new Response("{}", { status: 404 });
  if (url.includes("hn.algolia.com/api/v1/items/")) return new Response(fixture("thread.json"), { headers: { "Content-Type": "application/json" } });
  if (url.includes("hn.algolia.com")) return new Response(fixture("feed.json"), { headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://example1.org/")) return new Response(fixture("article.html"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response("nope", { status: 404 });
};

const env = { DEV: "1" };
const get = (path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`https://hn.test${path}`, { headers: deviceHeaders(headers) }), env);
const post = (event: string, args: Record<string, string>, screen = "home") =>
  app.fetch(new Request("https://hn.test/event", { method: "POST", headers: deviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ spec_version: 1, event, screen, widget: "#1", args }) }), env);

beforeEach(() => {
  clearMemoryCache();
  clearMemoryStore();
  calls.length = 0;
});

describe("hn worker", () => {
  it("serves the manifest and a list that answers 304", async () => {
    const m = (await (await get("/manifest.json")).json()) as { id: string; settings: unknown[] };
    expect(m.id).toBe("hn");
    expect(m.settings).toHaveLength(3);
    const res = await get("/screens/home.json");
    expect(res.status).toBe(200);
    const tag = res.headers.get("ETag")!;
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    const s = (await res.json()) as Screen;
    expect(s.url).toBe("/screens/home.json?feed=top");
    expect(s.ttl).toBe(600);
    expect((await get("/screens/home.json", { "If-None-Match": tag })).status).toBe(304);
    expect(calls.filter((u) => u.includes("front_page"))).toHaveLength(1); // second fetch came from the cache
  });
  it("reads settings from X-App-Settings and remembers the feed per install", async () => {
    const dark = await get("/screens/home.json", { "X-App-Settings": encodeURIComponent(JSON.stringify({ dark: true, text_size: "lg" })) });
    const s = (await dark.json()) as Screen;
    expect(s.widgets[0]).toMatchObject({ type: "rect", fill: 0 });
    const picked = await post("feed", { feed: "ask" }, "feeds");
    expect(picked.status).toBe(200);
    expect(((await picked.json()) as Screen).url).toBe("/screens/home.json?feed=ask");
    const entry = (await (await get("/screens/home.json")).json()) as Screen;
    expect(entry.url).toBe("/screens/home.json?feed=ask");
  });
  it("marks stories read, saves bookmarks, folds and toggles settings through events", async () => {
    expect((await post("read", { id: "40000001" })).status).toBe(204);
    const list = (await (await get("/screens/home.json")).json()) as Screen;
    const titles = list.widgets.filter((w) => w.type === "text" && w.weight === "bold") as { color: number }[];
    expect(titles[1]!.color).toBe(9);

    const saved = await post("save", { id: "40000001", page: "0", kind: "story" }, "story");
    expect(saved.status).toBe(200);
    const story = (await saved.json()) as Screen;
    expect(story.id).toBe("story");
    expect(story.widgets.some((w) => w.type === "button" && w.icon === "bookmark")).toBe(true);
    const savedList = (await (await get("/screens/home.json?feed=saved")).json()) as Screen;
    expect(savedList.widgets.filter((w) => w.type === "rect" && w.on_tap)).toHaveLength(1);

    const first = (await (await get("/screens/story.json?id=40000001")).json()) as Screen;
    const byline = first.widgets.find((w) => w.type === "text" && w.on_tap)!.on_tap as unknown as { args: { c: string } };
    const folded = (await (await post("fold", { id: "40000001", c: byline.args.c, page: "0" }, "story")).json()) as Screen;
    expect(JSON.stringify(folded)).toMatch(/\+\d+ repl|folded/);
    const again = (await (await get("/screens/story.json?id=40000001")).json()) as Screen;
    expect(JSON.stringify(again)).toMatch(/\+\d+ repl|folded/);

    const settings = (await (await post("setting", { key: "dark", feed: "top" }, "settings")).json()) as Screen;
    expect(settings.id).toBe("settings");
    expect(settings.widgets[0]).toMatchObject({ type: "rect", fill: 0 });
    const size = (await (await post("setting", { key: "text_size", feed: "top" }, "settings")).json()) as Screen;
    expect(JSON.stringify(size)).toContain('"L"');
    expect((await post("setting", { key: "clear_read", feed: "top" }, "settings")).status).toBe(200);
    expect((await post("nope", {})).status).toBe(204);
  });
  it("renders the article, falls back to a message for unreadable pages, and evicts the feed on refresh", async () => {
    const art = await get("/screens/article.json?id=40000001&from=story");
    expect(art.status).toBe(200);
    const s = (await art.json()) as Screen;
    expect(s.id).toBe("article");
    expect(s.url).toBe("/screens/article.json?id=40000001&from=story");
    expect(calls.filter((u) => u.startsWith("https://example1.org/"))).toHaveLength(1);
    await get("/screens/article.json?id=40000001&page=1&from=story");
    expect(calls.filter((u) => u.startsWith("https://example1.org/"))).toHaveLength(1); // cached

    expect((await post("refresh", { feed: "top" })).status).toBe(204);
    await get("/screens/home.json");
    expect(calls.filter((u) => u.includes("front_page"))).toHaveLength(1);
    await post("refresh", { feed: "top" });
    await get("/screens/home.json");
    expect(calls.filter((u) => u.includes("front_page"))).toHaveLength(2);
  });
  it("lays out landscape screens", async () => {
    const res = await get("/screens/story.json?id=40000001", { "X-Screen": "960x540x16@235" });
    expect(res.status).toBe(200);
    const s = (await res.json()) as Screen;
    const xs = s.widgets.filter((w) => w.type === "text").map((w) => w.x);
    expect(Math.max(...xs)).toBeGreaterThan(480); // second column in use
  });
  it("answers errors as §8.2 bodies", async () => {
    expect((await get("/screens/story.json?id=0")).status).toBe(400);
    const res = await get("/screens/story.json?id=999");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { spec_version: number; error: { code: string; message: string } };
    expect(body.spec_version).toBe(1);
    expect(body.error.code).toBe("upstream");
  });
});
