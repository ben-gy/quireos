/**
 * Screen builders: pure functions from data to §6 documents. Nothing here touches the network or
 * KV, so tests can render every screen from fixtures and run `validateScreen` on the result.
 */
import { back, home, icon, navigate, rect, refresh, screen, submit, text } from "@quireos/sdk";
import type { Action, Screen, Widget } from "@quireos/sdk";
import { FEEDS, feedName } from "./hn.js";
import type { Comment, Feed, Story, Thread } from "./hn.js";
import type { Article } from "./reader.js";
import type { Settings } from "./store.js";
import { background, docStyle, fitFacts, gap, geometry, header, layoutDoc, pageCount, pushWrapped, renderDocPage, titleLines, toolbar, MAX_DEPTH, INDENT_PX } from "./layout.js";
import type { Cell, Geo, RLine, Theme } from "./layout.js";
import { domainOf, timeAgo } from "./text.js";

export type ListFeed = Feed | "saved";

export interface Ctx {
  screen: { w: number; h: number };
  t: Theme;
  settings: Settings;
  /** Epoch seconds, for relative times. */
  now: number;
}

/** Canonical screen URLs; page 0 is omitted so the entry URL stays short. */
export const urls = {
  list: (feed: ListFeed, page = 0) => `/screens/home.json?feed=${feed}${page ? `&page=${page}` : ""}`,
  feeds: (feed: ListFeed) => `/screens/feeds.json?feed=${feed}`,
  settings: (feed: ListFeed) => `/screens/settings.json?feed=${feed}`,
  story: (id: number, page = 0) => `/screens/story.json?id=${id}${page ? `&page=${page}` : ""}`,
  article: (id: number, page = 0, from: "list" | "story" = "list") => `/screens/article.json?id=${id}${page ? `&page=${page}` : ""}${from === "story" ? "&from=story" : ""}`,
};

const APP_TITLE = "Hacker News";

function refreshMode(t: Theme): "partial" | "auto" {
  return t.dark ? "auto" : "partial";
}

function pager(page: number, pages: number, url: (p: number) => string): { prev: Cell; next: Cell } {
  return {
    prev: { id: "prev", icon: "chevron-up", dim: page <= 0, on_tap: page > 0 ? navigate(url(page - 1), { replace: true }) : undefined },
    next: { id: "next", icon: "chevron-down", dim: page + 1 >= pages, on_tap: page + 1 < pages ? navigate(url(page + 1), { replace: true }) : undefined },
  };
}

function keysFor(page: number, pages: number, url: (p: number) => string, atEnd: Action): Screen["keys"] {
  return { short: page + 1 < pages ? navigate(url(page + 1), { replace: true }) : atEnd, double: back() };
}

// ---------------------------------------------------------------------------------------------
// Story list

export interface ListInput {
  ctx: Ctx;
  feed: ListFeed;
  stories: Story[];
  read: Set<number>;
  page: number;
}

interface Row {
  story: Story;
  lines: string[];
  h: number;
}

/** Row height: 8 + title lines + 4 + facts + 8 (hn-t5 rowHeightFor with the t5pro metrics). */
export function rowHeight(lines: number): number {
  return 8 + 36 * lines + 4 + 24 + 8;
}

/** Fills columns from the top: a row never straddles two; every column takes at least one row. */
function layoutRows(rows: Row[], g: Geo): number[] {
  const starts = [0];
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i]!.h;
    if (y + h > g.contentH && i > starts[starts.length - 1]!) {
      starts.push(i);
      y = 0;
    }
    y += h;
  }
  starts.push(rows.length);
  return starts;
}

