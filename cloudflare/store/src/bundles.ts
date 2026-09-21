// Hosted bundles: zip → validation → R2 (`bundles/<slug>/<version>/…`), and
// immutable serving at /a/:slug/:version/<file>. Also external-manifest publish.
import { unzipSync } from "fflate";
import { Hono } from "hono";
import type { AppListing } from "./db";
import { getApp, getVersion, listVersions, publishVersion } from "./db";
import { deviceAuth } from "./device_auth";
import type { Bindings, Env } from "./env";
import { canSee } from "./index_doc";
import { compareVersions, contentTypeFor, etagMatches, parseCategories, parseUrlList, SLUG_RE, VERSION_RE } from "./util";
import { ICON_NAMES } from "./icons";
import { bundleMount, rebaseBundle, validateBundle, validateManifest, type Manifest, type StoreMeta } from "./validate";

export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 500;
const MAX_MANIFEST_BYTES = 64 * 1024;

export type PublishResult = { ok: true; version: string } | { ok: false; errors: string[] };

const dec = new TextDecoder();

/**
 * Unpacks a zip into path → bytes. Drops directories, macOS resource forks and
 * dotfiles, and strips a single top-level folder when everything sits under
 * one (the "compress folder" case). Rejects unsafe paths and oversize content.
 */
export function unzipBundle(zip: Uint8Array): { files: Map<string, Uint8Array>; errors: string[] } {
  const errors: string[] = [];
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (f.originalSize > MAX_BUNDLE_BYTES) {
          errors.push(`${f.name}: file larger than 5 MB`);
          return false;
        }
        total += f.originalSize;
        return true;
      },
    });
  } catch (err) {
    return { files: new Map(), errors: [`not a valid zip file: ${(err as Error).message}`] };
  }
  if (total > MAX_BUNDLE_BYTES) errors.push("bundle exceeds 5 MB uncompressed");

  // Unsafe entries are an error, not a silent drop.
  const isUnsafe = (n: string) => !n || n.startsWith("/") || n.includes("\\") || n.split("/").some((p) => p === "" || p === "..");
  for (const n of Object.keys(raw)) if (isUnsafe(n)) errors.push(`${n}: unsafe path`);
  if (errors.length) return { files: new Map(), errors };

  // Drop macOS resource forks and dotfiles (e.g. .DS_Store).
  const junk = (n: string) => n.split("/").some((p) => p === "__MACOSX" || p.startsWith("."));
  let names = Object.keys(raw).filter((n) => !junk(n));
  // Strip one common top-level directory.
  const first = names[0]?.split("/")[0];
  if (first && names.length && names.every((n) => n.startsWith(first + "/"))) {
    names = names.map((n) => n.slice(first.length + 1));
    const stripped: Record<string, Uint8Array> = {};
    for (const n of Object.keys(raw)) if (n.startsWith(first + "/")) stripped[n.slice(first.length + 1)] = raw[n]!;
    raw = stripped;
  }
  const files = new Map<string, Uint8Array>();
  for (const n of names) {
    if (!/^[A-Za-z0-9._\-/]+$/.test(n)) {
      errors.push(`${n}: path may only contain letters, digits, . _ - and /`);
      continue;
    }
    files.set(n, raw[n]!);
  }
  if (files.size > MAX_BUNDLE_FILES) errors.push(`bundle has more than ${MAX_BUNDLE_FILES} files`);
  return { files, errors };
}

