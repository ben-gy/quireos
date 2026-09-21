// Test doubles: D1 over node:sqlite (same migration, real SQL) and an in-memory R2.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT, StatementSync } from "node:sqlite";

// Vite 5 (vitest 2) does not list node:sqlite as a builtin, so load it outside the resolver.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncT };
type DatabaseSync = DatabaseSyncT;
import type { Bindings } from "../src/env";
import { hmacHex, sha256Hex } from "../src/util";
import { createSession } from "../src/db";

type Param = string | number | null | Uint8Array | ArrayBuffer | boolean | bigint;

function toParam(v: unknown): string | number | null | Uint8Array | bigint {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v as string | number | Uint8Array | bigint;
}

function plain<T>(row: unknown): T {
  return row === undefined || row === null ? (null as T) : ({ ...(row as object) } as T);
}

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}
  private stmt(): StatementSync {
    return this.db.prepare(this.sql);
  }
  private args() {
    return this.params.map(toParam) as never[];
  }
  bind(...values: unknown[]) {
    const s = new FakeStatement(this.db, this.sql);
    s.params = values;
    return s;
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = plain<Record<string, unknown>>(this.stmt().get(...this.args()));
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T = Record<string, unknown>>() {
    const results = this.stmt().all(...this.args()).map((r) => plain<T>(r));
    return { results, success: true as const, meta: { duration: 0, changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0, size_after: 0, changed_db: false } };
  }
  async run<T = Record<string, unknown>>() {
    const r = this.stmt().run(...this.args());
    return { results: [] as T[], success: true as const, meta: { duration: 0, changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), rows_read: 0, rows_written: 0, size_after: 0, changed_db: true } };
  }
  async raw<T = unknown[]>() {
    return this.stmt().all(...this.args()).map((r) => Object.values(r as object)) as T[];
  }
}

export class FakeD1 {
  readonly sqlite: DatabaseSync;
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    return new FakeStatement(this.sqlite, sql);
  }
  async batch(stmts: FakeStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
  async dump() {
    return new ArrayBuffer(0);
  }
  withSession() {
    return this as unknown as D1DatabaseSession;
  }
}

type Stored = { bytes: Uint8Array; contentType?: string; etag: string };

export class FakeR2 {
  objects = new Map<string, Stored>();
  private obj(key: string, s: Stored) {
    const bytes = s.bytes;
    return {
      key,
      size: bytes.byteLength,
      etag: s.etag,
      httpEtag: `"${s.etag}"`,
      httpMetadata: { contentType: s.contentType },
      customMetadata: {},
      uploaded: new Date(),
      body: new Blob([bytes]).stream(),
      bodyUsed: false,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      writeHttpMetadata(h: Headers) {
        if (s.contentType) h.set("Content-Type", s.contentType);
      },
    };
  }
  async put(key: string, value: Uint8Array | ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    const s = { bytes, contentType: opts?.httpMetadata?.contentType, etag: (await sha256Hex(bytes)).slice(0, 32) };
    this.objects.set(key, s);
    return this.obj(key, s);
  }
  async get(key: string) {
    const s = this.objects.get(key);
    return s ? this.obj(key, s) : null;
  }
  async head(key: string) {
    return this.get(key);
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(opts?: { prefix?: string; cursor?: string }) {
    const objects = [...this.objects.entries()].filter(([k]) => !opts?.prefix || k.startsWith(opts.prefix)).map(([k, s]) => this.obj(k, s));
    return { objects, truncated: false as const, cursor: undefined, delimitedPrefixes: [] as string[] };
  }
}

export type TestEnv = Bindings & { DB: D1Database; BUNDLES: R2Bucket; fakeDb: FakeD1; fakeR2: FakeR2 };

export function makeEnv(): TestEnv {
  const fakeDb = new FakeD1();
  const fakeR2 = new FakeR2();
  return {
    DB: fakeDb as unknown as D1Database,
    BUNDLES: fakeR2 as unknown as R2Bucket,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } as unknown as Fetcher,
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    SESSION_SECRET: "test-session-secret-0123456789",
    STORE_NAME: "Test Store",
    fakeDb,
    fakeR2,
  };
}

// ---- fixtures ----------------------------------------------------------------

let githubSeq = 1000;
export async function createUser(env: TestEnv, login: string, admin = false): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO users (github_id, login, name, avatar_url, is_admin, created_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .bind(githubSeq++, login, login.toUpperCase(), admin ? 1 : 0, new Date().toISOString())
    .run();
  return r.meta.last_row_id;
}

export async function createAppRow(
  env: TestEnv,
  a: { slug: string; owner_id: number; kind?: "hosted" | "external"; visibility?: "private" | "unlisted" | "public"; manifest_url?: string | null; name?: string; categories?: string[]; unlisted_by_admin?: boolean },
): Promise<void> {
  const t = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO apps (slug, owner_id, name, tagline, kind, manifest_url, visibility, categories, created_at, updated_at, unlisted_by_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(a.slug, a.owner_id, a.name ?? a.slug, `${a.slug} tagline`, a.kind ?? "hosted", a.manifest_url ?? null, a.visibility ?? "public", JSON.stringify(a.categories ?? []), t, t, a.unlisted_by_admin ? 1 : 0)
    .run();
}

export function manifestFor(slug: string, version = "1.0.0", extra: Record<string, unknown> = {}) {
  return { spec_version: 1, id: slug, name: slug.slice(0, 24), version, min_os: "0.1.0", icon: "star", entry: "/home.json", ...extra };
}

export async function publishRow(env: TestEnv, slug: string, version = "1.0.0", opts: { hosted?: boolean; manifest?: Record<string, unknown> } = {}): Promise<void> {
  const hosted = opts.hosted ?? true;
  const m = opts.manifest ?? manifestFor(slug, version, hosted ? { entry: `/a/${slug}/${version}/home.json` } : {});
  await env.DB.prepare(
    `INSERT INTO app_versions (app_slug, version, min_os, bundle_prefix, manifest_json, changelog, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(slug, version, "0.1.0", hosted ? `bundles/${slug}/${version}/` : null, JSON.stringify(m), "", new Date().toISOString())
    .run();
}

/** Signs in `userId`: returns the Cookie header value and a valid CSRF token. */
export async function signIn(env: TestEnv, userId: number): Promise<{ cookie: string; csrf: string }> {
  const token = await createSession(env.DB, userId);
  return { cookie: `qs_session=${token}`, csrf: await hmacHex(env.SESSION_SECRET, `csrf:s:${token}`) };
}

export function form(fields: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() };
}

export function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

/** A structurally valid PNG header (signature + IHDR) of the given size; enough for our checks. */
export function fakePng(w = 96, h = 96): Uint8Array {
  const b = new Uint8Array(8 + 4 + 4 + 13 + 4);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b.set([8, 0, 0, 0, 0], 24);
  return b;
}

/** Flash message carried by a redirect's Location query (?ok=… / ?err=…). */
export function flash(res: Response): string {
  const u = new URL(res.headers.get("Location") ?? "/", "http://x");
  return u.searchParams.get("ok") ?? u.searchParams.get("err") ?? "";
}