export function listScreen(input: ListInput): Screen {
  const { ctx, feed, stories, read } = input;
  const g = geometry(ctx.screen, 2);
  const t = ctx.t;
  const rows: Row[] = stories.map((s) => {
    const lines = titleLines(s.title, g.colW);
    return { story: s, lines, h: rowHeight(lines.length) };
  });
  const starts = layoutRows(rows, g);
  const pages = rows.length ? pageCount(starts, g.cols) : 1;
  const page = Math.min(Math.max(0, input.page), pages - 1);
  const listUrl = (p: number) => urls.list(feed, p);

  const widgets: Widget[] = [...background(g, t), ...header(g, t, { title: APP_TITLE, pageInfo: `${page + 1}/${pages}` })];

  if (rows.length === 0) {
    widgets.push(text({ x: g.M, y: g.contentTop + 40, w: g.contentW, text: feed === "saved" ? "Nothing saved yet." : "Nothing loaded.", size: "md", color: t.dim }));
    widgets.push(text({ x: g.M, y: g.contentTop + 84, w: g.contentW, text: feed === "saved" ? "Open a story and tap the bookmark." : "Tap Refresh below.", size: "xs", color: t.dim }));
  }

  for (let c = 0; c < g.cols; c++) {
    const slot = page * g.cols + c;
    if (slot + 1 >= starts.length) break;
    const x = g.M + c * (g.colW + g.gutter);
    let y = g.contentTop;
    for (let i = starts[slot]!; i < starts[slot + 1]!; i++) {
      const r = rows[i]!;
      const s = r.story;
      const isRead = read.has(s.id);
      const n = r.lines.length;
      widgets.push(text({ x, y: y + 8, w: g.colW, h: 36 * n, text: r.lines.join("\n"), size: "md", weight: "bold", lines: n > 1 ? n : undefined, color: isRead ? t.read : t.ink }));
      const facts = fitFacts([`${s.points} pts`, `${s.comments} ${s.comments === 1 ? "comment" : "comments"}`, timeAgo(s.time, ctx.now), domainOf(s.url)], g.colW);
      widgets.push(text({ x, y: y + 8 + 36 * n + 4, w: g.colW, text: facts, size: "xs", color: isRead ? t.readFacts : t.dim }));
      const target = ctx.settings.open_article && s.url ? urls.article(s.id, 0, "list") : urls.story(s.id);
      widgets.push(rect({ x: x - 12, y, w: g.colW + 24, h: r.h, feedback: "invert", on_tap: submit("read", { args: { id: String(s.id) }, then: "navigate", then_url: target }) }));
      y += r.h;
    }
  }

  const { prev, next } = pager(page, pages, listUrl);
  const first: Cell =
    feed === "saved"
      ? { id: "feed", label: feedName(ctx.settings.feed), on_tap: navigate(urls.list(ctx.settings.feed), { replace: true }) }
      : { id: "saved", icon: "bookmark", on_tap: navigate(urls.list("saved"), { replace: true }) };
  widgets.push(
    ...toolbar(g, t, [
      [first, { id: "refresh", icon: "refresh", on_tap: feed === "saved" ? refresh() : submit("refresh", { args: { feed }, then: "refresh" }) }, { id: "settings", icon: "cog", on_tap: navigate(urls.settings(feed)) }],
      [prev, { id: "feeds", label: feed === "saved" ? "Saved" : feedName(feed), menu: true, on_tap: navigate(urls.feeds(feed), { replace: true }) }, next],
    ]),
  );

  return screen({
    id: "home",
    url: listUrl(page),
    ttl: 600,
    refresh: refreshMode(t),
    keys: keysFor(page, pages, listUrl, navigate(listUrl(0), { replace: true })),
    widgets,
  });
}

// ---------------------------------------------------------------------------------------------
// Categories

export interface FeedsInput {
  ctx: Ctx;
  current: ListFeed;
  savedCount: number;
}

