#!/usr/bin/env node
/**
 * Seeds a deployed QuireOS store with this repo's example apps, owned by one GitHub account.
 *
 *   node tools/seed-store.mjs --owner ben-gy --github-id 6506968 --name "Ben Richardson" \
 *        --store https://quireos-store.<subdomain>.workers.dev [--apply]
 *
 * Without --apply it only prints what it would do. With --apply it uploads the hosted bundle to R2
 * and writes `tools/.seed.sql`, then runs both through wrangler. Every manifest is validated with
 * the same rules the store's upload path uses before anything is written.
 *
 * This is a bootstrap convenience: normally you publish through the store's website.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleMount, rebaseBundle, validateBundle, validateManifest } from "@quireos/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");               // cloudflare/
const repo = resolve(root, "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || i + 1 >= process.argv.length ? "true" : process.argv[++i]);
}
const APPLY = args.get("apply") === "true";
const STORE = (args.get("store") ?? "").replace(/\/$/, "");
const OWNER = args.get("owner") ?? "";
const GITHUB_ID = Number(args.get("github-id") ?? 0);
const OWNER_NAME = args.get("name") ?? OWNER;
const AVATAR = args.get("avatar") ?? "";
if (!STORE || !OWNER || !GITHUB_ID) {
  console.error("need --store, --owner and --github-id (see the header of this file)");
  process.exit(2);
}

/** Worker-hosted apps: listed by manifest URL, served by their own deployment. */
const EXTERNAL = [
  { slug: "hn", worker: "quireos-app-hn" },
  { slug: "ha-lights", worker: "quireos-app-ha-lights" },
  { slug: "clock-weather", worker: "quireos-app-clock-weather" },
  { slug: "frame", worker: "quireos-app-frame" },
];
/** Static bundles in this repo, uploaded to the store's R2 bucket. */
const HOSTED = [{ slug: "hello", dir: join(root, "apps", "hello") }];

const ICONS = JSON.parse(readFileSync(join(repo, "spec", "icons.json"), "utf8"));
const iconNames = Array.isArray(ICONS) ? ICONS : (ICONS.icons ?? []);
const now = new Date().toISOString();
const sql = [];
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

function storeMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "store.json"), "utf8"));
  } catch {
    return {};
  }
}

function appRow(slug, manifest, meta, kind, manifestUrl) {
  sql.push(
    `INSERT INTO apps (slug, owner_id, name, tagline, icon_key, kind, manifest_url, visibility, categories, min_os, screens, description, screenshots, created_at, updated_at)
     SELECT ${q(slug)}, id, ${q(manifest.name)}, ${q(meta.tagline ?? "")}, NULL, ${q(kind)}, ${q(manifestUrl)}, 'public',
            ${q(JSON.stringify(meta.categories ?? []))}, ${q(manifest.min_os)}, ${q(JSON.stringify(manifest.screens ?? []))},
            ${q(meta.description ?? "")}, ${q(JSON.stringify(meta.screenshots ?? []))}, ${q(now)}, ${q(now)}
     FROM users WHERE github_id = ${GITHUB_ID}
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name, tagline = excluded.tagline, kind = excluded.kind,
       manifest_url = excluded.manifest_url, visibility = excluded.visibility, categories = excluded.categories,
       min_os = excluded.min_os, screens = excluded.screens, description = excluded.description,
       screenshots = excluded.screenshots, updated_at = excluded.updated_at;`,
  );
}

