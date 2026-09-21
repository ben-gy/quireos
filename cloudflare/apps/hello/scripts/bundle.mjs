// Zips the app for upload to the store: manifest.json at the root plus screens, store.json and icon.png.
// Validates first (same rules as the store) and refuses to zip an invalid bundle.
import { readFileSync, writeFileSync } from "node:fs";
import { validateBundle, writeZip } from "@quireos/sdk";

const root = new URL("../", import.meta.url);
const names = ["manifest.json", "screen.json", "about.json", "store.json", "icon.png"];
const files = new Map(names.map((n) => [n, new Uint8Array(readFileSync(new URL(n, root)))]));
const r = validateBundle(files);
if (!r.ok) {
  for (const e of r.errors) console.error(`${e.path}: ${e.message}`);
  process.exit(1);
}
const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
const out = new URL(`${manifest.id}-${manifest.version}.zip`, root);
const zip = writeZip(files);
writeFileSync(out, zip);
console.log(`wrote ${out.pathname} (${zip.length} bytes, ${files.size} files)`);