export function feedsScreen(input: FeedsInput): Screen {
  const { ctx } = input;
  const g = geometry(ctx.screen, 0);
  const t = ctx.t;
  const rows: { feed: ListFeed; name: string; desc: string }[] = [...FEEDS.map((f) => ({ feed: f.id as ListFeed, name: f.name, desc: f.desc })), { feed: "saved", name: "Saved", desc: `Stories you have saved  (${input.savedCount})` }];
  const pitch = Math.min(85, Math.floor(g.contentH / rows.length));
  const widgets: Widget[] = [...background(g, t), ...header(g, t, { title: "Categories", back: home() })];
  rows.forEach((r, i) => {
    const y0 = g.contentTop + i * pitch;
    widgets.push(text({ x: g.M, y: y0 + 8, w: g.contentW - 48, text: r.name, size: "md", weight: "bold", color: t.ink }));
    widgets.push(text({ x: g.M, y: y0 + 8 + 36, w: g.contentW - 48, text: r.desc, size: "xs", color: t.dim }));
    if (r.feed === input.current) widgets.push(icon({ x: g.W - g.M - 32, y: y0 + 10, name: "check", size: "sm", color: t.ink }));
    widgets.push(rect({ x: 0, y: y0, w: g.W, h: pitch, feedback: "invert", on_tap: submit("feed", { args: { feed: r.feed } }) }));
  });
  return screen({ id: "feeds", url: urls.feeds(input.current), ttl: 0, refresh: refreshMode(t), keys: { short: home(), double: home() }, widgets });
}

// ---------------------------------------------------------------------------------------------
// Settings

export interface SettingsInput {
  ctx: Ctx;
  feed: ListFeed;
  readCount: number;
}

export function settingsScreen(input: SettingsInput): Screen {
  const { ctx } = input;
  const s = ctx.settings;
  const g = geometry(ctx.screen, 0);
  const t = ctx.t;
  const sizeName = { sm: "S", md: "M", lg: "L" }[s.text_size];
  const rows: { key: string; label: string; value: string }[] = [
    { key: "dark", label: "Theme", value: s.dark ? "Dark" : "Light" },
    { key: "text_size", label: "Text size", value: sizeName },
    { key: "open_article", label: "Open story with", value: s.open_article ? "Article" : "Comments" },
    { key: "mark_read", label: "Mark this feed as read", value: "" },
    { key: "clear_read", label: "Clear read history", value: `${input.readCount} ${input.readCount === 1 ? "story" : "stories"}` },
  ];
  const pitch = Math.min(64, Math.floor(g.contentH / rows.length));
  const widgets: Widget[] = [...background(g, t), ...header(g, t, { title: "Settings", back: home() })];
  rows.forEach((r, i) => {
    const y0 = g.contentTop + i * pitch;
    widgets.push(text({ x: g.M, y: y0 + 12, w: g.contentW - 230, text: r.label, size: "md", weight: "bold", color: t.ink }));
    if (r.value) widgets.push(text({ x: g.W - g.M - 220, y: y0 + 17, w: 220, text: r.value, size: "sm", align: "right", color: t.dim }));
    widgets.push(rect({ x: 0, y: y0, w: g.W, h: pitch, feedback: "invert", on_tap: submit("setting", { args: { key: r.key, feed: input.feed } }) }));
  });
  widgets.push(text({ x: g.M, y: g.contentTop + rows.length * pitch + 16, w: g.contentW, lines: 3, text: "Theme, text size and the open-with choice can also be set on the device's settings page; choices made here win.", size: "xs", color: t.dim }));
  return screen({ id: "settings", url: urls.settings(input.feed), ttl: 0, refresh: refreshMode(t), keys: { short: home(), double: home() }, widgets });
}

// ---------------------------------------------------------------------------------------------
// Comments

export interface StoryInput {
  ctx: Ctx;
  thread: Thread;
  folds: Set<number>;
  page: number;
  saved: boolean;
}

function storyFacts(s: Story, now: number, w: number): string {
  return fitFacts([`${s.points} pts`, `${s.comments} ${s.comments === 1 ? "comment" : "comments"}`, timeAgo(s.time, now), s.author, domainOf(s.url)], w);
}

