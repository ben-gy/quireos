// Developer web UI: browse, app pages, dashboard, app CRUD, publishing,
// devices, pairing, reports and admin. Server-rendered forms; no client JS.
import { Hono } from "hono";
import { csrfToken, loginStart, logout, oauthCallback, requireAdmin, requireCsrf, requireUser, sessionMiddleware } from "./auth";
import { deletePrefix, MAX_BUNDLE_BYTES, publishExternal, publishHostedBundle } from "./bundles";
import {
  claimPairing,
  countAppsForOwner,
  createApp,
  deleteApp,
  getApp,
  insertReport,
  installCounts,
  listAllApps,
  listAppsForOwner,
  listDevicesForUser,
  listIndexApps,
  listReports,
  listVersions,
  rateLimit,
  renameDevice,
  setAppIcon,
  setUnlistedByAdmin,
  unpairDevice,
  updateAppDetails,
  type Visibility,
} from "./db";
import type { Ctx, Env } from "./env";
import { origin, storeName } from "./env";
import { canSee, indexEntry, isListedFor, manifestUrl } from "./index_doc";
import { AdminPage } from "./pages/admin";
import { AppPage } from "./pages/app";
import { EditAppPage, NewAppPage } from "./pages/app_forms";
import { BrowsePage } from "./pages/browse";
import { DashboardPage } from "./pages/dashboard";
import { DevicesPage, PairPage } from "./pages/devices";
import { clientIp, isPng, parseCategories, parseJsonArray, parseUrlList, pngSize, sha256Hex, SLUG_RE, truncate } from "./util";

export const MAX_APPS_PER_USER = 20;
const MAX_ICON_BYTES = 200 * 1024;

const web = new Hono<Env>();
web.use("*", async (c, next) => {
  if (!c.env.SESSION_SECRET) return c.text("SESSION_SECRET is not configured. Copy .dev.vars.example to .dev.vars (see README.md).", 500);
  await next();
});
web.use("*", sessionMiddleware);

function pageProps(c: Ctx, title: string) {
  return { title, storeName: storeName(c), user: c.var.user, ok: c.req.query("ok") || undefined, err: c.req.query("err") || undefined };
}

function back(c: Ctx, path: string, q: { ok?: string; err?: string }): Response {
  const u = new URL(path, "http://x");
  if (q.ok) u.searchParams.set("ok", q.ok);
  if (q.err) u.searchParams.set("err", truncate(q.err, 600));
  return c.redirect(u.pathname + u.search);
}

function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function ownedApp(c: Ctx, slug: string) {
  if (!SLUG_RE.test(slug)) return null;
  const app = await getApp(c.env.DB, slug);
  if (!app) return null;
  const u = c.var.user!;
  return app.owner_id === u.id || u.is_admin ? app : null;
}

// ---- auth -------------------------------------------------------------------
web.get("/login", (c) => loginStart(c));
web.get("/auth/github/callback", (c) => oauthCallback(c));
web.get("/logout", (c) => logout(c));

// ---- browse -----------------------------------------------------------------
web.get("/", async (c) => {
  const o = origin(c);
  const [apps, counts] = await Promise.all([listIndexApps(c.env.DB, null), installCounts(c.env.DB)]);
  const active = c.req.query("category") || null;
  const cats = new Set<string>();
  const entries = [];
  for (const a of apps) {
    if (!isListedFor(a, null)) continue;
    const e = indexEntry(a, o, counts.get(a.slug) ?? 0, false);
    if (!e) continue;
    for (const cat of e.categories ?? []) cats.add(cat);
    if (!active || e.categories?.includes(active)) entries.push(e);
  }
  return c.html(<BrowsePage {...pageProps(c, storeName(c))} apps={entries} categories={[...cats].sort()} active={active} />);
});