function versionRow(slug, manifest, prefix, notes) {
  sql.push(
    `INSERT INTO app_versions (app_slug, version, min_os, bundle_prefix, manifest_json, changelog, published_at)
     VALUES (${q(slug)}, ${q(manifest.version)}, ${q(manifest.min_os)}, ${prefix ? q(prefix) : "NULL"},
             ${q(JSON.stringify(manifest))}, ${q(notes ?? "")}, ${q(now)})
     ON CONFLICT(app_slug, version) DO UPDATE SET manifest_json = excluded.manifest_json,
       min_os = excluded.min_os, bundle_prefix = excluded.bundle_prefix;`,
  );
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const uploads = [];

sql.push(
  `INSERT INTO users (github_id, login, name, avatar_url, is_admin, created_at)
   VALUES (${GITHUB_ID}, ${q(OWNER)}, ${q(OWNER_NAME)}, ${q(AVATAR || null)}, 1, ${q(now)})
   ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, name = excluded.name, is_admin = 1;`,
);

for (const { slug, worker } of EXTERNAL) {
  const origin = `https://${worker}.${new URL(STORE).host.split(".").slice(1).join(".")}`;
  const url = `${origin}/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${slug}: manifest ${res.status} from ${url}`);
  const text = await res.text();
  const v = validateManifest(text, { icons: iconNames });
  if (!v.ok) throw new Error(`${slug}: ${v.errors.map((e) => `${e.path}: ${e.message}`).join(" · ")}`);
  if (!res.headers.get("etag")) console.warn(`  ! ${slug}: manifest has no ETag`);
  const manifest = JSON.parse(text);
  if (manifest.id !== slug) throw new Error(`${slug}: manifest id is "${manifest.id}"`);
  const meta = storeMeta(join(root, "apps", slug));
  appRow(slug, manifest, meta, "external", url);
  versionRow(slug, manifest, null, meta.changelog?.[0]?.notes);
  console.log(`external ${slug.padEnd(14)} ${manifest.version}  ${url}`);
}

for (const { slug, dir } of HOSTED) {
  const files = new Map();
  for (const f of walk(dir)) {
    const rel = relative(dir, f).split("\\").join("/");
    if (rel.endsWith(".zip") || rel === "package.json" || rel.startsWith("test/")) continue;
    files.set(rel, new Uint8Array(readFileSync(f)));
  }
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
  const mount = bundleMount(manifest) ?? "";
  const prefix = `bundles/${slug}/${manifest.version}/`;
  const rebased = rebaseBundle(files, mount, `/a/${slug}/${manifest.version}`);
  const v = validateBundle(files, { icons: iconNames });
  if (!v.ok) throw new Error(`${slug}: ${v.errors.map((e) => `${e.path}: ${e.message}`).join(" · ")}`);
  const meta = storeMeta(dir);
  appRow(slug, manifest, meta, "hosted", `${STORE}/a/${slug}/${manifest.version}/manifest.json`);
  versionRow(slug, manifest, prefix, meta.changelog?.[0]?.notes);
  const stage = join(here, ".seed-bundle", slug);
  rmSync(stage, { recursive: true, force: true });
  for (const [path, bytes] of rebased) {
    const out = join(stage, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    uploads.push({ key: prefix + path, file: out });
  }
  console.log(`hosted   ${slug.padEnd(14)} ${manifest.version}  ${rebased.size} files (mount ${mount || "/"})`);
}

const sqlPath = join(here, ".seed.sql");
writeFileSync(sqlPath, sql.join("\n\n") + "\n");
console.log(`\n${sql.length} statements -> ${relative(process.cwd(), sqlPath)}`);
console.log(`${uploads.length} bundle files to upload`);

if (!APPLY) {
  console.log("\ndry run; pass --apply to write to Cloudflare");
  process.exit(0);
}

const TYPES = { ".json": "application/json", ".png": "image/png", ".txt": "text/plain" };
for (const u of uploads) {
  const ext = u.key.slice(u.key.lastIndexOf("."));
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", `quireos-bundles/${u.key}`, "--file", u.file, "--content-type", TYPES[ext] ?? "application/octet-stream", "--remote"],
    { cwd: join(root, "store"), stdio: "inherit" },
  );
}
execFileSync("npx", ["wrangler", "d1", "execute", "quireos-store", "--remote", "--file", sqlPath, "-y"], {
  cwd: join(root, "store"),
  stdio: "inherit",
});
console.log("\nseeded");
