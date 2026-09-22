/**
 * Hacker News for QuireOS. Routes (from createApp):
 *   GET  /manifest.json
 *   GET  /screens/home.json?feed=top|new|best|ask|show|jobs|saved&page=N   story list
 *   GET  /screens/feeds.json?feed=…                                        categories
 *   GET  /screens/settings.json?feed=…                                     settings
 *   GET  /screens/story.json?id=N&page=N                                   comments
 *   GET  /screens/article.json?id=N&page=N&from=list|story                 reader mode
 *   POST /event   read · refresh · feed · setting · fold · save
 *
 * Navigation: page turns `navigate` with `replace`, so history holds one entry per screen; taps
 * that change server state are `submit` events (a row tap submits `read` and then navigates).
 */
import { AppError, createApp } from "@quireos/sdk";
import type { AppContext, Screen, SubmitEvent } from "@quireos/sdk";
import type { Env } from "./env.js";
import { evictFeed, fetchFeed, fetchThread, isFeed } from "./hn.js";
import type { Feed, Story } from "./hn.js";
import { manifest } from "./manifest.js";
import { articleFor } from "./reader.js";
import { articleFailScreen, articleScreen, feedsScreen, listScreen, settingsScreen, storyScreen } from "./screens.js";
import type { Ctx, ListFeed } from "./screens.js";
import { makeStore, resolveSettings } from "./store.js";
import type { HnStore, Prefs, Settings, TextSize } from "./store.js";
import { theme } from "./layout.js";

export { manifest };

/** Injection point for tests: replace `deps.fetch` to serve fixtures. */
export const deps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

interface Req {
  install: string;
  store: HnStore;
  prefs: Prefs;
  settings: Settings;
  ctx: Ctx;
}

async function prepare(app: AppContext<Env>): Promise<Req> {
  const install = app.device.installId || app.device.id || "anon";
  const store = makeStore(app.env?.HN_KV);
  const prefs = await store.getPrefs(install);
  const settings = resolveSettings(app.device.settings, prefs);
  return { install, store, prefs, settings, ctx: { screen: app.device.screen, t: theme(settings.dark), settings, now: Math.floor(Date.now() / 1000) } };
}

