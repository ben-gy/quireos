#!/usr/bin/env node
// Serves design/ for the preview and accepts PNG uploads from its Export button into
// design/screenshots/. Zero dependencies. Usage: node design/preview/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SHOTS = resolve(ROOT, "screenshots");
const port = Number(process.argv[2] || process.env.PORT || 8099);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown; charset=utf-8", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/save") {
    const name = (url.searchParams.get("name") || "screen").replace(/[^a-z0-9_-]/gi, "-") + ".png";
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(SHOTS, { recursive: true });
    await writeFile(resolve(SHOTS, name), Buffer.concat(chunks));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ saved: `screenshots/${name}` }));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(ROOT, "." + path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found: " + path);
  }
}).listen(port, "127.0.0.1", () => console.log(`design preview at http://127.0.0.1:${port}/preview/index.html (POST /save?name= writes screenshots/)`));