/** Listing metadata from a bundle's optional store.json (SDK `StoreMeta`), sanitised. */
export function storeMetaFrom(files: Map<string, Uint8Array>): { listing: NonNullable<Parameters<typeof publishVersion>[1]["listing"]>; notesFor: (version: string) => string } {
  const listing: NonNullable<Parameters<typeof publishVersion>[1]["listing"]> = {};
  let meta: StoreMeta = {};
  const bytes = files.get("store.json");
  if (bytes) {
    try {
      const doc = JSON.parse(dec.decode(bytes));
      if (typeof doc === "object" && doc !== null) meta = doc as StoreMeta;
    } catch {
      /* validateBundle already reported it */
    }
  }
  if (typeof meta.tagline === "string") listing.tagline = meta.tagline.trim().slice(0, 80);
  if (typeof meta.description === "string") listing.description = meta.description.trim().slice(0, 4000);
  if (Array.isArray(meta.categories)) listing.categories = parseCategories(meta.categories.filter((c) => typeof c === "string").join(","));
  if (Array.isArray(meta.screenshots)) listing.screenshots = parseUrlList(meta.screenshots.filter((c) => typeof c === "string").join("\n"));
  const notesFor = (version: string) => {
    const entry = Array.isArray(meta.changelog) ? meta.changelog.find((c) => c && typeof c === "object" && c.version === version) : undefined;
    return typeof entry?.notes === "string" ? entry.notes.trim().slice(0, 2000) : "";
  };
  return { listing, notesFor };
}

function versionGate(app: AppListing, versions: { version: string }[], manifest: Manifest): string[] {
  const errors: string[] = [];
  if (manifest.id !== app.slug) errors.push(`manifest.id is "${manifest.id}" but this app's slug is "${app.slug}"`);
  const latest = versions[0]?.version;
  if (latest && compareVersions(manifest.version, latest) <= 0)
    errors.push(`manifest.version ${manifest.version} must be greater than the latest published version ${latest}`);
  return errors;
}

/** Publish a hosted version from an uploaded zip. */
export async function publishHostedBundle(env: Bindings, app: AppListing, zip: Uint8Array, changelog: string): Promise<PublishResult> {
  if (app.kind !== "hosted") return { ok: false, errors: ["this app is external; set its manifest URL instead"] };
  if (zip.byteLength > MAX_BUNDLE_BYTES) return { ok: false, errors: ["bundle exceeds 5 MB"] };
  const { files, errors } = unzipBundle(zip);
  if (errors.length) return { ok: false, errors };

  const v = validateBundle(files, { icons: ICON_NAMES });
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${e.path}: ${e.message}`) };
  const manifest = JSON.parse(dec.decode(files.get("manifest.json")!)) as Manifest;
  const versions = await listVersions(env.DB, app.slug);
  const gate = versionGate(app, versions, manifest);
  if (gate.length) return { ok: false, errors: gate };
  if (await getVersion(env.DB, app.slug, manifest.version)) return { ok: false, errors: [`version ${manifest.version} already exists`] };

  // The bundle was written for the mount implied by its entry ("" or "/some/prefix"); it is
  // served under /a/<slug>/<version>/, so rebase every origin-relative URL once, at publish time.
  const prefix = `/a/${app.slug}/${manifest.version}`;
  const r2prefix = `bundles/${app.slug}/${manifest.version}/`;
  const rebased = rebaseBundle(files, bundleMount(manifest) ?? "", prefix);
  const rebasedManifest = JSON.parse(dec.decode(rebased.get("manifest.json")!)) as Manifest;
  const { listing, notesFor } = storeMetaFrom(files);

  const puts: Promise<unknown>[] = [];
  for (const [path, bytes] of rebased) {
    puts.push(env.BUNDLES.put(r2prefix + path, bytes, { httpMetadata: { contentType: contentTypeFor(path) } }));
  }
  await Promise.all(puts);

  await publishVersion(env.DB, {
    app_slug: app.slug,
    version: manifest.version,
    min_os: manifest.min_os,
    bundle_prefix: r2prefix,
    manifest_json: JSON.stringify(rebasedManifest),
    changelog: changelog || notesFor(manifest.version),
    name: manifest.name,
    screens: Array.isArray(manifest.screens) ? manifest.screens : null,
    listing,
  });
  return { ok: true, version: manifest.version };
}

/** Publish an external version by fetching and snapshotting the owner's manifest URL. */
export async function publishExternal(env: Bindings, app: AppListing, changelog: string): Promise<PublishResult> {
  if (app.kind !== "external") return { ok: false, errors: ["this app is hosted; upload a bundle instead"] };
  if (!app.manifest_url) return { ok: false, errors: ["set the manifest URL first"] };
  let url: URL;
  try {
    url = new URL(app.manifest_url);
  } catch {
    return { ok: false, errors: ["manifest URL is not a valid URL"] };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, errors: ["manifest URL must be http(s)"] };

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "quireos-store/1 (+manifest check)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
  } catch (err) {
    return { ok: false, errors: [`could not fetch manifest: ${(err as Error).message}`] };
  }
  if (res.status !== 200) return { ok: false, errors: [`manifest URL returned HTTP ${res.status} (redirects are not followed)`] };
  if (!res.headers.get("ETag")) return { ok: false, errors: ["manifest must be served with an ETag header (spec §5)"] };
  const text = await res.text();
  if (text.length > MAX_MANIFEST_BYTES) return { ok: false, errors: ["manifest larger than 64 kB"] };
  let manifest: Manifest;
  try {
    manifest = JSON.parse(text) as Manifest;
  } catch (err) {
    return { ok: false, errors: [`manifest is not valid JSON: ${(err as Error).message}`] };
  }
  const v = validateManifest(manifest, { icons: ICON_NAMES });
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${e.path}: ${e.message}`) };
  const versions = await listVersions(env.DB, app.slug);
  const gate = versionGate(app, versions, manifest);
  if (gate.length) return { ok: false, errors: gate };

  await publishVersion(env.DB, {
    app_slug: app.slug,
    version: manifest.version,
    min_os: manifest.min_os,
    bundle_prefix: null,
    manifest_json: JSON.stringify(manifest),
    changelog,
    name: manifest.name,
    screens: Array.isArray(manifest.screens) ? manifest.screens : null,
  });
  return { ok: true, version: manifest.version };
}

