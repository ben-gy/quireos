import { describe, expect, it } from "vitest";
import { decodeEntities, domainOf, foldGlyphs, htmlToText, timeAgo } from "../src/text.js";
import { extract } from "../src/reader.js";
import { parseFeed, parseThread } from "../src/hn.js";
import { fixture } from "./helpers.js";

describe("text", () => {
  it("turns HN comment HTML into paragraphs", () => {
    expect(htmlToText("Hello <i>world</i>.<p>Second &amp; third &#39;q&#39;.<p>Link <a href=\"x\">x</a>")).toBe("Hello world.\n\nSecond & third 'q'.\n\nLink x");
    expect(htmlToText("a<br>b<pre><code>x = 1\ny = 2</code></pre>c")).toBe("a\nb\nx = 1\ny = 2\nc");
  });
  it("folds glyphs the device lacks and keeps Latin-1", () => {
    expect(foldGlyphs("café — “ok” ✓ 🚀 Ł")).toBe("café — \"ok\" v ? L");
    expect(decodeEntities("&hellip;&mdash;&#x2019;&nbsp;&bogus;")).toBe("…—’ &bogus;");
  });
  it("formats relative times and domains", () => {
    const now = 1_790_000_000;
    expect(timeAgo(now - 120, now)).toBe("2m");
    expect(timeAgo(now - 7200, now)).toBe("2h");
    expect(timeAgo(now - 86400 * 3, now)).toBe("3d");
    expect(timeAgo(now - 86400 * 65, now)).toBe("2mo");
    expect(timeAgo(0, now)).toBe("");
    expect(domainOf("https://www.Example.com:8443/path?q")).toBe("example.com");
    expect(domainOf("")).toBe("");
  });
});

describe("algolia parsing", () => {
  it("parses a feed with caps and folded titles", () => {
    const stories = parseFeed(JSON.parse(fixture("feed.json")));
    expect(stories.length).toBe(60);
    expect(stories[0]!.title).not.toMatch(/[🚀✓]/);
    expect(stories.find((s) => s.text)).toBeTruthy();
  });
  it("flattens a thread depth-first with depths", () => {
    const t = parseThread(JSON.parse(fixture("thread.json")));
    expect(t.story.id).toBe(40000001);
    expect(t.comments.length).toBeGreaterThan(40);
    expect(t.comments.length).toBeLessThanOrEqual(250);
    expect(Math.max(...t.comments.map((c) => c.depth))).toBeLessThanOrEqual(7);
    expect(t.comments[0]!.depth).toBe(0);
    expect(t.comments.every((c) => c.text.length > 0 && c.author)).toBe(true);
  });
});

describe("reader mode", () => {
  it("prefers <article>, drops furniture, keeps headings and bullets", () => {
    const r = extract(fixture("article.html"), "text/html; charset=utf-8", "https://example.org/x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.title).toBe("A long article about e-paper & firmware — Example");
    expect(r.article.body).toContain("# Section 7");
    expect(r.article.body).toContain("- Second bullet point with detail");
    expect(r.article.body).not.toContain("Related stories");
    expect(r.article.body).not.toContain("Footer text");
    expect(r.article.body).not.toContain("not text");
    expect(r.article.body).toContain("fn main()");
  });
  it("detects JavaScript-only pages and non-HTML", () => {
    const r = extract(fixture("jsonly.html"), "text/html", "https://app.example");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JavaScript/);
    const pdf = extract("%PDF-1.4", "application/pdf", "https://x/y.pdf");
    expect(pdf.ok).toBe(false);
    const txt = extract("Plain text body that is long enough to count as an article for the reader.", "text/plain", "https://x/y.txt");
    expect(txt.ok).toBe(true);
  });
});