web.get("/apps/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG_RE.test(slug)) return c.notFound();
  const app = await getApp(c.env.DB, slug);
  if (!app || !canSee(app, c.var.user, null)) return c.notFound();
  const o = origin(c);
  const counts = await installCounts(c.env.DB);
  const entry = indexEntry(app, o, counts.get(slug) ?? 0, false);
  const versions = await listVersions(c.env.DB, slug);
  return c.html(
    <AppPage
      {...pageProps(c, app.name)}
      app={app}
      entry={entry}
      versions={versions}
      screenshots={parseJsonArray(app.screenshots)}
      manifestFor={(v) => manifestUrl(app, o, v)}
      isOwner={!!c.var.user && (c.var.user.id === app.owner_id || !!c.var.user.is_admin)}
      csrf={await csrfToken(c)}
    />,
  );
});

web.post("/apps/:slug/report", requireCsrf, async (c) => {
  const slug = c.req.param("slug");
  const app = SLUG_RE.test(slug) ? await getApp(c.env.DB, slug) : null;
  if (!app || !canSee(app, c.var.user, null)) return c.notFound();
  const ipHash = await sha256Hex(`report:${clientIp(c.req.raw)}:${c.env.SESSION_SECRET}`);
  if (!(await rateLimit(c.env.DB, `report:${ipHash}`, 5, 3600))) return back(c, `/apps/${slug}`, { err: "Too many reports from your address; try later." });
  const body = await c.req.parseBody();
  const reason = `${str(body.kind, 32) || "other"}: ${str(body.details, 1000)}`;
  await insertReport(c.env.DB, slug, reason, ipHash);
  return back(c, `/apps/${slug}`, { ok: "Thanks, the report was recorded." });
});

// ---- dashboard --------------------------------------------------------------
web.get("/dashboard", requireUser, async (c) => {
  const u = c.var.user!;
  const [apps, devices, counts] = await Promise.all([listAppsForOwner(c.env.DB, u.id), listDevicesForUser(c.env.DB, u.id), installCounts(c.env.DB)]);
  return c.html(<DashboardPage {...pageProps(c, "Dashboard")} apps={apps} devices={devices} counts={counts} maxApps={MAX_APPS_PER_USER} />);
});

// ---- apps: create -----------------------------------------------------------
web.get("/apps/new", requireUser, async (c) => {
  return c.html(<NewAppPage {...pageProps(c, "New app")} csrf={await csrfToken(c)} values={{}} />);
});

web.post("/apps/new", requireUser, requireCsrf, async (c) => {
  const u = c.var.user!;
  const body = await c.req.parseBody();
  const values = { slug: str(body.slug, 64).toLowerCase(), name: str(body.name, 24), tagline: str(body.tagline, 80), kind: str(body.kind, 16), manifest_url: str(body.manifest_url, 512) };
  const fail = async (err: string) => c.html(<NewAppPage {...pageProps(c, "New app")} err={err} csrf={await csrfToken(c)} values={values} />, 400);
  if (!SLUG_RE.test(values.slug)) return fail("Slug must match ^[a-z][a-z0-9-]{0,31}$.");
  if (!values.name) return fail("Name is required.");
  if (values.kind !== "hosted" && values.kind !== "external") return fail("Pick a kind.");
  let manifest_url: string | null = null;
  if (values.kind === "external") {
    try {
      const mu = new URL(values.manifest_url);
      if (mu.protocol !== "https:" && mu.protocol !== "http:") throw new Error();
      manifest_url = mu.toString();
    } catch {
      return fail("External apps need a valid http(s) manifest URL.");
    }
  }
  if ((await countAppsForOwner(c.env.DB, u.id)) >= MAX_APPS_PER_USER) return fail(`You already have ${MAX_APPS_PER_USER} apps.`);
  if (await getApp(c.env.DB, values.slug)) return fail("That slug is taken.");
  await createApp(c.env.DB, { slug: values.slug, owner_id: u.id, name: values.name, tagline: values.tagline, kind: values.kind, manifest_url });
  return back(c, `/apps/${values.slug}/edit`, { ok: "App created. Publish a version to make it installable." });
});