/** hn-t5 buildCommentDoc: header block, then comments with folded subtrees skipped. */
export function buildCommentDoc(thread: Thread, folds: Set<number>, ctx: Ctx, w: number): RLine[] {
  const ds = docStyle(ctx.settings.text_size);
  const doc: RLine[] = [];
  const s = thread.story;
  gap(doc, 4, ds);
  pushWrapped(doc, s.title, w, 0, 2, ds);
  gap(doc, 4, ds);
  doc.push({ text: storyFacts(s, ctx.now, w), indent: 0, style: 3, cidx: -1, h: ds.factsLH });
  if (s.text) {
    gap(doc, 5, ds);
    pushWrapped(doc, s.text, w, 0, 0, ds);
  }
  gap(doc, 5, ds);
  gap(doc, 4, ds);

  const comments = thread.comments;
  if (comments.length === 0) {
    doc.push({ text: "No comments yet.", indent: 0, style: 3, cidx: -1, h: ds.factsLH });
    return doc;
  }
  let skipDepth = -1;
  for (let i = 0; i < comments.length; i++) {
    const c: Comment = comments[i]!;
    if (skipDepth >= 0 && c.depth > skipDepth) continue;
    skipDepth = -1;
    const ind = Math.min(c.depth, MAX_DEPTH) * INDENT_PX;
    const head = [c.author, timeAgo(c.time, ctx.now)];
    const folded = folds.has(c.id);
    if (folded) {
      let replies = 0;
      for (let k = i + 1; k < comments.length && comments[k]!.depth > c.depth; k++) replies++;
      head.push(replies ? `+${replies} ${replies === 1 ? "reply" : "replies"}` : "folded");
      skipDepth = c.depth;
    }
    doc.push({ text: fitFacts(head, w - ind), indent: ind, style: 1, cidx: i, h: ds.bylineLH });
    if (!folded) pushWrapped(doc, c.text, w, ind, 0, ds);
    gap(doc, 5, ds, ind);
  }
  if (thread.truncated) doc.push({ text: "[Thread truncated; open the story on the web for the rest.]", indent: 0, style: 3, cidx: -1, h: ds.factsLH });
  return doc;
}

export function storyScreen(input: StoryInput): Screen {
  const { ctx, thread } = input;
  const g = geometry(ctx.screen, 2);
  const t = ctx.t;
  const s = thread.story;
  const doc = buildCommentDoc(thread, input.folds, ctx, g.colW);
  const starts = layoutDoc(doc, g.contentH);
  const pages = pageCount(starts, g.cols);
  const page = Math.min(Math.max(0, input.page), pages - 1);
  const pageUrl = (p: number) => urls.story(s.id, p);
  const ds = docStyle(ctx.settings.text_size);
  const fold = (cidx: number) => submit("fold", { args: { id: String(s.id), c: String(thread.comments[cidx]?.id ?? ""), page: String(page) } });

  const widgets: Widget[] = [...background(g, t), ...header(g, t, { title: APP_TITLE }), ...renderDocPage(doc, starts, page, g, t, { ds, fold })];
  const { prev, next } = pager(page, pages, pageUrl);
  const row1: Cell[] = [{ id: "save", icon: input.saved ? "bookmark" : "bookmark-outline", on_tap: submit("save", { args: { id: String(s.id), page: String(page), kind: "story" } }) }];
  if (s.url) row1.push({ id: "article", icon: "newspaper-variant-outline", on_tap: navigate(urls.article(s.id, 0, "story")) });
  row1.push({ id: "back", icon: "arrow-left", on_tap: back() });
  widgets.push(...toolbar(g, t, [row1, [prev, { plain: true, label: `${page + 1} / ${pages}` }, next]]));

  return screen({ id: "story", url: pageUrl(page), ttl: 0, refresh: refreshMode(t), keys: keysFor(page, pages, pageUrl, back()), widgets });
}

// ---------------------------------------------------------------------------------------------
// Reader mode

export interface ArticleInput {
  ctx: Ctx;
  story: Story;
  article: Article;
  page: number;
  saved: boolean;
  from: "list" | "story";
}

