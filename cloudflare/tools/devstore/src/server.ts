#!/usr/bin/env node
/**
 * quireos-devstore [dir ...] [--port 8788] [--host 0.0.0.0]
 *
 * Serves a development store: `GET /index.json` is built from every `manifest.json` found under
 * the given directories (plus `store.json` next to it), and every file under those directories is
 * served at its path relative to the current working directory, so an app in `./apps/hello/`
 * with `entry: "/apps/hello/screen.json"` works unchanged. CORS `*`, strong ETags, `304`s.
 * Point a device or the emulator at `http://<mac-ip>:8788/index.json`.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { etag, matchesEtag, validateManifest } from "@quireos/sdk";
import type { Manifest, StoreApp, StoreIndex, StoreMeta } from "@quireos/sdk";

const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", ".git", ".pio", "src", "test"]);
const TYPES: Record<string, string> = { ".json": "application/json; charset=utf-8", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".html": "text/html; charset=utf-8" };

const argv = process.argv.slice(2);
let port = 8788;
let host = "0.0.0.0";
const dirs: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--port" || a === "-p") port = Number(argv[++i]);
  else if (a === "--host") host = argv[++i] ?? host;
  else if (a === "--help" || a === "-h") {
    console.log("usage: quireos-devstore [dir ...] [--port 8788] [--host 0.0.0.0]");
    process.exit(0);
  } else dirs.push(a);
}
const cwd = resolve(process.env.INIT_CWD ?? process.cwd());
const roots = (dirs.length ? dirs : ["."]).map((d) => resolve(cwd, d));
for (const r of roots) {
  if (!existsSync(r) || !statSync(r).isDirectory()) {
    console.error(`devstore: ${r} is not a directory`);
    process.exit(2);
  }
}

function findManifests(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findManifests(p, out);
    else if (name === "manifest.json") out.push(p);
  }
  return out;
}

function mountOf(file: string): string {
  return "/" + relative(cwd, dirname(file)).split(sep).join("/");
}

function absolute(url: string, origin: string): string {
  return url.startsWith("/") ? origin + url : url;
}

function buildIndex(origin: string): StoreIndex {
  const apps: StoreApp[] = [];
  for (const root of roots) {
    for (const file of findManifests(root)) {
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
      } catch (err) {
        console.warn(`devstore: ${relative(cwd, file)}: ${(err as Error).message}`);
        continue;
      }
      const r = validateManifest(manifest);
      for (const e of r.errors) console.warn(`devstore: ${relative(cwd, file)}${e.path}: ${e.message}`);
      let meta: StoreMeta = {};
      const metaFile = join(dirname(file), "store.json");
      if (existsSync(metaFile)) {
        try {
          meta = JSON.parse(readFileSync(metaFile, "utf8")) as StoreMeta;
        } catch {
          /* ignore */
        }
      }
      const mount = mountOf(file);
      const app: StoreApp = {
        id: manifest.id,
        name: manifest.name,
        tagline: meta.tagline ?? manifest.name,
        icon: typeof manifest.icon === "string" ? absolute(manifest.icon, origin) : "help",
        version: manifest.version,
        manifest: `${origin}${mount}/manifest.json`,
        min_os: manifest.min_os,
        kind: typeof manifest.entry === "string" && manifest.entry.startsWith("/") ? "hosted" : "external",
        visibility: "public",
        author: "dev",
      };
      if (manifest.screens) app.screens = manifest.screens;
      if (meta.categories) app.categories = meta.categories;
      apps.push(app);
    }
  }
  return { spec_version: 1, store: { name: "QuireOS Dev Store", updated: new Date().toISOString() }, apps };
}

function resolveFile(pathname: string): string | undefined {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (p.includes("\0") || p.split("/").some((s) => s === "..")) return undefined;
  const abs = resolve(cwd, "." + p);
  if (!roots.some((r) => abs === r || abs.startsWith(r + sep))) return undefined;
  if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
  return abs;
}

async function send(req: IncomingMessage, res: ServerResponse, body: Uint8Array, type: string): Promise<void> {
  const tag = await etag(body);
  const headers: Record<string, string> = {
    ETag: tag,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "ETag",
  };
  if (matchesEtag(req.headers["if-none-match"] ?? null, tag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": String(body.byteLength) });
  res.end(req.method === "HEAD" ? undefined : Buffer.from(body));
}

const server = createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
  const origin = `http://${req.headers.host ?? `localhost:${port}`}`;
  const done = (status: number) => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname} ${status} ${Date.now() - started}ms ${req.headers["user-agent"] ?? ""}`);
  res.on("finish", () => done(res.statusCode));
  (async () => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS" });
      res.end();
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.json" || url.pathname === "/api/v1/index") {
      const body = new TextEncoder().encode(JSON.stringify(buildIndex(origin), null, 2));
      await send(req, res, body, TYPES[".json"]!);
      return;
    }
    if (req.method === "POST") {
      // static bundles have no event handler; answer 204 so `submit` is a no-op during development
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    const file = resolveFile(url.pathname);
    if (!file) {
      const body = new TextEncoder().encode(JSON.stringify({ spec_version: 1, error: { code: "not_found", message: `No file at ${url.pathname}` } }));
      res.writeHead(404, { "Content-Type": TYPES[".json"]!, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    await send(req, res, new Uint8Array(readFileSync(file)), TYPES[ext] ?? "application/octet-stream");
  })().catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("internal error");
  });
});

server.listen(port, host, () => {
  const idx = buildIndex(`http://localhost:${port}`);
  console.log(`QuireOS dev store serving ${roots.map((r) => relative(cwd, r) || ".").join(", ")} (${idx.apps.length} app${idx.apps.length === 1 ? "" : "s"}: ${idx.apps.map((a) => a.id).join(", ") || "none"})`);
  const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n!.address);
  for (const ip of ["localhost", ...ips]) console.log(`  http://${ip}:${port}/index.json`);
});
