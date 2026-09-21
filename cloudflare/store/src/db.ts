// Typed D1 queries. Every function takes the D1Database so tests can pass a fake.
import type { Device, User } from "./env";
import { compareVersions, isoIn, nowIso, randomToken, sha256Hex } from "./util";

export type Visibility = "private" | "unlisted" | "public";
export type Kind = "hosted" | "external";

export type AppRow = {
  slug: string;
  owner_id: number;
  name: string;
  tagline: string;
  icon_key: string | null;
  kind: Kind;
  manifest_url: string | null;
  visibility: Visibility;
  categories: string; // JSON
  min_os: string | null;
  screens: string | null; // JSON
  description: string;
  screenshots: string; // JSON
  created_at: string;
  updated_at: string;
  unlisted_by_admin: number;
};

export type VersionRow = {
  id: number;
  app_slug: string;
  version: string;
  min_os: string;
  bundle_prefix: string | null;
  manifest_json: string;
  changelog: string;
  published_at: string;
};

/** An app joined with its owner's login and latest published version (may be null). */
export type AppListing = AppRow & {
  owner_login: string;
  latest_version: string | null;
  latest_min_os: string | null;
  latest_manifest_json: string | null;
  latest_bundle_prefix: string | null;
  latest_published_at: string | null;
};

const LISTING_SELECT = `
  SELECT a.*, u.login AS owner_login,
         v.version AS latest_version, v.min_os AS latest_min_os,
         v.manifest_json AS latest_manifest_json, v.bundle_prefix AS latest_bundle_prefix,
         v.published_at AS latest_published_at
  FROM apps a
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN app_versions v ON v.id = (
    SELECT id FROM app_versions WHERE app_slug = a.slug ORDER BY published_at DESC, id DESC LIMIT 1
  )`;

// ---- users ----------------------------------------------------------------

export async function getUser(db: D1Database, id: number): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

export async function upsertGithubUser(
  db: D1Database,
  u: { github_id: number; login: string; name: string | null; avatar_url: string | null },
): Promise<User> {
  await db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
    )
    .bind(u.github_id, u.login, u.name, u.avatar_url, nowIso())
    .run();
  const row = await db.prepare("SELECT * FROM users WHERE github_id = ?").bind(u.github_id).first<User>();
  if (!row) throw new Error("user upsert failed");
  return row;
}

// ---- sessions -------------------------------------------------------------

export const SESSION_TTL_S = 30 * 24 * 3600;

/** Creates a session and returns the cookie value (the DB stores only its hash). */
export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomToken();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()), // opportunistic cleanup
    db
      .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), userId, isoIn(SESSION_TTL_S), nowIso()),
  ]);
  return token;
}

export async function getSessionUser(db: D1Database, token: string): Promise<User | null> {
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<User>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

// ---- apps -----------------------------------------------------------------

export async function getApp(db: D1Database, slug: string): Promise<AppListing | null> {
  return db.prepare(`${LISTING_SELECT} WHERE a.slug = ?`).bind(slug).first<AppListing>();
}

export async function listAppsForOwner(db: D1Database, ownerId: number): Promise<AppListing[]> {
  const r = await db.prepare(`${LISTING_SELECT} WHERE a.owner_id = ? ORDER BY a.updated_at DESC`).bind(ownerId).all<AppListing>();
  return r.results;
}

export async function listAllApps(db: D1Database): Promise<AppListing[]> {
  const r = await db.prepare(`${LISTING_SELECT} ORDER BY a.updated_at DESC`).all<AppListing>();
  return r.results;
}

/**
 * Apps for the index: public listed apps with a published version, plus (when
 * userId is given) that user's own apps of any visibility.
 */
export async function listIndexApps(db: D1Database, userId: number | null): Promise<AppListing[]> {
  const stmt =
    userId === null
      ? db.prepare(
          `${LISTING_SELECT} WHERE v.id IS NOT NULL AND a.visibility = 'public' AND a.unlisted_by_admin = 0 ORDER BY a.slug`,
        )
      : db
          .prepare(
            `${LISTING_SELECT} WHERE v.id IS NOT NULL AND ((a.visibility = 'public' AND a.unlisted_by_admin = 0) OR a.owner_id = ?) ORDER BY a.slug`,
          )
          .bind(userId);
  return (await stmt.all<AppListing>()).results;
}

export async function countAppsForOwner(db: D1Database, ownerId: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM apps WHERE owner_id = ?").bind(ownerId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function createApp(
  db: D1Database,
  a: { slug: string; owner_id: number; name: string; tagline: string; kind: Kind; manifest_url: string | null },
): Promise<void> {
  const t = nowIso();
  await db
    .prepare(
      `INSERT INTO apps (slug, owner_id, name, tagline, kind, manifest_url, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
    )
    .bind(a.slug, a.owner_id, a.name, a.tagline, a.kind, a.manifest_url, t, t)
    .run();
}

export async function updateAppDetails(
  db: D1Database,
  slug: string,
  d: {
    name: string;
    tagline: string;
    categories: string[];
    visibility: Visibility;
    manifest_url: string | null;
    description: string;
    screenshots: string[];
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE apps SET name = ?, tagline = ?, categories = ?, visibility = ?, manifest_url = ?, description = ?, screenshots = ?, updated_at = ?
       WHERE slug = ?`,
    )
    .bind(
      d.name,
      d.tagline,
      JSON.stringify(d.categories),
      d.visibility,
      d.manifest_url,
      d.description,
      JSON.stringify(d.screenshots),
      nowIso(),
      slug,
    )
    .run();
}

export async function setAppIcon(db: D1Database, slug: string, iconKey: string | null): Promise<void> {
  await db.prepare("UPDATE apps SET icon_key = ?, updated_at = ? WHERE slug = ?").bind(iconKey, nowIso(), slug).run();
}

export async function setUnlistedByAdmin(db: D1Database, slug: string, flag: boolean): Promise<void> {
  await db.prepare("UPDATE apps SET unlisted_by_admin = ?, updated_at = ? WHERE slug = ?").bind(flag ? 1 : 0, nowIso(), slug).run();
}

export async function deleteApp(db: D1Database, slug: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM app_versions WHERE app_slug = ?").bind(slug),
    db.prepare("DELETE FROM reports WHERE app_slug = ?").bind(slug),
    db.prepare("DELETE FROM installs WHERE app_slug = ?").bind(slug),
    db.prepare("DELETE FROM apps WHERE slug = ?").bind(slug),
  ]);
}

