/**
 * Per-install state in Workers KV (binding `HN_KV`): settings overrides, bookmarks, read ids and
 * fold state per thread. Without the binding (or in tests) an in-memory map stands in, which
 * lasts as long as the isolate — fine for `wrangler dev`, not for production.
 */
import type { Feed, Story } from "./hn.js";

export type TextSize = "sm" | "md" | "lg";

export interface Prefs {
  dark?: boolean;
  text_size?: TextSize;
  open_article?: boolean;
  feed?: Feed;
}

export const MAX_BOOKMARKS = 200;
export const MAX_READ_IDS = 1500;
const FOLD_TTL = 7 * 86400;

export interface HnStore {
  getPrefs(install: string): Promise<Prefs>;
  setPrefs(install: string, prefs: Prefs): Promise<void>;
  getBookmarks(install: string): Promise<Story[]>;
  setBookmarks(install: string, list: Story[]): Promise<void>;
  getRead(install: string): Promise<number[]>;
  setRead(install: string, ids: number[]): Promise<void>;
  getFolds(install: string, story: number): Promise<number[]>;
  setFolds(install: string, story: number, ids: number[]): Promise<void>;
}

interface Backend {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttl?: number): Promise<void>;
}

const memory = new Map<string, string>();
const memoryBackend: Backend = {
  async get(key) {
    return memory.get(key) ?? null;
  },
  async put(key, value) {
    memory.set(key, value);
  },
};

function kvBackend(kv: KVNamespace): Backend {
  return {
    get: (key) => kv.get(key, "text"),
    put: (key, value, ttl) => kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
  };
}

async function readJson<T>(b: Backend, key: string, fallback: T): Promise<T> {
  const raw = await b.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function makeStore(kv?: KVNamespace): HnStore {
  const b = kv ? kvBackend(kv) : memoryBackend;
  const k = (kind: string, install: string, extra?: string | number) => `${kind}:${install || "anon"}${extra !== undefined ? `:${extra}` : ""}`;
  return {
    getPrefs: (i) => readJson<Prefs>(b, k("p", i), {}),
    setPrefs: (i, p) => b.put(k("p", i), JSON.stringify(p)),
    getBookmarks: async (i) => {
      const list = await readJson<Story[]>(b, k("b", i), []);
      return Array.isArray(list) ? list : [];
    },
    setBookmarks: (i, list) => b.put(k("b", i), JSON.stringify(list.slice(0, MAX_BOOKMARKS))),
    getRead: async (i) => {
      const ids = await readJson<number[]>(b, k("r", i), []);
      return Array.isArray(ids) ? ids : [];
    },
    setRead: (i, ids) => b.put(k("r", i), JSON.stringify(ids.slice(-MAX_READ_IDS))),
    getFolds: async (i, s) => {
      const ids = await readJson<number[]>(b, k("f", i, s), []);
      return Array.isArray(ids) ? ids : [];
    },
    setFolds: (i, s, ids) => b.put(k("f", i, s), JSON.stringify(ids), FOLD_TTL),
  };
}

/** Test hook. */
export function clearMemoryStore(): void {
  memory.clear();
}

/** Effective settings: manifest defaults ← `X-App-Settings` ← in-app overrides. */
export interface Settings {
  dark: boolean;
  text_size: TextSize;
  open_article: boolean;
  feed: Feed;
}

const isSize = (v: unknown): v is TextSize => v === "sm" || v === "md" || v === "lg";
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);

export function resolveSettings(appSettings: Record<string, unknown>, prefs: Prefs): Settings {
  return {
    dark: prefs.dark ?? asBool(appSettings.dark) ?? false,
    text_size: prefs.text_size ?? (isSize(appSettings.text_size) ? appSettings.text_size : "md"),
    open_article: prefs.open_article ?? asBool(appSettings.open_article) ?? false,
    feed: prefs.feed ?? "top",
  };
}
