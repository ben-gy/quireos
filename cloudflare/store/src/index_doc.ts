// Builds the spec §4 store index document and per-app entries.
import type { AppListing } from "./db";
import { installCounts, listIndexApps } from "./db";
import type { Device, User } from "./env";
import { parseJsonArray, sha256Hex } from "./util";
import type { Manifest, StoreIndex, StoreApp } from "./validate";

export function parseManifest(json: string | null): Manifest | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Manifest;
  } catch {
    return null;
  }
}

/** Absolute manifest URL for the app's latest (or given) version. */
export function manifestUrl(app: AppListing, origin: string, version = app.latest_version): string | null {
  if (app.kind === "hosted") return version ? `${origin}/a/${app.slug}/${version}/manifest.json` : null;
  return app.manifest_url;
}

/** Icon for the index: uploaded store icon first, then the manifest's icon (name or URL). */
export function iconFor(app: AppListing, origin: string): string {
  if (app.icon_key) return `${origin}/${app.icon_key}`;
  const m = parseManifest(app.latest_manifest_json);
  const icon = typeof m?.icon === "string" ? m.icon : "";
  if (!icon) return "apps";
  if (/^https?:\/\//.test(icon)) return icon;
  if (icon.startsWith("/")) {
    // Hosted bundle URLs were rebased to /a/<slug>/<version>/… at publish time.
    const base = app.kind === "hosted" ? origin : safeOrigin(app.manifest_url) ?? origin;
    return base + icon;
  }
  return icon; // icon name from spec/icons.json
}

function safeOrigin(u: string | null): string | null {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

/** Can this caller see the app at all (detail page, bundle files)? */
export function canSee(app: AppListing, user: User | null, device: Device | null): boolean {
  if (user && (user.id === app.owner_id || user.is_admin)) return true;
  if (device && device.user_id !== null && device.user_id === app.owner_id) return true;
  if (app.unlisted_by_admin) return false;
  return app.visibility === "public" || app.visibility === "unlisted";
}

/** Should the app appear in a listing (index/browse) for this caller? */
export function isListedFor(app: AppListing, userId: number | null): boolean {
  if (!app.latest_version) return false;
  if (userId !== null && app.owner_id === userId) return true;
  return app.visibility === "public" && !app.unlisted_by_admin;
}

export function indexEntry(app: AppListing, origin: string, installs: number, authed: boolean): StoreApp | null {
  const manifest = manifestUrl(app, origin);
  if (!app.latest_version || !manifest) return null;
  const m = parseManifest(app.latest_manifest_json);
  const screens = parseJsonArray(app.screens);
  const categories = parseJsonArray(app.categories);
  const entry: StoreApp = {
    id: app.slug,
    name: app.name,
    tagline: app.tagline,
    icon: iconFor(app, origin),
    version: app.latest_version,
    manifest,
    min_os: app.latest_min_os ?? app.min_os ?? m?.min_os ?? "0.1.0",
  };
  if (screens.length) entry.screens = screens;
  if (categories.length) entry.categories = categories;
  entry.author = app.owner_login;
  entry.kind = app.kind;
  if (authed) entry.visibility = app.visibility;
  entry.installs = installs;
  return entry;
}

export async function buildIndex(
  db: D1Database,
  opts: { origin: string; storeName: string; device: Device | null },
): Promise<{ doc: StoreIndex; body: string; etag: string }> {
  const userId = opts.device?.user_id ?? null;
  const authed = opts.device !== null;
  const [apps, counts] = await Promise.all([listIndexApps(db, userId), installCounts(db)]);
  const entries: StoreApp[] = [];
  let updated = "";
  for (const app of apps) {
    if (!isListedFor(app, userId)) continue;
    const e = indexEntry(app, opts.origin, counts.get(app.slug) ?? 0, authed);
    if (!e) continue;
    entries.push(e);
    for (const t of [app.updated_at, app.latest_published_at]) if (t && t > updated) updated = t;
  }
  const doc: StoreIndex = {
    spec_version: 1,
    store: { name: opts.storeName, updated: updated || new Date(0).toISOString() },
    apps: entries,
  };
  const body = JSON.stringify(doc);
  const etag = `"${await sha256Hex(body)}"`;
  return { doc, body, etag };
}