function intParam(v: string | null | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function listFeedParam(v: string | null | undefined, fallback: Feed): ListFeed {
  return v === "saved" ? "saved" : isFeed(v) ? v : fallback;
}

async function storiesFor(feed: ListFeed, r: Req, force = false): Promise<Story[]> {
  return feed === "saved" ? r.store.getBookmarks(r.install) : fetchFeed(feed, { fetch: deps.fetch, now: r.ctx.now, force });
}

async function list(feed: ListFeed, page: number, r: Req): Promise<Screen> {
  const [stories, readIds] = await Promise.all([storiesFor(feed, r), r.store.getRead(r.install)]);
  return listScreen({ ctx: r.ctx, feed, stories, read: new Set(readIds), page });
}

function requireId(id: number): number {
  if (!id) throw new AppError("bad_request", "Missing story id", 400);
  return id;
}

async function story(id: number, page: number, r: Req): Promise<Screen> {
  requireId(id);
  const [thread, folds, bookmarks] = await Promise.all([fetchThread(id, { fetch: deps.fetch }), r.store.getFolds(r.install, id), r.store.getBookmarks(r.install)]);
  return storyScreen({ ctx: r.ctx, thread, folds: new Set(folds), page, saved: bookmarks.some((b) => b.id === id) });
}

async function article(id: number, page: number, from: "list" | "story", r: Req, force = false): Promise<Screen> {
  requireId(id);
  const [thread, bookmarks] = await Promise.all([fetchThread(id, { fetch: deps.fetch }), r.store.getBookmarks(r.install)]);
  const s = thread.story;
  const saved = bookmarks.some((b) => b.id === id);
  if (!s.url) return articleFailScreen({ ctx: r.ctx, story: s, title: "No article", body: "This story has no link; it is a text post. Read it in the comments view.", from });
  const res = await articleFor(id, s.url, deps.fetch, force);
  if (!res.ok) return articleFailScreen({ ctx: r.ctx, story: s, title: "Could not read article", body: res.reason, from });
  return articleScreen({ ctx: r.ctx, story: s, article: res.article, page, saved, from });
}

async function settings(feed: ListFeed, r: Req): Promise<Screen> {
  return settingsScreen({ ctx: r.ctx, feed, readCount: (await r.store.getRead(r.install)).length });
}

const SIZES: TextSize[] = ["sm", "md", "lg"];

async function onEvent(ev: SubmitEvent, app: AppContext<Env>): Promise<Screen | null> {
  const r = await prepare(app);
  const a = ev.args ?? {};
  const id = intParam(a.id);
  const page = intParam(a.page);
  switch (ev.event) {
    case "read": {
      if (!id) return null;
      const ids = await r.store.getRead(r.install);
      if (!ids.includes(id)) await r.store.setRead(r.install, [...ids, id]);
      return null;
    }
    case "refresh": {
      if (isFeed(a.feed)) await evictFeed(a.feed);
      return null;
    }
    case "feed": {
      const feed = listFeedParam(a.feed, r.settings.feed);
      if (feed !== "saved" && feed !== r.prefs.feed) {
        r.prefs.feed = feed;
        r.settings.feed = feed;
        await r.store.setPrefs(r.install, r.prefs);
      }
      return list(feed, 0, r);
    }
    case "setting": {
      const feed = listFeedParam(a.feed, r.settings.feed);
      switch (a.key) {
        case "dark":
          r.prefs.dark = !r.settings.dark;
          break;
        case "text_size":
          r.prefs.text_size = SIZES[(SIZES.indexOf(r.settings.text_size) + 1) % SIZES.length]!;
          break;
        case "open_article":
          r.prefs.open_article = !r.settings.open_article;
          break;
        case "mark_read": {
          const stories = await storiesFor(feed, r);
          const ids = new Set(await r.store.getRead(r.install));
          for (const s of stories) ids.add(s.id);
          await r.store.setRead(r.install, [...ids]);
          break;
        }
        case "clear_read":
          await r.store.setRead(r.install, []);
          break;
        default:
          return null;
      }
      if (a.key === "dark" || a.key === "text_size" || a.key === "open_article") await r.store.setPrefs(r.install, r.prefs);
      const s = resolveSettings(app.device.settings, r.prefs);
      r.settings = s;
      r.ctx = { ...r.ctx, settings: s, t: theme(s.dark) };
      return settings(feed, r);
    }
    case "fold": {
      const c = intParam(a.c);
      if (!id || !c) return null;
      const folds = await r.store.getFolds(r.install, id);
      const next = folds.includes(c) ? folds.filter((x) => x !== c) : [...folds, c];
      await r.store.setFolds(r.install, id, next);
      return story(id, page, r);
    }
    case "save": {
      if (!id) return null;
      const [thread, bookmarks] = await Promise.all([fetchThread(id, { fetch: deps.fetch }), r.store.getBookmarks(r.install)]);
      const next = bookmarks.some((b) => b.id === id) ? bookmarks.filter((b) => b.id !== id) : [{ ...thread.story, text: undefined }, ...bookmarks];
      await r.store.setBookmarks(r.install, next);
      const from = a.from === "story" ? "story" : "list";
      return a.kind === "article" ? article(id, page, from, r) : story(id, page, r);
    }
    default:
      return null;
  }
}

export default createApp<Env>({
  manifest,
  screens: {
    home: async (app, url) => {
      const r = await prepare(app);
      return list(listFeedParam(url.searchParams.get("feed"), r.settings.feed), intParam(url.searchParams.get("page")), r);
    },
    feeds: async (app, url) => {
      const r = await prepare(app);
      return feedsScreen({ ctx: r.ctx, current: listFeedParam(url.searchParams.get("feed"), r.settings.feed), savedCount: (await r.store.getBookmarks(r.install)).length });
    },
    settings: async (app, url) => {
      const r = await prepare(app);
      return settings(listFeedParam(url.searchParams.get("feed"), r.settings.feed), r);
    },
    story: async (app, url) => {
      const r = await prepare(app);
      return story(intParam(url.searchParams.get("id")), intParam(url.searchParams.get("page")), r);
    },
    article: async (app, url) => {
      const r = await prepare(app);
      const force = url.searchParams.get("retry") === "1";
      return article(intParam(url.searchParams.get("id")), intParam(url.searchParams.get("page")), url.searchParams.get("from") === "story" ? "story" : "list", r, force);
    },
  },
  onEvent,
});
