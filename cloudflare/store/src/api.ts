// Device API, spec §9. Base path /api/v1. JSON in, JSON out.
import { Hono } from "hono";
import {
  createPairing,
  getApp,
  getPairing,
  installCounts,
  listVersions,
  recordInstall,
  registerDevice,
} from "./db";
import { apiError, deviceAuth } from "./device_auth";
import type { Env } from "./env";
import { origin, storeName } from "./env";
import { buildIndex, canSee, indexEntry, manifestUrl } from "./index_doc";
import { etagMatches, HW_ID_RE, isVersion, parseJsonArray, SLUG_RE } from "./util";

const api = new Hono<Env>();

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// POST /devices {hw_id, os_version, screen} → {device_id, token}
api.post("/devices", async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return apiError(c, 400, "bad_request", "JSON body required");
  const hw_id = typeof body.hw_id === "string" ? body.hw_id.trim() : "";
  const os_version = typeof body.os_version === "string" ? body.os_version.trim() : "";
  const screen = typeof body.screen === "string" ? body.screen.trim() : "";
  if (!HW_ID_RE.test(hw_id)) return apiError(c, 400, "bad_request", "hw_id must match ^[A-Za-z0-9_-]{4,64}$");
  if (!isVersion(os_version)) return apiError(c, 400, "bad_request", "os_version must be MAJOR.MINOR.PATCH");
  if (screen.length > 40) return apiError(c, 400, "bad_request", "screen too long");
  const reg = await registerDevice(c.env.DB, { hw_id, os_version, screen });
  return c.json(reg, 200);
});

// POST /pair → {code, expires_in, url}
api.post("/pair", deviceAuth(true), async (c) => {
  const device = c.var.device!;
  const p = await createPairing(c.env.DB, device.id);
  return c.json({ ...p, url: `${origin(c)}/pair` }, 200);
});

// GET /pair/:code → 202 pending | 200 paired | 410 expired
api.get("/pair/:code", deviceAuth(true), async (c) => {
  const device = c.var.device!;
  const code = c.req.param("code").toUpperCase();
  const p = await getPairing(c.env.DB, code);
  if (!p || p.device_id !== device.id) return apiError(c, 404, "not_found", "Unknown pairing code");
  if (p.claimed_by !== null) {
    const user = await c.env.DB.prepare("SELECT login, name FROM users WHERE id = ?").bind(p.claimed_by).first<{ login: string; name: string | null }>();
    return c.json({ status: "paired", user: { login: user?.login ?? "", name: user?.name ?? null } }, 200);
  }
  if (p.expires_at <= new Date().toISOString()) return apiError(c, 410, "expired", "Pairing code expired");
  return c.json({ status: "pending" }, 202);
});

// GET /index → spec §4 document
api.get("/index", deviceAuth(false), async (c) => {
  const device = c.var.device;
  const { body, etag } = await buildIndex(c.env.DB, { origin: origin(c), storeName: storeName(c), device });
  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": device ? "private, max-age=300" : "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
    Vary: "Authorization",
  };
  if (etagMatches(c.req.header("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
  headers["Content-Type"] = "application/json; charset=utf-8";
  return new Response(body, { status: 200, headers });
});

// GET /apps/:slug → index entry + description, screenshots, changelog, versions
api.get("/apps/:slug", deviceAuth(false), async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG_RE.test(slug)) return apiError(c, 404, "not_found", "No such app");
  const app = await getApp(c.env.DB, slug);
  const device = c.var.device;
  if (!app || !canSee(app, null, device) || !app.latest_version) return apiError(c, 404, "not_found", "No such app");
  const o = origin(c);
  const counts = await installCounts(c.env.DB);
  const entry = indexEntry(app, o, counts.get(slug) ?? 0, device !== null);
  if (!entry) return apiError(c, 404, "not_found", "No such app");
  const versions = await listVersions(c.env.DB, slug);
  const doc = {
    spec_version: 1,
    ...entry,
    description: app.description,
    screenshots: parseJsonArray(app.screenshots),
    changelog: versions.map((v) => ({ version: v.version, published_at: v.published_at, notes: v.changelog })),
    versions: versions.map((v) => ({
      version: v.version,
      min_os: v.min_os,
      manifest: manifestUrl(app, o, v.version),
      published_at: v.published_at,
    })),
  };
  return c.json(doc, 200, { "Access-Control-Allow-Origin": "*", "Cache-Control": device ? "private, max-age=60" : "public, max-age=60", Vary: "Authorization" });
});

// POST /installs {app, version, action} → 204
api.post("/installs", deviceAuth(true), async (c) => {
  const device = c.var.device!;
  const body = await readJson(c.req.raw);
  if (!body) return apiError(c, 400, "bad_request", "JSON body required");
  const slug = typeof body.app === "string" ? body.app : "";
  const version = typeof body.version === "string" ? body.version : "";
  const action = body.action;
  if (!SLUG_RE.test(slug)) return apiError(c, 400, "bad_request", "app must be an app id");
  if (!isVersion(version)) return apiError(c, 400, "bad_request", "version must be MAJOR.MINOR.PATCH");
  if (action !== "install" && action !== "uninstall" && action !== "update")
    return apiError(c, 400, "bad_request", "action must be install|uninstall|update");
  const app = await getApp(c.env.DB, slug);
  if (!app || !canSee(app, null, device)) return apiError(c, 404, "not_found", "No such app");
  await recordInstall(c.env.DB, device.id, slug, version, action);
  return c.body(null, 204);
});

export default api;
