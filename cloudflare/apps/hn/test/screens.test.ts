import { describe, expect, it } from "vitest";
import { parseFeed, parseThread } from "../src/hn.js";
import { extract } from "../src/reader.js";
import { articleFailScreen, articleScreen, feedsScreen, listScreen, settingsScreen, storyScreen, buildCommentDoc } from "../src/screens.js";
import type { Ctx } from "../src/screens.js";
import { theme, layoutDoc, geometry } from "../src/layout.js";
import type { Settings, TextSize } from "../src/store.js";
import { check, fixture } from "./helpers.js";

const now = 1_790_000_000;
const stories = parseFeed(JSON.parse(fixture("feed.json")));
const thread = parseThread(JSON.parse(fixture("thread.json")));
const article = extract(fixture("article.html"), "text/html", "https://example.org/x");
if (!article.ok) throw new Error("fixture article failed to extract");

function ctx(over: Partial<Settings> = {}, screen = { w: 540, h: 960 }): Ctx {
  const settings: Settings = { dark: false, text_size: "md", open_article: false, feed: "top", ...over };
  return { screen, t: theme(settings.dark), settings, now };
}

const sizes = { portrait: { w: 540, h: 960 }, landscape: { w: 960, h: 540 } };

describe("list screen", () => {
  it("validates on every page, both orientations, light and dark", () => {
    for (const [name, screen] of Object.entries(sizes)) {
      for (const dark of [false, true]) {
        let pages = 1;
        for (let p = 0; p < pages; p++) {
          const s = listScreen({ ctx: ctx({ dark }, screen), feed: "top", stories, read: new Set([stories[0]!.id, stories[3]!.id]), page: p });
          const { widgets, bytes } = check(s, `list ${name} dark=${dark} page ${p}`, screen);
          expect(widgets).toBeLessThanOrEqual(96);
          expect(bytes).toBeLessThan(16 * 1024);
          const info = (s.widgets.find((w) => w.type === "text" && typeof w.text === "object") as { text: { then: string } }).text.then;
          pages = Number(/^(\d+)\/(\d+)/.exec(info)![2]);
          expect(s.url).toBe(p ? `/screens/home.json?feed=top&page=${p}` : "/screens/home.json?feed=top");
        }
        expect(pages).toBeGreaterThan(3);
      }
    }
  });
  it("pages by pixel height: rows never overflow the content area", () => {
    const g = geometry(sizes.portrait, 2);
    const s = listScreen({ ctx: ctx(), feed: "top", stories, read: new Set(), page: 0 });
    const rows = s.widgets.filter((w) => w.type === "rect" && w.on_tap) as { y: number; h: number }[];
    expect(rows.length).toBeGreaterThan(4);
    const bottom = Math.max(...rows.map((r) => r.y + r.h));
    expect(bottom).toBeLessThanOrEqual(g.contentBot);
    expect(rows[0]!.y).toBe(g.contentTop);
  });
  it("greys read stories and routes taps to comments or the article", () => {
    const s = listScreen({ ctx: ctx({ open_article: true }), feed: "top", stories, read: new Set([stories[0]!.id]), page: 0 });
    const titles = s.widgets.filter((w) => w.type === "text" && w.weight === "bold");
    expect((titles[0] as { color: number }).color).toBe(9);
    expect((titles[1] as { color: number }).color).toBe(0);
    const tap = s.widgets.find((w) => w.type === "rect" && w.on_tap)!.on_tap as { type: string; event: string; then: string; then_url: string; args: { id: string } };
    expect(tap.type).toBe("submit");
    expect(tap.event).toBe("read");
    expect(tap.then).toBe("navigate");
    expect(tap.then_url).toBe(`/screens/article.json?id=${stories[0]!.id}`);
  });
  it("renders the empty saved list and dims the arrows", () => {
    const s = listScreen({ ctx: ctx(), feed: "saved", stories: [], read: new Set(), page: 0 });
    check(s, "saved empty");
    const arrows = s.widgets.filter((w) => w.type === "button" && (w.id === "prev" || w.id === "next")) as { disabled?: string; on_tap?: unknown }[];
    expect(arrows).toHaveLength(2);
    expect(arrows.every((a) => a.disabled && !a.on_tap)).toBe(true);
  });
});