// ---- apps: edit -------------------------------------------------------------
web.get("/apps/:slug/edit", requireUser, async (c) => {
  const app = await ownedApp(c, c.req.param("slug"));
  if (!app) return c.notFound();
  const o = origin(c);
  const versions = await listVersions(c.env.DB, app.slug);
  return c.html(
    <EditAppPage
      {...pageProps(c, `Edit ${app.name}`)}
      csrf={await csrfToken(c)}
      app={app}
      versions={versions}
      iconUrl={app.icon_key ? `${o}/${app.icon_key}` : null}
      manifestFor={(v) => manifestUrl(app, o, v)}
      origin={o}
    />,
  );
});

web.post("/apps/:slug/edit", requireUser, requireCsrf, async (c) => {
  const app = await ownedApp(c, c.req.param("slug"));
  if (!app) return c.notFound();
  const body = await c.req.parseBody();
  const name = str(body.name, 24);
  if (!name) return back(c, `/apps/${app.slug}/edit`, { err: "Name is required." });
  const visibility = str(body.visibility, 16) as Visibility;
  if (!["private", "unlisted", "public"].includes(visibility)) return back(c, `/apps/${app.slug}/edit`, { err: "Bad visibility." });
  let manifest_url = app.manifest_url;
  if (app.kind === "external") {
    try {
      const mu = new URL(str(body.manifest_url, 512));
      if (mu.protocol !== "https:" && mu.protocol !== "http:") throw new Error();
      manifest_url = mu.toString();
    } catch {
      return back(c, `/apps/${app.slug}/edit`, { err: "Manifest URL must be a valid http(s) URL." });
    }
  }
  await updateAppDetails(c.env.DB, app.slug, {
    name,
    tagline: str(body.tagline, 80),
    categories: parseCategories(str(body.categories, 400)),
    visibility,
    manifest_url,
    description: str(body.description, 4000),
    screenshots: parseUrlList(str(body.screenshots, 4000)),
  });
  return back(c, `/apps/${app.slug}/edit`, { ok: "Saved." });
});

