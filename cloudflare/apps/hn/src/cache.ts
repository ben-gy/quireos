/**
 * Small JSON cache over the Workers Cache API with an in-memory fallback (Node tests, or when
 * `caches` is missing). Keys are synthetic URLs on a private host so they never collide with real
 * requests. `force` bypasses a cached value; `evict` drops one.
 */

interface MemEntry {
  exp: number;
  value: unknown;
}
const mem = new Map<string, MemEntry>();

function keyUrl(key: string): string {
  return `https://cache.quireos-hn.invalid/${key.replace(/[^a-z0-9/_.:-]/gi, "_")}`;
}

function cacheApi(): Cache | undefined {
  try {
    const c = (globalThis as { caches?: { default?: Cache } }).caches;
    return c?.default;
  } catch {
    return undefined;
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const url = keyUrl(key);
  const api = cacheApi();
  if (api) {
    try {
      const hit = await api.match(url);
      if (hit) return (await hit.json()) as T;
    } catch {
      /* fall through to memory */
    }
  }
  const m = mem.get(url);
  if (m && m.exp > Date.now()) return m.value as T;
  if (m) mem.delete(url);
  return undefined;
}

export async function cachePut(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const url = keyUrl(key);
  mem.set(url, { exp: Date.now() + ttlSeconds * 1000, value });
  if (mem.size > 200) {
    const now = Date.now();
    for (const [k, v] of mem) if (v.exp <= now) mem.delete(k);
  }
  const api = cacheApi();
  if (api) {
    try {
      await api.put(url, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` } }));
    } catch {
      /* memory copy is enough */
    }
  }
}

export async function cacheEvict(key: string): Promise<void> {
  const url = keyUrl(key);
  mem.delete(url);
  const api = cacheApi();
  if (api) {
    try {
      await api.delete(url);
    } catch {
      /* ignore */
    }
  }
}

/** Returns the cached value or loads, stores and returns a fresh one. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;
  }
  const value = await load();
  await cachePut(key, value, ttlSeconds);
  return value;
}

/** Test hook. */
export function clearMemoryCache(): void {
  mem.clear();
}
