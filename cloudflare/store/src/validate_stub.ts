// TODO(sdk): delete this file once `@quireos/sdk` is installable and switch
// src/validate.ts to `export * from "@quireos/sdk"`. This is a minimal
// stand-in implementing the same signatures (spec §4, §5, §6 and §9 basics):
// required fields, id/version formats, bundle structure. The real SDK
// validator is the source of truth (schemas, caps, hosts/secrets rules).

export type ValidationError = { path: string; message: string };
export type ValidationResult = { ok: boolean; errors: ValidationError[] };

export type Setting = {
  key: string;
  label: string;
  type: "string" | "secret" | "url" | "number" | "bool" | "select" | "list";
  required?: boolean;
  default?: unknown;
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  item?: Setting[];
};

export type Manifest = {
  spec_version: number;
  id: string;
  name: string;
  version: string;
  min_os: string;
  icon: string;
  orientation?: "portrait" | "landscape";
  screens?: string[];
  entry: string;
  event?: string;
  hosts?: string[];
  settings?: Setting[];
  [k: string]: unknown;
};

export type StoreIndexApp = {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  version: string;
  manifest: string;
  min_os: string;
  screens?: string[];
  categories?: string[];
  author?: string;
  kind?: "hosted" | "external";
  visibility?: "public" | "unlisted" | "private";
  installs?: number;
};

export type StoreIndex = {
  spec_version: number;
  store: { name: string; updated: string };
  apps: StoreIndexApp[];
};

/** Optional `store.json` shipped in a bundle: listing metadata the store merges into its index. */
export type StoreMeta = {
  spec_version?: number;
  tagline?: string;
  description?: string;
  categories?: string[];
  screenshots?: string[];
  changelog?: { version: string; notes: string }[];
};