describe("categories and settings", () => {
  it("validate in both orientations and themes", () => {
    for (const screen of Object.values(sizes)) {
      for (const dark of [false, true]) {
        check(feedsScreen({ ctx: ctx({ dark }, screen), current: "ask", savedCount: 3 }), "feeds", screen);
        check(settingsScreen({ ctx: ctx({ dark, text_size: "lg" }, screen), feed: "top", readCount: 12 }), "settings", screen);
      }
    }
  });
});

describe("comments screen", () => {
  it("validates every page at every text size, with folds, in both orientations", () => {
    for (const [name, screen] of Object.entries(sizes)) {
      for (const text_size of ["sm", "md", "lg"] as TextSize[]) {
        const folds = new Set<number>([thread.comments[0]!.id]);
        let pages = 1;
        let maxWidgets = 0;
        let maxBytes = 0;
        for (let p = 0; p < pages; p++) {
          const s = storyScreen({ ctx: ctx({ text_size }, screen), thread, folds, page: p, saved: p % 2 === 0 });
          const { widgets, bytes } = check(s, `story ${name} ${text_size} page ${p}`, screen);
          maxWidgets = Math.max(maxWidgets, widgets);
          maxBytes = Math.max(maxBytes, bytes);
          const counter = s.widgets.find((w) => w.type === "text" && typeof w.text === "string" && / \/ /.test(w.text)) as { text: string };
          pages = Number(counter.text.split(" / ")[1]);
        }
        expect(pages).toBeGreaterThan(3);
        expect(maxWidgets).toBeLessThanOrEqual(96);
        expect(maxBytes).toBeLessThan(24 * 1024);
      }
    }
  });
  it("folding a byline hides its subtree and shows the reply count", () => {
    const c = ctx();
    const open = buildCommentDoc(thread, new Set(), c, 492);
    const parent = thread.comments.findIndex((x, i) => (thread.comments[i + 1]?.depth ?? 0) > x.depth);
    const folded = buildCommentDoc(thread, new Set([thread.comments[parent]!.id]), c, 492);
    expect(folded.length).toBeLessThan(open.length);
    const byline = folded.find((l) => l.style === 1 && l.cidx === parent)!;
    expect(byline.text).toMatch(/\+\d+ repl(y|ies)/);
    // every line is within the content height, no widget text exceeds 8 lines
    const s = storyScreen({ ctx: c, thread, folds: new Set(), page: 1, saved: false });
    for (const w of s.widgets) if (w.type === "text" && typeof w.text === "string") expect(w.text.split("\n").length).toBeLessThanOrEqual(8);
    const fold = s.widgets.find((w) => w.type === "text" && w.on_tap)!.on_tap as { event: string; args: Record<string, string> };
    expect(fold.event).toBe("fold");
    expect(fold.args.page).toBe("1");
  });
  it("lays document lines out without straddling pages", () => {
    const lines = buildCommentDoc(thread, new Set(), ctx(), 492);
    const starts = layoutDoc(lines, 816);
    for (let i = 0; i + 1 < starts.length; i++) {
      let h = 0;
      for (let k = starts[i]!; k < starts[i + 1]!; k++) h += lines[k]!.h;
      if (starts[i + 1]! - starts[i]! > 1) expect(h).toBeLessThanOrEqual(816);
    }
  });
});

describe("article screens", () => {
  it("validates every page and the failure screen", () => {
    for (const screen of Object.values(sizes)) {
      let pages = 1;
      for (let p = 0; p < pages; p++) {
        const s = articleScreen({ ctx: ctx({ text_size: "sm" }, screen), story: thread.story, article: article.article, page: p, saved: false, from: "story" });
        check(s, `article page ${p}`, screen);
        const counter = s.widgets.find((w) => w.type === "text" && typeof w.text === "string" && / \/ /.test(w.text)) as { text: string };
        pages = Number(counter.text.split(" / ")[1]);
      }
      expect(pages).toBeGreaterThan(2);
    }
    check(articleFailScreen({ ctx: ctx(), story: thread.story, title: "Could not read article", body: "No readable text found (the page may need JavaScript)", from: "list" }));
  });
});