web.post("/apps/:slug/icon", requireUser, requireCsrf, async (c) => {
  const app = await ownedApp(c, c.req.param("slug"));
  if (!app) return c.notFound();
  const body = await c.req.parseBody();
  if (body.remove === "1") {
    if (app.icon_key) await c.env.BUNDLES.delete(app.icon_key);
    await setAppIcon(c.env.DB, app.slug, null);
    return back(c, `/apps/${app.slug}/edit`, { ok: "Icon removed." });
  }
  const file = body.icon;
  if (!(file instanceof File)) return back(c, `/apps/${app.slug}/edit`, { err: "Choose a PNG file." });
  if (file.size > MAX_ICON_BYTES) return back(c, `/apps/${app.slug}/edit`, { err: "Icon must be ≤ 200 kB." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = pngSize(bytes);
  if (!isPng(bytes) || !size) return back(c, `/apps/${app.slug}/edit`, { err: "Icon must be a PNG." });
  if (size.w !== 96 || size.h !== 96) return back(c, `/apps/${app.slug}/edit`, { err: `Icon must be 96×96 (got ${size.w}×${size.h}).` });
  const key = `icons/${app.slug}/${(await sha256Hex(bytes)).slice(0, 16)}.png`;
  await c.env.BUNDLES.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  if (app.icon_key && app.icon_key !== key) await c.env.BUNDLES.delete(app.icon_key);
  await setAppIcon(c.env.DB, app.slug, key);
  return back(c, `/apps/${app.slug}/edit`, { ok: "Icon updated." });
});

web.post("/apps/:slug/versions", requireUser, requireCsrf, async (c) => {
  const app = await ownedApp(c, c.req.param("slug"));
  if (!app) return c.notFound();
  const body = await c.req.parseBody();
  const changelog = str(body.changelog, 2000);
  let result;
  if (app.kind === "hosted") {
    const file = body.bundle;
    if (!(file instanceof File) || file.size === 0) return back(c, `/apps/${app.slug}/edit`, { err: "Choose a zip bundle." });
    if (file.size > MAX_BUNDLE_BYTES) return back(c, `/apps/${app.slug}/edit`, { err: "Bundle must be ≤ 5 MB." });
    result = await publishHostedBundle(c.env, app, new Uint8Array(await file.arrayBuffer()), changelog);
  } else {
    result = await publishExternal(c.env, app, changelog);
  }
  if (!result.ok) return back(c, `/apps/${app.slug}/edit`, { err: `Not published: ${result.errors.slice(0, 8).join(" · ")}` });
  return back(c, `/apps/${app.slug}/edit`, { ok: `Published version ${result.version}.` });
});

web.post("/apps/:slug/delete", requireUser, requireCsrf, async (c) => {
  const app = await ownedApp(c, c.req.param("slug"));
  if (!app) return c.notFound();
  const body = await c.req.parseBody();
  if (str(body.confirm, 64) !== app.slug) return back(c, `/apps/${app.slug}/edit`, { err: "Type the slug to confirm deletion." });
  await deletePrefix(c.env.BUNDLES, `bundles/${app.slug}/`);
  await deletePrefix(c.env.BUNDLES, `icons/${app.slug}/`);
  await deleteApp(c.env.DB, app.slug);
  return back(c, "/dashboard", { ok: `Deleted ${app.slug}.` });
});

// ---- devices and pairing ----------------------------------------------------
web.get("/devices", requireUser, async (c) => {
  const devices = await listDevicesForUser(c.env.DB, c.var.user!.id);
  return c.html(<DevicesPage {...pageProps(c, "Devices")} csrf={await csrfToken(c)} devices={devices} />);
});

web.post("/devices/:id/rename", requireUser, requireCsrf, async (c) => {
  const body = await c.req.parseBody();
  await renameDevice(c.env.DB, c.req.param("id"), c.var.user!.id, str(body.name, 40));
  return back(c, "/devices", { ok: "Renamed." });
});

web.post("/devices/:id/unpair", requireUser, requireCsrf, async (c) => {
  await unpairDevice(c.env.DB, c.req.param("id"), c.var.user!.id);
  return back(c, "/devices", { ok: "Device unpaired. Pair it again from the device's Store screen." });
});

web.get("/pair", requireUser, async (c) => {
  const code = (c.req.query("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return c.html(<PairPage {...pageProps(c, "Pair a device")} csrf={await csrfToken(c)} code={code} />);
});

web.post("/pair", requireUser, requireCsrf, async (c) => {
  const ipHash = await sha256Hex(`pair:${clientIp(c.req.raw)}:${c.env.SESSION_SECRET}`);
  if (!(await rateLimit(c.env.DB, `pair:${ipHash}`, 10, 900))) return back(c, "/pair", { err: "Too many attempts; wait 15 minutes." });
  const body = await c.req.parseBody();
  const code = str(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) return back(c, "/pair", { err: "Codes are six characters." });
  const ok = await claimPairing(c.env.DB, code, c.var.user!.id);
  if (!ok) return back(c, "/pair", { err: "That code is unknown, already used or expired. Ask the device for a new one." });
  return back(c, "/devices", { ok: "Device paired. It will notice within a few seconds." });
});

// ---- admin ------------------------------------------------------------------
web.get("/admin", requireAdmin, async (c) => {
  const [apps, reports] = await Promise.all([listAllApps(c.env.DB), listReports(c.env.DB)]);
  return c.html(<AdminPage {...pageProps(c, "Admin")} csrf={await csrfToken(c)} apps={apps} reports={reports} />);
});

web.post("/admin/apps/:slug/:action{unlist|relist}", requireAdmin, requireCsrf, async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG_RE.test(slug) || !(await getApp(c.env.DB, slug))) return c.notFound();
  await setUnlistedByAdmin(c.env.DB, slug, c.req.param("action") === "unlist");
  return back(c, "/admin", { ok: `${slug} ${c.req.param("action")}ed.` });
});

export default web;
