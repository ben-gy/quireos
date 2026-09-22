#!/usr/bin/env node
/**
 * Walks every `navigate` target reachable from an app's entry screen and reports any that do not
 * answer 200.
 *
 *   node tools/linkcheck.mjs http://127.0.0.1:8787
 *   node tools/linkcheck.mjs https://quireos-app-hn.<subdomain>.workers.dev
 *
 * A screen that paginates is the usual source of a dead link: it reports a page count from one
 * place and generates pages from another, and the two drift. Exits non-zero when anything is dead.
 */
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node tools/linkcheck.mjs <app base url> [--max 60]");
  process.exit(2);
}
const maxArg = process.argv.indexOf("--max");
const MAX = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 60;

const headers = {
  "X-Screen": "540x960x16@235",
  "X-Install-Id": "linkcheck",
  "X-OS-Version": "0.1.0",
  "X-Spec-Version": "1",
  "X-Timezone": "UTC",
  Accept: "application/json",
};

const manifestRes = await fetch(`${base}/manifest.json`, { headers });
if (!manifestRes.ok) {
  console.error(`manifest: HTTP ${manifestRes.status}`);
  process.exit(1);
}
const manifest = await manifestRes.json();

/** Collects the `url` of every navigate action anywhere in a screen document. */
function navigateTargets(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) navigateTargets(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    if (node.type === "navigate" && typeof node.url === "string") out.push(node.url);
    for (const v of Object.values(node)) navigateTargets(v, out);
  }
  return out;
}

const seen = new Map();
const from = new Map();
const queue = [manifest.entry];
while (queue.length && seen.size < MAX) {
  const url = queue.shift();
  if (!url || seen.has(url) || !url.startsWith("/")) continue;
  const res = await fetch(base + url, { headers });
  seen.set(url, res.status);
  if (res.status !== 200) continue;
  let doc;
  try {
    doc = await res.json();
  } catch {
    seen.set(url, `${res.status} (not JSON)`);
    continue;
  }
  for (const t of navigateTargets(doc)) {
    if (!seen.has(t) && !from.has(t)) from.set(t, url);
    if (!seen.has(t)) queue.push(t);
  }
}

let dead = 0;
for (const [url, status] of seen) {
  if (status !== 200) {
    dead++;
    console.log(`  ${status}  ${url}${from.has(url) ? `   (linked from ${from.get(url)})` : ""}`);
  }
}
console.log(`${seen.size} screens reachable, ${dead} dead${seen.size >= MAX ? ` (stopped at --max ${MAX})` : ""}`);
process.exit(dead ? 1 : 0);
