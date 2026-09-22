/**
 * Algolia Hacker News API client (https://hn.algolia.com/api/v1), a port of hn-t5/src/hn.cpp:
 * one request per feed, one per thread; the reply tree is flattened depth-first with the same caps.
 */
import { AppError } from "@quireos/sdk";
import { cached, cacheEvict } from "./cache.js";
import { clampBytes, foldGlyphs, htmlToText } from "./text.js";

export const MAX_STORIES = 60;
export const MAX_COMMENTS = 250;
export const MAX_COMMENT_CHARS = 60_000;
export const MAX_ONE_COMMENT = 2_500;
export const FILTER_DEPTH = 8;
/** Server-side feed cache (the device re-fetches list screens every 10 min). */
export const FEED_TTL = 300;
export const THREAD_TTL = 300;
export const API = "https://hn.algolia.com/api/v1/";

export type Feed = "top" | "new" | "best" | "ask" | "show" | "jobs";
export const FEEDS: { id: Feed; name: string; desc: string }[] = [
  { id: "top", name: "Top", desc: "The front page right now" },
  { id: "new", name: "New", desc: "Newest submissions, most recent first" },
  { id: "best", name: "Best", desc: "Highest scoring of the last 24 hours" },
  { id: "ask", name: "Ask HN", desc: "Questions put to the community" },
  { id: "show", name: "Show HN", desc: "Things people have made" },
  { id: "jobs", name: "Jobs", desc: "Who's hiring and job posts" },
];
export function isFeed(s: unknown): s is Feed {
  return typeof s === "string" && FEEDS.some((f) => f.id === s);
}
export function feedName(f: Feed): string {
  return FEEDS.find((x) => x.id === f)?.name ?? "Top";
}

export interface Story {
  id: number;
  title: string;
  url: string;
  author: string;
  points: number;
  comments: number;
  time: number;
  /** Self-post body (Ask HN, jobs) as plain text. */
  text?: string;
}

export interface Comment {
  id: number;
  author: string;
  text: string;
  depth: number;
  time: number;
}

export interface Thread {
  story: Story;
  comments: Comment[];
  truncated?: boolean;
}

export function feedUrl(feed: Feed, now = Math.floor(Date.now() / 1000)): string {
  switch (feed) {
    case "new":
      return `${API}search_by_date?tags=story&hitsPerPage=${MAX_STORIES}`;
    case "best": {
      const since = now > 90_000 ? now - 86_400 : 0;
      return `${API}search?tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${MAX_STORIES}`;
    }
    case "ask":
      return `${API}search?tags=ask_hn&hitsPerPage=${MAX_STORIES}`;
    case "show":
      return `${API}search?tags=show_hn&hitsPerPage=${MAX_STORIES}`;
    case "jobs":
      return `${API}search_by_date?tags=job&hitsPerPage=${MAX_STORIES}`;
    case "top":
    default:
      return `${API}search?tags=front_page&hitsPerPage=${MAX_STORIES}`;
  }
}

type J = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);

/** Parses an Algolia `search` response into stories (title folded to the device glyph set). */
export function parseFeed(json: unknown): Story[] {
  const hits = (json as J | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: Story[] = [];
  for (const h of hits as J[]) {
    const s: Story = {
      id: num(h.objectID),
      title: foldGlyphs(str(h.title)).trim(),
      url: str(h.url),
      author: str(h.author),
      points: num(h.points),
      comments: num(h.num_comments),
      time: num(h.created_at_i),
    };
    const st = str(h.story_text);
    if (st) s.text = clampBytes(htmlToText(st), 8000);
    if (s.id && s.title) out.push(s);
    if (out.length >= MAX_STORIES) break;
  }
  return out;
}

/** Parses an Algolia `items/:id` response into a story plus a depth-first list of comments. */
export function parseThread(json: unknown): Thread {
  const d = (json as J | null) ?? {};
  const story: Story = {
    id: num(d.id),
    title: foldGlyphs(str(d.title)).trim(),
    url: str(d.url),
    author: str(d.author),
    points: num(d.points),
    comments: 0,
    time: num(d.created_at_i),
  };
  const body = str(d.text);
  if (body) story.text = clampBytes(htmlToText(body), 8000);
  const comments: Comment[] = [];
  let chars = 0;
  let truncated = false;
  const walk = (kids: unknown, depth: number): void => {
    if (!Array.isArray(kids)) return;
    for (const c of kids as J[]) {
      if (comments.length >= MAX_COMMENTS || chars > MAX_COMMENT_CHARS) {
        truncated = true;
        return;
      }
      const author = str(c.author);
      const raw = str(c.text);
      if (raw && (author || raw)) {
        let text = htmlToText(raw);
        if (text.length > MAX_ONE_COMMENT) text = clampBytes(text, MAX_ONE_COMMENT);
        if (text) {
          chars += text.length;
          comments.push({ id: num(c.id), author: author || "[deleted]", text, depth: Math.min(depth, 10), time: num(c.created_at_i) });
        }
      }
      if (depth + 1 < FILTER_DEPTH) walk(c.children, depth + 1);
    }
  };
  walk(d.children, 0);
  story.comments = countAll(d.children);
  const t: Thread = { story, comments };
  if (truncated) t.truncated = true;
  return t;
}

function countAll(kids: unknown): number {
  if (!Array.isArray(kids)) return 0;
  let n = 0;
  for (const c of kids as J[]) {
    if (str(c.text)) n++;
    n += countAll(c.children);
  }
  return n;
}

export type Fetch = typeof fetch;

async function getJson(url: string, fetchFn: Fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: "application/json", "User-Agent": "QuireOS-hn/1.0 (+https://github.com/quireos)" } });
  } catch (err) {
    throw new AppError("upstream", `Hacker News is unreachable: ${(err as Error).message}`.slice(0, 120), 502);
  }
  if (!res.ok) throw new AppError("upstream", `Hacker News answered ${res.status}`, 502);
  try {
    return await res.json();
  } catch {
    throw new AppError("upstream", "Hacker News sent something that is not JSON", 502);
  }
}

export interface HnOptions {
  fetch?: Fetch;
  force?: boolean;
  now?: number;
}

export async function fetchFeed(feed: Feed, opts: HnOptions = {}): Promise<Story[]> {
  const stories = await cached(`feed/${feed}`, FEED_TTL, async () => parseFeed(await getJson(feedUrl(feed, opts.now), opts.fetch ?? fetch)), opts.force);
  if (stories.length === 0) throw new AppError("empty", "No stories returned", 502);
  return stories;
}

export function evictFeed(feed: Feed): Promise<void> {
  return cacheEvict(`feed/${feed}`);
}

export async function fetchThread(id: number, opts: HnOptions = {}): Promise<Thread> {
  const t = await cached(`thread/${id}`, THREAD_TTL, async () => parseThread(await getJson(`${API}items/${id}`, opts.fetch ?? fetch)), opts.force);
  if (!t.story.id) throw new AppError("not_found", `No story ${id}`, 404);
  return t;
}