export type UrlInfo = { kind: "absolute" | "relative" | "settings"; origin?: string; settingKey?: string; path?: string };

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const APP_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SCREEN_RE = /^\d{2,4}x\d{2,4}$/;
const SETTING_TYPES = new Set(["string", "secret", "url", "number", "bool", "select", "list"]);
const WIDGET_TYPES = new Set(["text", "rect", "line", "icon", "image", "button", "grid"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUrlish(v: unknown): boolean {
  return typeof v === "string" && (/^https?:\/\//.test(v) || (v.startsWith("/") && !v.startsWith("//")));
}

class Errors {
  list: ValidationError[] = [];
  constructor(private base = "") {}
  add(path: string, message: string) {
    this.list.push({ path: this.base ? `${this.base}${path ? "." + path : ""}` : path, message });
  }
  result(): ValidationResult {
    return { ok: this.list.length === 0, errors: this.list };
  }
}

function checkSpecVersion(doc: Record<string, unknown>, e: Errors) {
  if (doc.spec_version !== 1) e.add("spec_version", "must be 1");
}

function checkSetting(s: unknown, path: string, e: Errors, nested: boolean) {
  if (!isObj(s)) return e.add(path, "must be an object");
  if (typeof s.key !== "string" || !ID_RE.test(s.key)) e.add(`${path}.key`, "invalid identifier");
  if (typeof s.label !== "string" || !s.label) e.add(`${path}.label`, "required");
  if (typeof s.type !== "string" || !SETTING_TYPES.has(s.type)) e.add(`${path}.type`, "unknown type");
  if (s.type === "secret" && s.default !== undefined) e.add(`${path}.default`, "not allowed for secret");
  if (s.type === "select" && !Array.isArray(s.options)) e.add(`${path}.options`, "required for select");
  if (s.type === "list") {
    if (nested) e.add(`${path}.type`, "nested lists are not allowed");
    if (!Array.isArray(s.item)) e.add(`${path}.item`, "required for list");
    else s.item.forEach((it, i) => checkSetting(it, `${path}.item[${i}]`, e, true));
    if (typeof s.max === "number" && s.max > 16) e.add(`${path}.max`, "must be ≤ 16");
  }
}

export function validateManifest(doc: unknown, base = ""): ValidationResult {
  const e = new Errors(base);
  if (!isObj(doc)) {
    e.add("", "manifest must be a JSON object");
    return e.result();
  }
  checkSpecVersion(doc, e);
  if (typeof doc.id !== "string" || !APP_ID_RE.test(doc.id)) e.add("id", "invalid app id (^[a-z][a-z0-9-]{0,31}$)");
  if (typeof doc.name !== "string" || !doc.name || doc.name.length > 24) e.add("name", "required, ≤ 24 chars");
  if (!VERSION_RE.test(String(doc.version))) e.add("version", "must be MAJOR.MINOR.PATCH");
  if (!VERSION_RE.test(String(doc.min_os))) e.add("min_os", "must be MAJOR.MINOR.PATCH");
  if (typeof doc.icon !== "string" || !doc.icon) e.add("icon", "required (icon name or PNG URL)");
  if (doc.orientation !== undefined && doc.orientation !== "portrait" && doc.orientation !== "landscape")
    e.add("orientation", "must be portrait or landscape");
  if (doc.screens !== undefined) {
    if (!Array.isArray(doc.screens) || !doc.screens.every((s) => typeof s === "string" && SCREEN_RE.test(s)))
      e.add("screens", "must be an array of WxH strings");
  }
  if (!isUrlish(doc.entry)) e.add("entry", "required; absolute or origin-relative URL");
  if (doc.event !== undefined && !isUrlish(doc.event)) e.add("event", "absolute or origin-relative URL");
  if (doc.hosts !== undefined) {
    if (!Array.isArray(doc.hosts)) e.add("hosts", "must be an array");
    else
      doc.hosts.forEach((h, i) => {
        if (typeof h !== "string" || !(/^https?:\/\/[^/]+$/.test(h) || /^\{\{\s*settings\.[a-z][a-z0-9_-]*\s*\}\}$/.test(h)))
          e.add(`hosts[${i}]`, "must be a literal origin or {{settings.<url key>}}");
      });
  }
  if (doc.settings !== undefined) {
    if (!Array.isArray(doc.settings)) e.add("settings", "must be an array");
    else {
      if (doc.settings.length > 8) e.add("settings", "≤ 8 entries");
      doc.settings.forEach((s, i) => checkSetting(s, `settings[${i}]`, e, false));
    }
  }
  return e.result();
}

export function validateScreen(doc: unknown, base = ""): ValidationResult {
  const e = new Errors(base);
  if (!isObj(doc)) {
    e.add("", "screen must be a JSON object");
    return e.result();
  }
  checkSpecVersion(doc, e);
  if (typeof doc.id !== "string" || !ID_RE.test(doc.id)) e.add("id", "invalid identifier");
  if (!Array.isArray(doc.widgets)) e.add("widgets", "required array");
  else {
    let count = 0;
    const walk = (w: unknown, path: string, inGrid: boolean) => {
      count++;
      if (!isObj(w)) return e.add(path, "widget must be an object");
      if (typeof w.type !== "string") return e.add(`${path}.type`, "required");
      if (!WIDGET_TYPES.has(w.type)) return; // unknown widgets are skipped by devices
      if (w.type === "grid") {
        if (inGrid) e.add(`${path}.type`, "grids cannot be nested");
        if (Array.isArray(w.children)) w.children.forEach((ch, i) => walk(ch, `${path}.children[${i}]`, true));
      }
      if (w.type === "line") {
        for (const k of ["x1", "y1", "x2", "y2"]) if (typeof w[k] !== "number") e.add(`${path}.${k}`, "required int");
      } else if (!inGrid) {
        if (typeof w.x !== "number") e.add(`${path}.x`, "required int");
        if (typeof w.y !== "number") e.add(`${path}.y`, "required int");
      }
      if (w.type === "text" && typeof w.text !== "string") e.add(`${path}.text`, "required");
      if (w.type === "image" && typeof w.src !== "string") e.add(`${path}.src`, "required");
      if (w.type === "icon" && typeof w.name !== "string") e.add(`${path}.name`, "required");
    };
    doc.widgets.forEach((w, i) => walk(w, `widgets[${i}]`, false));
    if (count > 96) e.add("widgets", "≤ 96 widgets including grid children");
  }
  if (Array.isArray(doc.data) && doc.data.length > 8) e.add("data", "≤ 8 data sources");
  if (isObj(doc.vars) && Object.keys(doc.vars).length > 16) e.add("vars", "≤ 16 vars");
  return e.result();
}

export function validateIndex(doc: unknown): ValidationResult {
  const e = new Errors();
  if (!isObj(doc)) {
    e.add("", "index must be a JSON object");
    return e.result();
  }
  checkSpecVersion(doc, e);
  if (!isObj(doc.store)) e.add("store", "required");
  else {
    if (typeof doc.store.name !== "string" || !doc.store.name) e.add("store.name", "required");
    if (typeof doc.store.updated !== "string" || Number.isNaN(Date.parse(doc.store.updated)))
      e.add("store.updated", "must be ISO-8601");
  }
  if (!Array.isArray(doc.apps)) e.add("apps", "required array");
  else
    doc.apps.forEach((a, i) => {
      const p = `apps[${i}]`;
      if (!isObj(a)) return e.add(p, "must be an object");
      if (typeof a.id !== "string" || !APP_ID_RE.test(a.id)) e.add(`${p}.id`, "invalid app id");
      if (typeof a.name !== "string" || !a.name || a.name.length > 24) e.add(`${p}.name`, "required, ≤ 24 chars");
      if (typeof a.tagline !== "string" || a.tagline.length > 80) e.add(`${p}.tagline`, "required, ≤ 80 chars");
      if (typeof a.icon !== "string" || !a.icon) e.add(`${p}.icon`, "required");
      if (!VERSION_RE.test(String(a.version))) e.add(`${p}.version`, "must be MAJOR.MINOR.PATCH");
      if (typeof a.manifest !== "string" || !/^https?:\/\//.test(a.manifest)) e.add(`${p}.manifest`, "absolute URL");
      if (!VERSION_RE.test(String(a.min_os))) e.add(`${p}.min_os`, "must be MAJOR.MINOR.PATCH");
      if (a.kind !== undefined && a.kind !== "hosted" && a.kind !== "external") e.add(`${p}.kind`, "hosted|external");
      if (a.visibility !== undefined && !["public", "unlisted", "private"].includes(String(a.visibility)))
        e.add(`${p}.visibility`, "public|unlisted|private");
    });
  return e.result();
}

const dec = new TextDecoder();
const enc = new TextEncoder();

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(dec.decode(bytes));
}

/** Classifies a (possibly templated) URL without validating it. Mirrors the SDK. */
export function classifyUrl(url: string): UrlInfo | undefined {
  if (url.startsWith("{{")) {
    const m = /^\{\{\s*settings\.([a-z][a-z0-9_-]{0,31})\s*\}\}/.exec(url);
    return m ? { kind: "settings", settingKey: m[1] } : undefined;
  }
  if (/^https?:\/\//i.test(url)) {
    const end = url.indexOf("/", url.indexOf("//") + 2);
    const origin = end < 0 ? url : url.slice(0, end);
    return { kind: "absolute", origin: origin.toLowerCase() };
  }
  if (url.startsWith("/") && !url.startsWith("//")) return { kind: "relative", path: url.replace(/[?#].*$/, "") };
  return undefined;
}

/**
 * Directory prefix under which a hosted bundle expects to be served, derived from `entry`
 * (`/home.json` → "", `/hello/home.json` → "/hello"). The entry file sits at the bundle root.
 */
export function bundleMount(manifest: { entry?: unknown }): string | undefined {
  if (typeof manifest.entry !== "string") return undefined;
  const info = classifyUrl(manifest.entry);
  if (!info || info.kind !== "relative") return undefined;
  const p = info.path!;
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

const URL_KEYS = new Set(["url", "entry", "event", "icon", "src", "then_url", "manifest"]);

function escapePtr(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Every origin-relative URL in a document with its JSON pointer. */
function collectRelativeUrls(doc: unknown): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = [];
  const walk = (v: unknown, p: string, key: string | undefined): void => {
    if (typeof v === "string") {
      if (key !== undefined && URL_KEYS.has(key) && classifyUrl(v)?.kind === "relative") out.push({ path: p, url: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`, key === "hosts" ? "hosts" : undefined));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${p}/${escapePtr(k)}`, k);
  };
  walk(doc, "", undefined);
  return out;
}

/**
 * Rewrites every origin-relative URL under `fromMount` to `toMount` in the bundle's JSON files
 * (what the store does when it serves a bundle at `/a/<id>/<version>/`). Returns a new map.
 * Mirrors the SDK byte for byte so the swap is transparent.
 */
export function rebaseBundle(files: Map<string, Uint8Array>, fromMount: string, toMount: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const from = `${fromMount.replace(/\/$/, "")}/`;
  const to = `${toMount.replace(/\/$/, "")}/`;
  const rewrite = (v: unknown): unknown => {
    if (typeof v === "string") return classifyUrl(v)?.kind === "relative" && v.startsWith(from) ? to + v.slice(from.length) : v;
    if (Array.isArray(v)) return v.map(rewrite);
    if (isObj(v)) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = rewrite(x);
      return o;
    }
    return v;
  };
  for (const [name, bytes] of files) {
    if (name.endsWith(".json")) {
      try {
        out.set(name, enc.encode(JSON.stringify(rewrite(parseJson(bytes)))));
        continue;
      } catch {
        /* leave as is */
      }
    }
    out.set(name, bytes);
  }
  return out;
}

function normalizeName(name: string): string | undefined {
  let n = name.replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  if (n === "" || n.startsWith("/") || n.endsWith("/")) return undefined;
  const parts = n.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return undefined;
  return n;
}

function pngDims(bytes: Uint8Array): { w: number; h: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return undefined;
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

/**
 * Validates an unpacked bundle (path → bytes): `manifest.json` at the root and valid; every
 * screen (`*.json` with `widgets`) validates; origin-relative URLs resolve to files under the
 * mount implied by `entry`; PNGs are PNGs and the icon is 96×96; `store.json` is sane.
 */
export function validateBundle(files: Map<string, Uint8Array>): ValidationResult {
  const e = new Errors();
  const norm = new Map<string, Uint8Array>();
  let total = 0;
  for (const [name, bytes] of files) {
    if (name.endsWith("/")) continue;
    const n = normalizeName(name);
    if (n === undefined) {
      e.add(name, "file names must be plain relative paths");
      continue;
    }
    if (norm.has(n)) e.add(name, "duplicate file");
    norm.set(n, bytes);
    total += bytes.byteLength;
  }
  if (total > MAX_BUNDLE_BYTES) e.add("", `bundle is ${total} bytes; the limit is ${MAX_BUNDLE_BYTES}`);

  const manifestBytes = norm.get("manifest.json");
  if (!manifestBytes) {
    e.add("manifest.json", "bundle must contain manifest.json at its root");
    return e.result();
  }
  let manifest: unknown;
  try {
    manifest = parseJson(manifestBytes);
  } catch (err) {
    e.add("manifest.json", `invalid JSON: ${(err as Error).message}`);
    return e.result();
  }
  e.list.push(...validateManifest(manifest, "manifest.json").errors);
  if (!isObj(manifest)) return e.result();

  const mount = bundleMount(manifest);
  if (mount === undefined && typeof manifest.entry === "string") e.add("manifest.json#/entry", "a hosted bundle's entry must be origin-relative (/…)");
  const resolve = (url: string): string | undefined => {
    if (mount === undefined) return undefined;
    const path = classifyUrl(url)?.path;
    if (path === undefined) return undefined;
    const prefix = `${mount}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
  };
  const checkRefs = (doc: unknown, file: string): void => {
    for (const { path, url } of collectRelativeUrls(doc)) {
      const target = resolve(url);
      if (target === undefined) e.add(`${file}#${path}`, `${url} is outside the bundle mount ${mount ?? "(unknown)"}/`);
      else if (!norm.has(target)) e.add(`${file}#${path}`, `${url} does not exist in the bundle (expected file ${target})`);
    }
  };
  checkRefs(manifest, "manifest.json");

  for (const [name, bytes] of norm) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    let doc: unknown;
    try {
      doc = parseJson(bytes);
    } catch (err) {
      e.add(name, `invalid JSON: ${(err as Error).message}`);
      continue;
    }
    if (name === "store.json") {
      if (!isObj(doc)) e.add(name, "must be an object");
      else if (doc.tagline !== undefined && (typeof doc.tagline !== "string" || doc.tagline.length > 80)) e.add(`${name}#/tagline`, "at most 80 characters");
      continue;
    }
    if (!isObj(doc) || !Array.isArray(doc.widgets)) continue; // data fixture, not a screen
    if (bytes.byteLength > 32 * 1024) e.add(name, "screen documents must be ≤ 32 kB");
    e.list.push(...validateScreen(doc, name).errors);
    checkRefs(doc, name);
  }

  const iconTarget = typeof manifest.icon === "string" && classifyUrl(manifest.icon)?.kind === "relative" ? resolve(manifest.icon) : undefined;
  for (const [name, bytes] of norm) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const dims = pngDims(bytes);
    if (!dims) {
      e.add(name, "not a PNG file");
      continue;
    }
    if ((name === iconTarget || name === "icon.png") && (dims.w !== 96 || dims.h !== 96)) e.add(name, `icon must be 96×96 (got ${dims.w}×${dims.h})`);
  }
  return e.result();
}