/** Deletes every R2 object under a prefix (used when an app is deleted). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// ---- serving ----------------------------------------------------------------

const files = new Hono<Env>();

// Bundle files. Public/unlisted apps are open; private apps need the owner's
// paired device token (or the owner's web session, handy for checking in a browser).
files.get("/a/:slug/:version/*", deviceAuth(false), async (c) => {
  const slug = c.req.param("slug");
  const version = c.req.param("version");
  if (!SLUG_RE.test(slug) || !VERSION_RE.test(version)) return c.notFound();
  const rel = new URL(c.req.url).pathname.slice(`/a/${slug}/${version}/`.length);
  let path: string;
  try {
    path = decodeURIComponent(rel);
  } catch {
    return c.notFound();
  }
  if (!path || path.split("/").some((p) => p === "" || p === "." || p === "..")) return c.notFound();

  const app = await getApp(c.env.DB, slug);
  if (!app || app.kind !== "hosted") return c.notFound();
  if (app.visibility === "private" || app.unlisted_by_admin) {
    if (!canSee(app, c.var.user, c.var.device)) return c.notFound();
  }
  const ver = await getVersion(c.env.DB, slug, version);
  if (!ver?.bundle_prefix) return c.notFound();

  const obj = await c.env.BUNDLES.get(ver.bundle_prefix + path);
  if (!obj) return c.notFound();
  const headers = new Headers({
    ETag: obj.httpEtag,
    "Cache-Control": `${app.visibility === "private" ? "private" : "public"}, max-age=31536000, immutable`,
    "Access-Control-Allow-Origin": "*",
    "Content-Type": obj.httpMetadata?.contentType || contentTypeFor(path),
  });
  if (etagMatches(c.req.header("If-None-Match"), obj.httpEtag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});

// Uploaded store icons: /icons/<slug>/<hash>.png (immutable per hash).
files.get("/icons/:slug/:file", async (c) => {
  const slug = c.req.param("slug");
  const file = c.req.param("file");
  if (!SLUG_RE.test(slug) || !/^[a-f0-9]{8,64}\.png$/.test(file)) return c.notFound();
  const obj = await c.env.BUNDLES.get(`icons/${slug}/${file}`);
  if (!obj) return c.notFound();
  const headers = new Headers({
    ETag: obj.httpEtag,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "image/png",
  });
  if (etagMatches(c.req.header("If-None-Match"), obj.httpEtag)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { status: 200, headers });
});

export default files;
