#!/usr/bin/env node
/**
 * quireos-validate <file|dir|bundle.zip> [...]  [--icons spec/icons.json] [--quiet]
 *
 * Validates QuireOS documents: an index (`store` + `apps`), a manifest (`entry`) or a screen
 * (`widgets`) picked by content; a directory is walked (a directory with `manifest.json` at its
 * root is validated as a bundle); a `.zip` is extracted and validated as a bundle.
 * Prints `path:line: message` and exits non-zero when anything is invalid.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readZip, validateBundle, validateIndex, validateManifest, validateScreen } from "@quireos/sdk";
import type { ValidationError } from "@quireos/sdk";
import { lineOf, locateJson } from "./locate.js";
import type { Located } from "./locate.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", ".git", ".pio"]);

interface Report {
  file: string;
  kind: string;
  errors: { line: number; message: string; pointer: string }[];
}

function loadIcons(path: string | undefined): string[] | undefined {
  if (!path) return undefined;
  const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(doc)) return doc.map((x) => (typeof x === "string" ? x : String((x as { name?: string }).name ?? "")));
  if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    const list = (o.icons ?? o.names) as unknown;
    if (Array.isArray(list)) return list.map((x) => (typeof x === "string" ? x : String((x as { name?: string }).name ?? "")));
    if (o.icons && typeof o.icons === "object") return Object.keys(o.icons as object);
  }
  throw new Error(`${path}: cannot find an icon name list`);
}

function findIconsFile(from: string): string | undefined {
  let dir = resolve(from);
  for (let n = 0; n < 8; n++) {
    const candidate = join(dir, "spec", "icons.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function kindOf(doc: unknown): "index" | "manifest" | "screen" | undefined {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const o = doc as Record<string, unknown>;
  if ("store" in o && "apps" in o) return "index";
  if ("entry" in o || ("min_os" in o && "version" in o)) return "manifest";
  if ("widgets" in o || "id" in o) return "screen"; // a screen missing `widgets` is still a screen
  return undefined;
}

function validateFile(file: string, icons: string[] | undefined): Report | undefined {
  const text = readFileSync(file, "utf8");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { file, kind: "json", errors: [{ line: 1, message: `invalid JSON: ${(err as Error).message}`, pointer: "" }] };
  }
  const kind = kindOf(doc);
  if (!kind) return undefined;
  const r = kind === "index" ? validateIndex(text, { icons }) : kind === "manifest" ? validateManifest(text, { icons }) : validateScreen(text, { icons });
  const map = locateJson(text);
  return { file, kind, errors: r.errors.map((e) => ({ line: lineOf(map, e.path), message: e.message, pointer: e.path })) };
}

function bundleReport(name: string, files: Map<string, Uint8Array>, icons: string[] | undefined, texts: (f: string) => string | undefined): Report {
  const r = validateBundle(files, { icons });
  const maps = new Map<string, Map<string, Located>>();
  const errors = r.errors.map((e: ValidationError) => {
    const hash = e.path.indexOf("#");
    const file = hash < 0 ? e.path : e.path.slice(0, hash);
    const pointer = hash < 0 ? "" : e.path.slice(hash + 1);
    let line = 1;
    if (file) {
      let map = maps.get(file);
      if (!map) {
        const t = texts(file);
        map = t === undefined ? new Map() : locateJson(t);
        maps.set(file, map);
      }
      line = lineOf(map, pointer);
    }
    return { line, message: e.message, pointer: file ? `${file}#${pointer}` : pointer, file };
  });
  return { file: name, kind: "bundle", errors: errors.map((e) => ({ line: e.line, message: e.file ? `${e.file}: ${e.message}` : e.message, pointer: e.pointer })) };
}

async function main(argv: string[]): Promise<number> {
  const targets: string[] = [];
  let iconsPath: string | undefined;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--icons") iconsPath = argv[++i];
    else if (a === "--quiet" || a === "-q") quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: quireos-validate <file|dir|bundle.zip> [...] [--icons spec/icons.json] [--quiet]");
      return 0;
    } else targets.push(a);
  }
  if (targets.length === 0) {
    console.error("usage: quireos-validate <file|dir|bundle.zip> [...] [--icons spec/icons.json] [--quiet]");
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const icons = loadIcons(iconsPath ?? findIconsFile(resolve(cwd, targets[0]!)));
  const reports: Report[] = [];
  let files = 0;

  for (const t of targets) {
    const path = resolve(cwd, t);
    if (!existsSync(path)) {
      reports.push({ file: t, kind: "missing", errors: [{ line: 1, message: "no such file or directory", pointer: "" }] });
      continue;
    }
    const st = statSync(path);
    if (st.isDirectory()) {
      if (existsSync(join(path, "manifest.json"))) {
        const map = new Map<string, Uint8Array>();
        for (const f of walk(path)) map.set(relative(path, f).split("\\").join("/"), new Uint8Array(readFileSync(f)));
        files += map.size;
        reports.push(bundleReport(t, map, icons, (f) => (map.has(f) ? new TextDecoder().decode(map.get(f)) : undefined)));
      } else {
        for (const f of walk(path).filter((f) => f.endsWith(".json"))) {
          files++;
          const r = validateFile(f, icons);
          if (r) reports.push({ ...r, file: relative(cwd, f) || f });
        }
      }
    } else if (path.endsWith(".zip")) {
      files++;
      const map = await readZip(new Uint8Array(readFileSync(path)));
      reports.push(bundleReport(t, map, icons, (f) => (map.has(f) ? new TextDecoder().decode(map.get(f)) : undefined)));
    } else {
      files++;
      const r = validateFile(path, icons);
      if (r) reports.push({ ...r, file: t });
      else reports.push({ file: t, kind: "unknown", errors: [{ line: 1, message: "not a QuireOS document (expected store/apps, entry or widgets)", pointer: "" }] });
    }
  }

  let total = 0;
  for (const r of reports) {
    for (const e of r.errors) {
      total++;
      console.log(`${r.file}:${e.line}: ${e.message}${e.pointer && !quiet ? `  [${e.pointer}]` : ""}`);
    }
    if (r.errors.length === 0 && !quiet) console.log(`${r.file}: ok (${r.kind})`);
  }
  if (!quiet || total > 0) console.log(`${files} file${files === 1 ? "" : "s"}, ${total} error${total === 1 ? "" : "s"}`);
  return total === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