// ---- versions -------------------------------------------------------------

export async function listVersions(db: D1Database, slug: string): Promise<VersionRow[]> {
  const r = await db.prepare("SELECT * FROM app_versions WHERE app_slug = ?").bind(slug).all<VersionRow>();
  return r.results.sort((a, b) => compareVersions(b.version, a.version));
}

export async function getVersion(db: D1Database, slug: string, version: string): Promise<VersionRow | null> {
  return db.prepare("SELECT * FROM app_versions WHERE app_slug = ? AND version = ?").bind(slug, version).first<VersionRow>();
}

/** Inserts an immutable version and refreshes the app's manifest-derived fields in one batch. */
export async function publishVersion(
  db: D1Database,
  v: {
    app_slug: string;
    version: string;
    min_os: string;
    bundle_prefix: string | null;
    manifest_json: string;
    changelog: string;
    name: string;
    screens: string[] | null;
    /** Listing fields from the bundle's store.json; undefined leaves the column alone. */
    listing?: { tagline?: string; description?: string; categories?: string[]; screenshots?: string[] };
  },
): Promise<void> {
  const t = nowIso();
  const l = v.listing ?? {};
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_versions (app_slug, version, min_os, bundle_prefix, manifest_json, changelog, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(v.app_slug, v.version, v.min_os, v.bundle_prefix, v.manifest_json, v.changelog, t),
    db
      .prepare(
        `UPDATE apps SET name = ?, min_os = ?, screens = ?, updated_at = ?,
           tagline = COALESCE(?, tagline), description = COALESCE(?, description),
           categories = COALESCE(?, categories), screenshots = COALESCE(?, screenshots)
         WHERE slug = ?`,
      )
      .bind(
        v.name,
        v.min_os,
        v.screens ? JSON.stringify(v.screens) : null,
        t,
        l.tagline ?? null,
        l.description ?? null,
        l.categories ? JSON.stringify(l.categories) : null,
        l.screenshots ? JSON.stringify(l.screenshots) : null,
        v.app_slug,
      ),
  ]);
}

// ---- installs -------------------------------------------------------------

/**
 * Current install count per app: devices whose latest report for the app is not an uninstall.
 * "Latest" is by row id (monotonic), not timestamp, so same-millisecond reports cannot tie.
 */
export async function installCounts(db: D1Database): Promise<Map<string, number>> {
  const r = await db
    .prepare(
      `SELECT app_slug, COUNT(*) AS n FROM (
         SELECT device_id, app_slug, action, MAX(id) AS id FROM installs GROUP BY device_id, app_slug
       ) WHERE action != 'uninstall' GROUP BY app_slug`,
    )
    .all<{ app_slug: string; n: number }>();
  return new Map(r.results.map((x) => [x.app_slug, x.n]));
}

export async function recordInstall(
  db: D1Database,
  deviceId: string,
  slug: string,
  version: string,
  action: "install" | "uninstall" | "update",
): Promise<void> {
  await db
    .prepare("INSERT INTO installs (device_id, app_slug, version, action, at) VALUES (?, ?, ?, ?, ?)")
    .bind(deviceId, slug, version, action, nowIso())
    .run();
}

// ---- devices --------------------------------------------------------------

export async function getDeviceByTokenHash(db: D1Database, hash: string): Promise<Device | null> {
  return db.prepare("SELECT * FROM devices WHERE token_hash = ?").bind(hash).first<Device>();
}

export async function getDevice(db: D1Database, id: string): Promise<Device | null> {
  return db.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<Device>();
}

