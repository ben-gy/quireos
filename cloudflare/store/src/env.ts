import type { Context } from "hono";

export type Bindings = {
  DB: D1Database;
  BUNDLES: R2Bucket;
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  STORE_NAME?: string;
  /** Optional origin override for absolute URLs (e.g. behind a custom domain). */
  PUBLIC_URL?: string;
};

export type User = {
  id: number;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: number;
  created_at: string;
};

export type Device = {
  id: string;
  hw_id: string;
  user_id: number | null;
  name: string | null;
  os_version: string | null;
  screen: string | null;
  last_seen: string | null;
  token_hash: string;
  created_at: string;
};

export type Variables = {
  user: User | null;
  /** Raw session cookie value (not the hash); used to derive the CSRF token. */
  sessionToken: string | null;
  device: Device | null;
};

export type Env = { Bindings: Bindings; Variables: Variables };
export type Ctx = Context<Env>;

/** Origin used in absolute URLs (manifest, icons, pairing URL). */
export function origin(c: Ctx): string {
  const override = c.env.PUBLIC_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return new URL(c.req.url).origin;
}

export function storeName(c: Ctx): string {
  return c.env.STORE_NAME || "QuireOS Store";
}