export function buildArticleDoc(story: Story, article: Article, ctx: Ctx, w: number): RLine[] {
  const ds = docStyle(ctx.settings.text_size);
  const doc: RLine[] = [];
  gap(doc, 4, ds);
  pushWrapped(doc, article.title || story.title, w, 0, 2, ds);
  gap(doc, 4, ds);
  doc.push({ text: fitFacts([domainOf(story.url), timeAgo(story.time, ctx.now)], w), indent: 0, style: 3, cidx: -1, h: ds.factsLH });
  gap(doc, 5, ds);
  gap(doc, 4, ds);
  let lastGap = true;
  for (const para of article.body.split("\n")) {
    if (para.trim() === "") {
      if (!lastGap) gap(doc, 4, ds);
      lastGap = true;
    } else if (para.startsWith("# ")) {
      if (!lastGap) gap(doc, 4, ds);
      pushWrapped(doc, para.slice(2), w, 0, 2, ds);
      lastGap = false;
    } else {
      pushWrapped(doc, para, w, 0, 0, ds);
      lastGap = false;
    }
  }
  return doc;
}

export function articleScreen(input: ArticleInput): Screen {
  const { ctx, story, article, from } = input;
  const g = geometry(ctx.screen, 2);
  const t = ctx.t;
  const doc = buildArticleDoc(story, article, ctx, g.colW);
  const starts = layoutDoc(doc, g.contentH);
  const pages = pageCount(starts, g.cols);
  const page = Math.min(Math.max(0, input.page), pages - 1);
  const pageUrl = (p: number) => urls.article(story.id, p, from);
  const ds = docStyle(ctx.settings.text_size);

  const widgets: Widget[] = [...background(g, t), ...header(g, t, { title: APP_TITLE }), ...renderDocPage(doc, starts, page, g, t, { ds })];
  const { prev, next } = pager(page, pages, pageUrl);
  widgets.push(
    ...toolbar(g, t, [
      [
        { id: "save", icon: input.saved ? "bookmark" : "bookmark-outline", on_tap: submit("save", { args: { id: String(story.id), page: String(page), kind: "article", from } }) },
        { id: "comments", icon: "comment-outline", on_tap: from === "story" ? back() : navigate(urls.story(story.id)) },
        { id: "back", icon: "arrow-left", on_tap: back() },
      ],
      [prev, { plain: true, label: `${page + 1} / ${pages}` }, next],
    ]),
  );
  return screen({ id: "article", url: pageUrl(page), ttl: 0, refresh: refreshMode(t), keys: keysFor(page, pages, pageUrl, back()), widgets });
}

export interface MessageInput {
  ctx: Ctx;
  story: Story;
  title: string;
  body: string;
  from: "list" | "story";
}

/** Shown when the article cannot be read; offers the thread instead (hn-t5 `message(..., articleFail)`). */
export function articleFailScreen(input: MessageInput): Screen {
  const { ctx, story, from } = input;
  const g = geometry(ctx.screen, 1);
  const t = ctx.t;
  const widgets: Widget[] = [
    ...background(g, t),
    ...header(g, t, { title: APP_TITLE }),
    text({ x: g.M, y: g.contentTop + 24, w: g.contentW, lines: 2, text: input.title, size: "lg", weight: "bold", color: t.ink }),
    text({ x: g.M, y: g.contentTop + 130, w: g.contentW, lines: 5, text: input.body, size: "md", color: t.dim }),
    text({ x: g.M, y: g.contentBot - 60, w: g.contentW, lines: 2, text: fitFacts([domainOf(story.url), story.title], g.contentW), size: "xs", color: t.dim }),
    ...toolbar(g, t, [
      [
        { id: "comments", label: "Comments", on_tap: from === "story" ? back() : navigate(urls.story(story.id)) },
        { id: "retry", label: "Retry", on_tap: refresh() },
        { id: "back", label: "Back", on_tap: back() },
      ],
    ]),
  ];
  return screen({ id: "article", url: urls.article(story.id, 0, from), ttl: 0, refresh: "auto", keys: { short: back(), double: back() }, widgets });
}