/**
 * Registers a device by hw_id. Re-registering keeps the device id but rotates
 * the token and drops the account pairing (anyone who knows a hw_id could
 * otherwise re-register and inherit access to the owner's private apps).
 */
export async function registerDevice(
  db: D1Database,
  d: { hw_id: string; os_version: string; screen: string },
): Promise<{ device_id: string; token: string }> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const t = nowIso();
  const existing = await db.prepare("SELECT id FROM devices WHERE hw_id = ?").bind(d.hw_id).first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE devices SET token_hash = ?, os_version = ?, screen = ?, last_seen = ?, user_id = NULL WHERE id = ?")
      .bind(hash, d.os_version, d.screen, t, existing.id)
      .run();
    return { device_id: existing.id, token };
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO devices (id, hw_id, os_version, screen, last_seen, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, d.hw_id, d.os_version, d.screen, t, hash, t)
    .run();
  return { device_id: id, token };
}

export async function touchDevice(db: D1Database, id: string, osVersion?: string | null, screen?: string | null): Promise<void> {
  await db
    .prepare("UPDATE devices SET last_seen = ?, os_version = COALESCE(?, os_version), screen = COALESCE(?, screen) WHERE id = ?")
    .bind(nowIso(), osVersion ?? null, screen ?? null, id)
    .run();
}

export async function listDevicesForUser(db: D1Database, userId: number): Promise<Device[]> {
  const r = await db.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen DESC").bind(userId).all<Device>();
  return r.results;
}

export async function renameDevice(db: D1Database, id: string, userId: number, name: string): Promise<void> {
  await db.prepare("UPDATE devices SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, userId).run();
}

export async function unpairDevice(db: D1Database, id: string, userId: number): Promise<void> {
  await db.prepare("UPDATE devices SET user_id = NULL WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

// ---- pairings -------------------------------------------------------------

export const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const PAIR_TTL_S = 600;

export function randomPairCode(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += PAIR_ALPHABET[x % PAIR_ALPHABET.length];
  return s;
}

export type Pairing = { code: string; device_id: string; expires_at: string; claimed_by: number | null; created_at: string };

export async function createPairing(db: D1Database, deviceId: string): Promise<{ code: string; expires_in: number }> {
  // One live code per device; old unclaimed codes are dropped.
  await db.prepare("DELETE FROM pairings WHERE device_id = ? AND claimed_by IS NULL").bind(deviceId).run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomPairCode();
    try {
      await db
        .prepare("INSERT INTO pairings (code, device_id, expires_at, claimed_by, created_at) VALUES (?, ?, ?, NULL, ?)")
        .bind(code, deviceId, isoIn(PAIR_TTL_S), nowIso())
        .run();
      return { code, expires_in: PAIR_TTL_S };
    } catch (err) {
      // Collision with a live code: retry; anything else propagates.
      if (!String((err as Error).message).includes("UNIQUE")) throw err;
    }
  }
  throw new Error("could not allocate a pairing code");
}

export async function getPairing(db: D1Database, code: string): Promise<Pairing | null> {
  return db.prepare("SELECT * FROM pairings WHERE code = ?").bind(code).first<Pairing>();
}

/** Claims an unexpired, unclaimed code for userId and pairs the device. Returns false when the code is not claimable. */
export async function claimPairing(db: D1Database, code: string, userId: number): Promise<boolean> {
  const p = await getPairing(db, code);
  if (!p || p.claimed_by !== null || p.expires_at <= nowIso()) return false;
  await db.batch([
    db.prepare("UPDATE pairings SET claimed_by = ? WHERE code = ? AND claimed_by IS NULL").bind(userId, code),
    db.prepare("UPDATE devices SET user_id = ? WHERE id = ?").bind(userId, p.device_id),
  ]);
  return true;
}

/** Best-effort cleanup of stale pairing rows (called opportunistically). */
export async function prunePairings(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM pairings WHERE expires_at < ?").bind(isoIn(-24 * 3600)).run();
}

// ---- reports --------------------------------------------------------------

export type ReportRow = { id: number; app_slug: string; reason: string; at: string; reporter_ip_hash: string };

export async function insertReport(db: D1Database, slug: string, reason: string, ipHash: string): Promise<void> {
  await db
    .prepare("INSERT INTO reports (app_slug, reason, at, reporter_ip_hash) VALUES (?, ?, ?, ?)")
    .bind(slug, reason, nowIso(), ipHash)
    .run();
}

export async function listReports(db: D1Database): Promise<ReportRow[]> {
  const r = await db.prepare("SELECT * FROM reports ORDER BY at DESC LIMIT 200").all<ReportRow>();
  return r.results;
}

// ---- rate limiting --------------------------------------------------------

/** Fixed-window counter. Returns true when the call is allowed. */
export async function rateLimit(db: D1Database, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const now = nowIso();
  const row = await db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first<{ count: number; window_start: string }>();
  const windowStartLimit = isoIn(-windowSeconds);
  if (!row || row.window_start < windowStartLimit) {
    await db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      )
      .bind(key, now)
      .run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}
