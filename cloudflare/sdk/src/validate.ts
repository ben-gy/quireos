/**
 * Validators for the §4 index, §5 manifest, §6 screen and §9 bundle. Every rule of the spec is
 * enforced here in plain TypeScript (no schema library at runtime); `spec/schema/*.schema.json`
 * mirror the structural subset and are cross-checked in tests.
 */
import {
  DEVICE_FIELDS,
  FILTER_NAMES,
  MAX_COND_DEPTH,
  RESERVED_ROOTS,
  hasTemplate,
  isCond,
  parseCond,
  tokenize,
} from "./expr.js";
import type { Expr } from "./expr.js";
import { ICON_NAMES, ICON_NAMES_UNCOMPILED } from "./profiles/icons.generated.js";
import type { Manifest, Setting, ValidationError, ValidationResult } from "./types.js";

/**
 * The icon names to check against. Omitting `icons` checks against the reference firmware's
 * compiled set, because the alternative silently skips the check and ships blanks to glass; pass
 * a wider list for a board that compiles more, or `[]` to skip deliberately.
 */
function iconsFor(icons: Iterable<string> | undefined): Set<string> | undefined {
  const set = new Set(icons ?? ICON_NAMES);
  return set.size ? set : undefined;
}

/**
 * An icon name the caller's set does not contain. A name the design library knows but this
 * firmware does not compile is the case an author can act on, so say so.
 */
function unknownIcon(name: string): string {
  return ICON_NAMES_UNCOMPILED.includes(name)
    ? `icon '${name}' is not compiled into this firmware; use a core icon or a PNG`
    : `unknown icon '${name}'`;
}

export const LIMITS = {
  DOC_BYTES: 32 * 1024,
  WIDGETS: 96,
  DATA_SOURCES: 8,
  IMAGES: 2,
  VARS: 16,
  SETTINGS: 8,
  STRING_BYTES: 512,
  LIST_ROWS: 16,
  NAME_CHARS: 24,
  TAGLINE_CHARS: 80,
  ERROR_MESSAGE_CHARS: 120,
  SETTINGS_HEADER_BYTES: 2048,
  DATA_RESPONSE_BYTES: 16 * 1024,
  IMAGE_BYTES: 256 * 1024,
  BUNDLE_BYTES: 5 * 1024 * 1024,
  ICON_PX: 96,
  HISTORY: 8,
} as const;

export const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const APP_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const SCREEN_SIZE_RE = /^[1-9]\d{1,4}x[1-9]\d{1,4}$/;
export const ICON_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const ORIGIN_RE = /^(https?):\/\/([^/\s?#:]+)(?::(\d{1,5}))?$/;

export const WIDGET_TYPES = ["text", "rect", "line", "icon", "image", "button", "grid"] as const;
export const ACTION_TYPES = ["navigate", "submit", "http", "set", "refresh", "back", "home"] as const;
export const TEXT_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "digits"] as const;
export const ICON_SIZES = ["sm", "md", "lg"] as const;
export const SETTING_TYPES = ["string", "secret", "url", "number", "bool", "select", "list"] as const;

export interface ValidateOptions {
  /** The app's manifest: enables `settings.<key>` existence, secret placement and host checks. */
  manifest?: Manifest;
  /** The app's own origin (`https://app.example.com`), allowed in addition to `manifest.hosts`. */
  origin?: string;
  /**
   * Icon names the target firmware compiles. Defaults to the reference build's set
   * (`ICON_NAMES`); pass a wider list for a board that compiles more, or `[]` to skip the check.
   */
  icons?: Iterable<string>;
  /** Byte size of the original document text, when the caller has it. */
  bytes?: number;
  /**
   * The logical panel the screen will be drawn on. When given, a widget that can never intersect
   * it is an error: running off an edge is fine (a fill may bleed deliberately), starting past one
   * is not, because nothing of it can ever be seen.
   */
  screen?: { w: number; h: number };
}

// ---------------------------------------------------------------------------------------------
// Helpers

const enc = new TextEncoder();
export function utf8Length(s: string): number {
  return enc.encode(s).length;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

class Errors {
  readonly errors: ValidationError[] = [];
  err(path: string, message: string): void {
    this.errors.push({ path, message });
  }
  result(): ValidationResult {
    return { ok: this.errors.length === 0, errors: this.errors };
  }
}

interface Parsed {
  value: unknown;
  bytes?: number;
}

/** Accepts an object, JSON text or UTF-8 bytes. */
function parseInput(doc: unknown, e: Errors): Parsed | undefined {
  if (doc instanceof Uint8Array) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(doc);
    } catch {
      e.err("", "document is not valid UTF-8");
      return undefined;
    }
    const p = parseInput(text, e);
    return p ? { value: p.value, bytes: doc.byteLength } : undefined;
  }
  if (typeof doc === "string") {
    try {
      return { value: JSON.parse(doc), bytes: utf8Length(doc) };
    } catch (err) {
      e.err("", `invalid JSON: ${(err as Error).message}`);
      return undefined;
    }
  }
  return { value: doc };
}

function requireObject(p: Parsed | undefined, e: Errors, what: string): Record<string, unknown> | undefined {
  if (!p) return undefined;
  if (!isObj(p.value)) {
    e.err("", `${what} must be a JSON object`);
    return undefined;
  }
  return p.value;
}

/** Walks every string in a document and reports those over 512 bytes. */
function checkStringSizes(v: unknown, path: string, e: Errors): void {
  if (isStr(v)) {
    const n = utf8Length(v);
    if (n > LIMITS.STRING_BYTES) e.err(path, `string is ${n} bytes; the limit is ${LIMITS.STRING_BYTES}`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => checkStringSizes(x, `${path}/${i}`, e));
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) checkStringSizes(x, `${path}/${escapePtr(k)}`, e);
  }
}

function escapePtr(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}

function checkSpecVersion(doc: Record<string, unknown>, e: Errors): void {
  const v = doc.spec_version;
  if (v === undefined) e.err("/spec_version", "spec_version is required");
  else if (!isInt(v) || v < 1) e.err("/spec_version", "spec_version must be a positive integer");
  else if (v !== 1) e.err("/spec_version", `spec_version ${v} is not supported (this validator implements 1)`);
}

function checkInt(v: unknown, path: string, e: Errors, min = -Infinity, max = Infinity, required = false): boolean {
  if (v === undefined) {
    if (required) e.err(path, "is required");
    return !required;
  }
  if (!isInt(v)) {
    e.err(path, "must be an integer");
    return false;
  }
  if (v < min || v > max) {
    e.err(path, `must be between ${min} and ${max}`);
    return false;
  }
  return true;
}

function checkBool(v: unknown, path: string, e: Errors): void {
  if (v !== undefined && !isBool(v)) e.err(path, "must be a boolean");
}

function checkEnum(v: unknown, path: string, e: Errors, values: readonly string[], required = false): boolean {
  if (v === undefined) {
    if (required) e.err(path, "is required");
    return !required;
  }
  if (!isStr(v) || !values.includes(v)) {
    e.err(path, `must be one of ${values.join(", ")}`);
    return false;
  }
  return true;
}

function checkVersion(v: unknown, path: string, e: Errors): void {
  if (!isStr(v) || !VERSION_RE.test(v)) e.err(path, "must be a MAJOR.MINOR.PATCH version");
}

function checkId(v: unknown, path: string, e: Errors, re: RegExp = ID_RE, required = true): boolean {
  if (v === undefined) {
    if (required) e.err(path, "is required");
    return !required;
  }
  if (!isStr(v) || !re.test(v)) {
    e.err(path, `must match ${re.source}`);
    return false;
  }
  return true;
}

/** Numeric compare of two `MAJOR.MINOR.PATCH` strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)\d+/;
/** True for hosts the device may reach over plain `http://` (RFC 1918, link-local, `.local`, localhost). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) return true;
  if (PRIVATE_V4.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Templates

interface Scope {
  dataIds: Set<string>;
  manifest?: Manifest;
  origin?: string;
  /** Literal origins the app may contact (from the manifest and `origin`). */
  allowed?: Set<string>;
  /** The logical panel, when the caller knows it. */
  screen?: { w: number; h: number };
}

function settingOf(scope: Scope, key: string): Setting | undefined {
  return scope.manifest?.settings?.find((s) => s.key === key);
}

/** Checks one parsed expression: root, device field, filters and settings usage. */
function checkExpr(expr: Expr, path: string, e: Errors, scope: Scope, secrets: boolean): void {
  const root = expr.path[0]!;
  if (!(RESERVED_ROOTS as readonly string[]).includes(root) && !scope.dataIds.has(root)) {
    e.err(path, `unknown template root '${root}' (expected settings, vars, device or a data source id)`);
  } else if (root === "device") {
    const field = expr.path[1];
    if (field !== undefined && !(DEVICE_FIELDS as readonly string[]).includes(field)) {
      e.err(path, `unknown device field '${field}'`);
    }
  } else if (root === "settings" && scope.manifest) {
    const key = expr.path[1];
    if (key === undefined) {
      e.err(path, "settings needs a key");
    } else {
      const s = settingOf(scope, key);
      if (!s) e.err(path, `unknown setting '${key}'`);
      else if (s.type === "secret" && !secrets) {
        e.err(path, `secret setting '${key}' may only be used in http/data/image URLs, headers and bodies`);
      } else if (s.type === "list") {
        const idx = expr.path[2];
        const field = expr.path[3];
        if (idx !== undefined && !/^\d+$/.test(idx)) e.err(path, `list setting '${key}' must be indexed by row number`);
        if (field !== undefined && !s.item.some((it) => it.key === field)) {
          e.err(path, `list setting '${key}' has no field '${field}'`);
        }
      } else if (expr.path.length > 2) {
        e.err(path, `setting '${key}' is a scalar and has no sub-path`);
      }
    }
  }
  for (const f of expr.filters) {
    if (!(FILTER_NAMES as readonly string[]).includes(f.name)) {
      e.err(path, `unknown filter '${f.name}'`);
      continue;
    }
    if (f.name === "fixed" && (f.arg === undefined || !/^\d+$/.test(f.arg))) e.err(path, "fixed needs a non-negative integer argument");
    if ((f.name === "time" || f.name === "default") && f.arg === undefined) e.err(path, `${f.name} needs an argument`);
    if ((f.name === "upper" || f.name === "lower") && f.arg !== undefined) e.err(path, `${f.name} takes no argument`);
  }
}

function checkTemplate(s: string, path: string, e: Errors, scope: Scope, secrets = false): void {
  if (!hasTemplate(s)) return;
  for (const t of tokenize(s)) {
    if (t.type !== "expr") continue;
    if (!t.expr) e.err(path, `malformed template: ${t.error ?? t.raw}`);
    else checkExpr(t.expr, path, e, scope, secrets);
  }
}

function checkCondString(s: unknown, path: string, e: Errors, scope: Scope): void {
  if (!isStr(s)) {
    e.err(path, "condition must be a string");
    return;
  }
  try {
    const c = parseCond(s);
    checkExpr(c.expr, path, e, scope, false);
  } catch (err) {
    e.err(path, `malformed condition: ${(err as Error).message}`);
  }
}

type ValueSpec =
  | { kind: "string" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "color"; nullable?: boolean }
  | { kind: "scalar" };

/**
 * Checks a dynamic property: a literal of the expected type, a template (string-typed properties,
 * or any branch of a conditional) or a conditional value nested at most 3 deep.
 */
function checkValue(
  v: unknown,
  path: string,
  e: Errors,
  scope: Scope,
  spec: ValueSpec,
  opts: { required?: boolean; secrets?: boolean; depth?: number } = {},
): void {
  const depth = opts.depth ?? 0;
  if (v === undefined) {
    if (opts.required) e.err(path, "is required");
    return;
  }
  if (isStr(v)) {
    if (hasTemplate(v)) {
      if (spec.kind === "color" && depth === 0) {
        e.err(path, "templates are not allowed in colour properties; use a conditional value");
        return;
      }
      checkTemplate(v, path, e, scope, opts.secrets);
      return;
    }
    if (spec.kind === "enum" && !spec.values.includes(v)) e.err(path, `must be one of ${spec.values.join(", ")}`);
    else if (spec.kind === "color") e.err(path, "must be an integer 0-15" + (spec.nullable ? " or null" : ""));
    return;
  }
  if (isCond(v)) {
    if (depth >= MAX_COND_DEPTH) {
      e.err(path, `conditional values nest at most ${MAX_COND_DEPTH} deep`);
      return;
    }
    checkCondString(v.if, `${path}/if`, e, scope);
    const inner = { ...opts, depth: depth + 1, required: true };
    checkValue(v.then, `${path}/then`, e, scope, spec, inner);
    if (v.else !== undefined) checkValue(v.else, `${path}/else`, e, scope, spec, inner);
    for (const k of Object.keys(v)) if (k !== "if" && k !== "then" && k !== "else") e.err(`${path}/${k}`, "unknown key in conditional value");
    return;
  }
  if (v === null) {
    if (spec.kind === "color" && spec.nullable) return;
    if (spec.kind === "scalar") return;
    e.err(path, spec.kind === "color" ? "must be an integer 0-15" : "must be a string");
    return;
  }
  if (typeof v === "number") {
    if (spec.kind === "color") {
      if (!isInt(v) || v < 0 || v > 15) e.err(path, "must be an integer 0-15");
    } else if (spec.kind === "string" || spec.kind === "enum") e.err(path, "must be a string");
    return;
  }
  if (typeof v === "boolean") {
    if (spec.kind !== "scalar") e.err(path, spec.kind === "color" ? "must be an integer 0-15" : "must be a string");
    return;
  }
  e.err(path, "must be a scalar, a template or a conditional value");
}

/** Map of templated string values (headers, args, vars, set). */
function checkValueMap(v: unknown, path: string, e: Errors, scope: Scope, opts: { keys?: RegExp; secrets?: boolean; limit?: number; stringsOnly?: boolean }): void {
  if (v === undefined) return;
  if (!isObj(v)) {
    e.err(path, "must be an object");
    return;
  }
  const entries = Object.entries(v);
  if (opts.limit !== undefined && entries.length > opts.limit) e.err(path, `at most ${opts.limit} entries`);
  for (const [k, x] of entries) {
    const p = `${path}/${escapePtr(k)}`;
    if (opts.keys && !opts.keys.test(k)) e.err(p, `key must match ${opts.keys.source}`);
    if (opts.stringsOnly) {
      if (!isStr(x)) e.err(p, "must be a string");
      else checkTemplate(x, p, e, scope, opts.secrets);
    } else checkValue(x, p, e, scope, { kind: "scalar" }, { secrets: opts.secrets });
  }
}

function checkBody(v: unknown, path: string, e: Errors, scope: Scope, raw: boolean, secrets: boolean): void {
  if (v === undefined) return;
  if (isStr(v)) {
    if (!raw) checkTemplate(v, path, e, scope, secrets);
    return;
  }
  if (!isObj(v) && !Array.isArray(v)) {
    e.err(path, "must be an object, an array or a string");
    return;
  }
  if (raw) return;
  const walk = (x: unknown, p: string): void => {
    if (isStr(x)) checkTemplate(x, p, e, scope, secrets);
    else if (isCond(x)) checkValue(x, p, e, scope, { kind: "scalar" }, { secrets });
    else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${p}/${i}`));
    else if (isObj(x)) for (const [k, y] of Object.entries(x)) walk(y, `${p}/${escapePtr(k)}`);
  };
  walk(v, path);
}

// ---------------------------------------------------------------------------------------------
// URLs

export interface UrlInfo {
  kind: "absolute" | "relative" | "settings";
  origin?: string;
  settingKey?: string;
  /** Path (for relative URLs) without query or fragment. */
  path?: string;
}

/** Classifies a (possibly templated) URL without validating it. */
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
  if (url.startsWith("/") && !url.startsWith("//")) {
    return { kind: "relative", path: url.replace(/[?#].*$/, "") };
  }
  return undefined;
}

function checkUrl(
  v: unknown,
  path: string,
  e: Errors,
  scope: Scope,
  opts: { required?: boolean; templates?: boolean; secrets?: boolean } = {},
): void {
  if (v === undefined) {
    if (opts.required) e.err(path, "is required");
    return;
  }
  if (!isStr(v)) {
    e.err(path, "must be a string");
    return;
  }
  if (v === "") {
    e.err(path, "must not be empty");
    return;
  }
  if (!opts.templates && hasTemplate(v)) {
    e.err(path, "templates are not allowed here");
    return;
  }
  checkTemplate(v, path, e, scope, opts.secrets);
  const info = classifyUrl(v);
  if (!info) {
    e.err(path, "must be an absolute URL (https://…), origin-relative (/…) or start with {{settings.<key>}}");
    return;
  }
  if (info.kind === "settings") {
    if (scope.manifest) {
      const s = settingOf(scope, info.settingKey!);
      if (!s) e.err(path, `unknown setting '${info.settingKey}'`);
      else if (s.type !== "url") e.err(path, `setting '${info.settingKey}' in the origin position must be a url setting`);
    }
    return;
  }
  if (info.kind === "absolute") {
    const origin = info.origin!;
    if (hasTemplate(origin)) {
      e.err(path, "only {{settings.<key>}} may appear in the origin position");
      return;
    }
    const m = ORIGIN_RE.exec(origin);
    if (!m) {
      e.err(path, "malformed origin");
      return;
    }
    if (m[1] === "http" && !isPrivateHost(m[2]!)) e.err(path, "plain http:// is only allowed to private-network hosts");
    if (scope.allowed && !scope.allowed.has(origin)) e.err(path, `origin ${origin} is not declared in the manifest hosts`);
  }
}

/** Builds the literal allowed-origin set from a manifest (plus the app origin when known). */
export function allowedOrigins(manifest: Manifest, origin?: string): Set<string> {
  const set = new Set<string>();
  if (origin) set.add(origin.toLowerCase().replace(/\/$/, ""));
  for (const h of manifest.hosts ?? []) if (isStr(h) && !hasTemplate(h)) set.add(h.toLowerCase());
  return set;
}

function makeScope(opts: ValidateOptions, dataIds: Set<string>): Scope {
  const scope: Scope = { dataIds, manifest: opts.manifest, origin: opts.origin, screen: opts.screen };
  if (opts.manifest) scope.allowed = allowedOrigins(opts.manifest, opts.origin);
  return scope;
}

// ---------------------------------------------------------------------------------------------
// Actions

function checkAction(v: unknown, path: string, e: Errors, scope: Scope): void {
  if (v === undefined) return;
  if (!isObj(v)) {
    e.err(path, "must be an action object");
    return;
  }
  if (!checkEnum(v.type, `${path}/type`, e, ACTION_TYPES, true)) return;
  const type = v.type as (typeof ACTION_TYPES)[number];
  const then = (): void => {
    checkEnum(v.then, `${path}/then`, e, ["none", "refresh", "back", "home", "navigate"]);
    if (v.then === "navigate") checkUrl(v.then_url, `${path}/then_url`, e, scope, { required: true, templates: true });
    else if (v.then_url !== undefined) checkUrl(v.then_url, `${path}/then_url`, e, scope, { templates: true });
    checkInt(v.after, `${path}/after`, e, 0, 3600);
    checkValueMap(v.set, `${path}/set`, e, scope, { keys: ID_RE, limit: LIMITS.VARS });
  };
  switch (type) {
    case "navigate":
      checkUrl(v.url, `${path}/url`, e, scope, { required: true, templates: true });
      checkBool(v.replace, `${path}/replace`, e);
      break;
    case "submit":
      if (!isStr(v.event) || v.event === "") e.err(`${path}/event`, "is required");
      checkValueMap(v.args, `${path}/args`, e, scope, {});
      then();
      break;
    case "http":
      checkEnum(v.method, `${path}/method`, e, ["GET", "POST", "PUT", "DELETE"]);
      checkUrl(v.url, `${path}/url`, e, scope, { required: true, templates: true, secrets: true });
      checkValueMap(v.headers, `${path}/headers`, e, scope, { stringsOnly: true, secrets: true });
      checkBool(v.body_raw, `${path}/body_raw`, e);
      checkBody(v.body, `${path}/body`, e, scope, v.body_raw === true, true);
      then();
      break;
    case "set":
      if (v.vars === undefined) e.err(`${path}/vars`, "is required");
      checkValueMap(v.vars, `${path}/vars`, e, scope, { keys: ID_RE, limit: LIMITS.VARS });
      then();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Widgets

const COLOR: ValueSpec = { kind: "color" };
const COLOR_NULL: ValueSpec = { kind: "color", nullable: true };
const STRING: ValueSpec = { kind: "string" };

interface WidgetCounts {
  widgets: number;
  images: number;
}

/**
 * The largest line height and icon any bundled profile uses. Deriving an unknown dimension from
 * these keeps the check sound on every board: a real widget is never larger, so a widget this
 * check rules out could not have reached the panel on any of them.
 */
const MAX_LINE_HEIGHT_BY_SIZE: Record<string, number> = {
  xs: 24, sm: 29, md: 36, lg: 44, xl: 56, "2xl": 72, "3xl": 96, digits: 150,
};
const MAX_ICON_PX_BY_SIZE: Record<string, number> = { sm: 24, md: 36, lg: 64 };
const MAX_LINE_HEIGHT = 150;
const MAX_ICON_PX = 64;
const MAX_LINES = 8;

// Three cases, not two: absent means the spec's default, a literal means itself, and anything the
// device resolves later means the largest it could become. Treating absent as unresolved is sound
// but blinds the check to every widget that did not state a size, which is most of them.
const DEFAULT_SIZE = "md";

/** The tallest a line of this size can be on any profile. */
function maxLineHeight(size: unknown): number {
  if (size === undefined) return MAX_LINE_HEIGHT_BY_SIZE[DEFAULT_SIZE]!;
  return typeof size === "string" ? (MAX_LINE_HEIGHT_BY_SIZE[size] ?? MAX_LINE_HEIGHT) : MAX_LINE_HEIGHT;
}
function maxIconPx(size: unknown): number {
  if (size === undefined) return MAX_ICON_PX_BY_SIZE[DEFAULT_SIZE]!;
  return typeof size === "string" ? (MAX_ICON_PX_BY_SIZE[size] ?? MAX_ICON_PX) : MAX_ICON_PX;
}

/** A grid's own geometry, so a child's cell offset resolves to an absolute position. */
interface GridFrame {
  cols: number;
  rows: number;
  x?: number;
  y?: number;
  cellW?: number;
  cellH?: number;
  gap?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Where a widget starts, and how big it is when the document says. A grid child is resolved
 * through its cell first; a line uses its top-left corner.
 */
function originOf(v: Record<string, unknown>, type: string, grid: GridFrame | undefined): { x?: number; y?: number; w?: number; h?: number } {
  let x = num(v.x);
  let y = num(v.y);
  let w = num(v.w);
  let h = num(v.h);
  if (type === "line") {
    const x1 = num(v.x1);
    const x2 = num(v.x2);
    const y1 = num(v.y1);
    const y2 = num(v.y2);
    if (x1 !== undefined && x2 !== undefined) { x = Math.min(x1, x2); w = Math.abs(x2 - x1); }
    if (y1 !== undefined && y2 !== undefined) { y = Math.min(y1, y2); h = Math.abs(y2 - y1); }
  }
  // An unknown dimension is derived only as an UPPER bound: over-estimating the extent can only
  // make the check quieter, while under-estimating would report a widget that is in fact visible.
  if (!grid) {
    if (h === undefined && type === "text") {
      // `lines` is absent (one line) or a number. Anything else is separately invalid, and
      // assuming one line there would under-estimate the extent and report a visible widget as
      // off the panel, so take the most lines the spec allows.
      const lines = v.lines === undefined ? 1 : (num(v.lines) ?? MAX_LINES);
      h = maxLineHeight(v.size) * Math.min(MAX_LINES, Math.max(1, lines));
    } else if (type === "icon") {
      const px = maxIconPx(v.size);
      w = w ?? px;
      h = h ?? px;
    }
  }
  if (grid) {
    if (grid.x === undefined || grid.cellW === undefined || grid.gap === undefined) return {};
    const cell = v.cell;
    let col: number | undefined;
    let row: number | undefined;
    if (typeof cell === "number") { col = cell % grid.cols; row = Math.floor(cell / grid.cols); }
    else if (Array.isArray(cell) && cell.length === 2 && typeof cell[0] === "number" && typeof cell[1] === "number") { col = cell[0]; row = cell[1]; }
    if (col === undefined || row === undefined) return {};
    x = grid.x + col * (grid.cellW + grid.gap) + (x ?? 0);
    y = (grid.y ?? 0) + row * ((grid.cellH ?? 0) + grid.gap) + (y ?? 0);
    // A child that omits w/h fills its cell.
    w = w ?? grid.cellW;
    h = h ?? grid.cellH;
  }
  return { x, y, w, h };
}

function checkOnScreen(v: Record<string, unknown>, type: string, path: string, e: Errors, scope: Scope, grid: GridFrame | undefined): void {
  const s = scope.screen;
  if (!s || type === "grid") return;
  const { x, y, w, h } = originOf(v, type, grid);
  if (x !== undefined) {
    if (x >= s.w) e.err(`${path}/x`, `starts at x=${x}, past the ${s.w}px panel, so it can never be seen`);
    else if (w !== undefined && x + w <= 0) e.err(`${path}/x`, `ends at x=${x + w}, left of the panel, so it can never be seen`);
  }
  if (y !== undefined) {
    if (y >= s.h) e.err(`${path}/y`, `starts at y=${y}, below the ${s.h}px panel, so it can never be seen`);
    else if (h !== undefined && y + h <= 0) e.err(`${path}/y`, `ends at y=${y + h}, above the panel, so it can never be seen`);
  }
}

function checkWidget(v: unknown, path: string, e: Errors, scope: Scope, counts: WidgetCounts, grid?: GridFrame): void {
  counts.widgets++;
  if (!isObj(v)) {
    e.err(path, "must be a widget object");
    return;
  }
  if (!checkEnum(v.type, `${path}/type`, e, WIDGET_TYPES, true)) return;
  const type = v.type as (typeof WIDGET_TYPES)[number];
  const inGrid = grid !== undefined;
  if (inGrid && type === "grid") {
    e.err(`${path}/type`, "grids cannot be nested");
    return;
  }
  checkId(v.id, `${path}/id`, e, ID_RE, false);
  const needXY = type !== "line";
  checkInt(v.x, `${path}/x`, e, -32768, 32767, needXY && !inGrid);
  checkInt(v.y, `${path}/y`, e, -32768, 32767, needXY && !inGrid);
  const needW = (type === "text" || type === "rect" || type === "image" || type === "button") && !inGrid;
  const needH = (type === "rect" || type === "image" || type === "button") && !inGrid;
  checkInt(v.w, `${path}/w`, e, 0, 32767, needW);
  checkInt(v.h, `${path}/h`, e, 0, 32767, needH);
  checkOnScreen(v, type, path, e, scope, grid);
  if (v.when !== undefined) checkCondString(v.when, `${path}/when`, e, scope);
  if (v.disabled !== undefined) checkCondString(v.disabled, `${path}/disabled`, e, scope);
  checkAction(v.on_tap, `${path}/on_tap`, e, scope);
  checkAction(v.on_hold, `${path}/on_hold`, e, scope);
  checkValue(v.feedback, `${path}/feedback`, e, scope, { kind: "enum", values: ["invert", "none"] });
  if (inGrid) {
    const c = v.cell;
    if (c === undefined) e.err(`${path}/cell`, "grid children need a cell");
    else if (isInt(c)) {
      if (c < 0 || c >= grid.cols * grid.rows) e.err(`${path}/cell`, `must be between 0 and ${grid.cols * grid.rows - 1}`);
    } else if (Array.isArray(c) && c.length === 2 && isInt(c[0]) && isInt(c[1])) {
      if (c[0] < 0 || c[0] >= grid.cols || c[1] < 0 || c[1] >= grid.rows) e.err(`${path}/cell`, `[col, row] must be within ${grid.cols}×${grid.rows}`);
    } else e.err(`${path}/cell`, "must be an integer or [col, row]");
  } else if (v.cell !== undefined) e.err(`${path}/cell`, "cell is only valid inside a grid");

  switch (type) {
    case "text":
      checkValue(v.text, `${path}/text`, e, scope, STRING, { required: true });
      checkValue(v.size, `${path}/size`, e, scope, { kind: "enum", values: TEXT_SIZES });
      checkValue(v.weight, `${path}/weight`, e, scope, { kind: "enum", values: ["regular", "bold"] });
      checkValue(v.align, `${path}/align`, e, scope, { kind: "enum", values: ["left", "center", "right"] });
      checkValue(v.valign, `${path}/valign`, e, scope, { kind: "enum", values: ["top", "middle", "bottom"] });
      checkValue(v.color, `${path}/color`, e, scope, COLOR);
      checkInt(v.lines, `${path}/lines`, e, 1, 8);
      break;
    case "rect":
      checkValue(v.fill, `${path}/fill`, e, scope, COLOR_NULL);
      checkValue(v.stroke, `${path}/stroke`, e, scope, COLOR_NULL);
      checkInt(v.stroke_w, `${path}/stroke_w`, e, 1, 8);
      checkInt(v.radius, `${path}/radius`, e, 0, 64);
      break;
    case "line":
      for (const k of ["x1", "y1", "x2", "y2"]) checkInt(v[k], `${path}/${k}`, e, -32768, 32767, true);
      checkValue(v.color, `${path}/color`, e, scope, COLOR);
      checkInt(v.width, `${path}/width`, e, 1, 8);
      break;
    case "icon":
      checkValue(v.name, `${path}/name`, e, scope, STRING, { required: true });
      if (isStr(v.name) && !hasTemplate(v.name)) checkIconName(v.name, `${path}/name`, e, scope);
      checkValue(v.size, `${path}/size`, e, scope, { kind: "enum", values: ICON_SIZES });
      checkValue(v.color, `${path}/color`, e, scope, COLOR);
      break;
    case "image":
      counts.images++;
      checkUrl(v.src, `${path}/src`, e, scope, { required: true, templates: true, secrets: true });
      checkInt(v.ttl, `${path}/ttl`, e, 0);
      break;
    case "button":
      checkValue(v.label, `${path}/label`, e, scope, STRING, { required: true });
      checkValue(v.sub, `${path}/sub`, e, scope, STRING);
      checkValue(v.icon, `${path}/icon`, e, scope, STRING);
      if (isStr(v.icon) && !hasTemplate(v.icon)) checkIconName(v.icon, `${path}/icon`, e, scope);
      checkValue(v.size, `${path}/size`, e, scope, { kind: "enum", values: TEXT_SIZES });
      checkInt(v.lines, `${path}/lines`, e, 1, 8);
      checkValue(v.fill, `${path}/fill`, e, scope, COLOR_NULL);
      checkValue(v.stroke, `${path}/stroke`, e, scope, COLOR_NULL);
      checkInt(v.stroke_w, `${path}/stroke_w`, e, 1, 8);
      checkInt(v.radius, `${path}/radius`, e, 0, 64);
      checkValue(v.color, `${path}/color`, e, scope, COLOR);
      break;
    case "grid": {
      const ok =
        checkInt(v.cols, `${path}/cols`, e, 1, 64, true) &&
        checkInt(v.rows, `${path}/rows`, e, 1, 64, true) &&
        checkInt(v.cell_w, `${path}/cell_w`, e, 1, 32767, true) &&
        checkInt(v.cell_h, `${path}/cell_h`, e, 1, 32767, true) &&
        checkInt(v.gap, `${path}/gap`, e, 0, 32767, true);
      if (!Array.isArray(v.children)) {
        e.err(`${path}/children`, "grid needs a children array");
        break;
      }
      const g: GridFrame = ok
        ? {
            cols: v.cols as number,
            rows: v.rows as number,
            x: num(v.x),
            y: num(v.y),
            cellW: v.cell_w as number,
            cellH: v.cell_h as number,
            gap: v.gap as number,
          }
        : { cols: 1e9, rows: 1e9 };
      v.children.forEach((c, i) => checkWidget(c, `${path}/children/${i}`, e, scope, counts, g));
      break;
    }
  }
}

let iconSet: Set<string> | undefined;
function checkIconName(name: string, path: string, e: Errors, scope: Scope): void {
  if (!ICON_NAME_RE.test(name)) e.err(path, "icon names are lower-case identifiers");
  else if (iconSet && !iconSet.has(name)) e.err(path, unknownIcon(name));
  void scope;
}

// ---------------------------------------------------------------------------------------------
// Screen

export function validateScreen(doc: unknown, opts: ValidateOptions = {}): ValidationResult {
  const e = new Errors();
  const parsed = parseInput(doc, e);
  const d = requireObject(parsed, e, "screen");
  if (!d) return e.result();
  iconSet = iconsFor(opts.icons);

  const bytes = opts.bytes ?? parsed!.bytes ?? utf8Length(JSON.stringify(d));
  if (bytes > LIMITS.DOC_BYTES) e.err("", `document is ${bytes} bytes; the limit is ${LIMITS.DOC_BYTES}`);
  checkStringSizes(d, "", e);
  checkSpecVersion(d, e);
  checkId(d.id, "/id", e);

  // data sources first: their ids are template roots
  const dataIds = new Set<string>();
  if (d.data !== undefined) {
    if (!Array.isArray(d.data)) e.err("/data", "must be an array");
    else {
      if (d.data.length > LIMITS.DATA_SOURCES) e.err("/data", `at most ${LIMITS.DATA_SOURCES} data sources`);
      d.data.forEach((ds, i) => {
        if (isObj(ds) && isStr(ds.id) && ID_RE.test(ds.id)) {
          if ((RESERVED_ROOTS as readonly string[]).includes(ds.id)) e.err(`/data/${i}/id`, `'${ds.id}' is reserved`);
          else if (dataIds.has(ds.id)) e.err(`/data/${i}/id`, `duplicate data id '${ds.id}'`);
          dataIds.add(ds.id);
        }
      });
    }
  }
  const scope = makeScope(opts, dataIds);

  checkUrl(d.url, "/url", e, scope, {});
  checkInt(d.ttl, "/ttl", e, 0);
  checkEnum(d.refresh, "/refresh", e, ["auto", "partial", "full"]);

  if (Array.isArray(d.data)) {
    d.data.forEach((ds, i) => {
      const p = `/data/${i}`;
      if (!isObj(ds)) {
        e.err(p, "must be a data source object");
        return;
      }
      checkId(ds.id, `${p}/id`, e);
      checkUrl(ds.url, `${p}/url`, e, scope, { required: true, templates: true, secrets: true });
      checkEnum(ds.method, `${p}/method`, e, ["GET", "POST"]);
      checkValueMap(ds.headers, `${p}/headers`, e, scope, { stringsOnly: true, secrets: true });
      checkBool(ds.body_raw, `${p}/body_raw`, e);
      checkBody(ds.body, `${p}/body`, e, scope, ds.body_raw === true, true);
      checkInt(ds.ttl, `${p}/ttl`, e, 0);
      checkBool(ds.required, `${p}/required`, e);
    });
  }

  checkValueMap(d.vars, "/vars", e, scope, { keys: ID_RE, limit: LIMITS.VARS });

  if (d.keys !== undefined) {
    if (!isObj(d.keys)) e.err("/keys", "must be an object of { short?, double? } actions");
    else {
      checkAction(d.keys.short, "/keys/short", e, scope);
      checkAction(d.keys.double, "/keys/double", e, scope);
      if (d.keys.long !== undefined) e.err("/keys/long", "long press is always Home and cannot be bound");
    }
  }

  if (!Array.isArray(d.widgets)) e.err("/widgets", "widgets array is required");
  else {
    const counts: WidgetCounts = { widgets: 0, images: 0 };
    d.widgets.forEach((w, i) => checkWidget(w, `/widgets/${i}`, e, scope, counts));
    if (counts.widgets > LIMITS.WIDGETS) e.err("/widgets", `${counts.widgets} widgets including grid children; the limit is ${LIMITS.WIDGETS}`);
    if (counts.images > LIMITS.IMAGES) e.err("/widgets", `${counts.images} images; the limit is ${LIMITS.IMAGES}`);
  }
  iconSet = undefined;
  return e.result();
}

// ---------------------------------------------------------------------------------------------
// Manifest

function checkSetting(v: unknown, path: string, e: Errors, nested: boolean): Setting | undefined {
  if (!isObj(v)) {
    e.err(path, "must be a setting object");
    return undefined;
  }
  checkId(v.key, `${path}/key`, e);
  if (!isStr(v.label) || v.label === "") e.err(`${path}/label`, "is required");
  if (!checkEnum(v.type, `${path}/type`, e, SETTING_TYPES, true)) return undefined;
  const type = v.type as (typeof SETTING_TYPES)[number];
  checkBool(v.required, `${path}/required`, e);
  if (v.help !== undefined && !isStr(v.help)) e.err(`${path}/help`, "must be a string");
  if (nested && type === "list") e.err(`${path}/type`, "lists cannot be nested");
  if (type !== "select" && v.options !== undefined) e.err(`${path}/options`, "options are only valid for select settings");
  if (type !== "list" && v.item !== undefined) e.err(`${path}/item`, "item is only valid for list settings");
  if (type !== "number" && type !== "list" && (v.min !== undefined || v.max !== undefined)) e.err(`${path}/min`, "min/max are only valid for number and list settings");
  if (v.min !== undefined && typeof v.min !== "number") e.err(`${path}/min`, "must be a number");
  if (v.max !== undefined && typeof v.max !== "number") e.err(`${path}/max`, "must be a number");
  if (typeof v.min === "number" && typeof v.max === "number" && v.min > v.max) e.err(`${path}/max`, "must be ≥ min");
  const def = v.default;
  switch (type) {
    case "secret":
      if (def !== undefined) e.err(`${path}/default`, "secrets cannot have a default");
      break;
    case "string":
    case "url":
      if (def !== undefined && !isStr(def)) e.err(`${path}/default`, "must be a string");
      if (type === "url" && isStr(def) && !ORIGIN_RE.test(def) && !/^https?:\/\/[^/\s?#]+\/?/.test(def)) e.err(`${path}/default`, "must be an http(s) URL");
      break;
    case "number":
      if (def !== undefined && typeof def !== "number") e.err(`${path}/default`, "must be a number");
      break;
    case "bool":
      if (def !== undefined && !isBool(def)) e.err(`${path}/default`, "must be a boolean");
      break;
    case "select": {
      if (!Array.isArray(v.options) || v.options.length === 0) e.err(`${path}/options`, "select needs a non-empty options array");
      else {
        v.options.forEach((o, i) => {
          if (!isObj(o) || (!isStr(o.value) && typeof o.value !== "number") || !isStr(o.label)) e.err(`${path}/options/${i}`, "must be { value, label }");
        });
        if (def !== undefined && !v.options.some((o) => isObj(o) && o.value === def)) e.err(`${path}/default`, "must be one of the option values");
      }
      break;
    }
    case "list": {
      if (!Array.isArray(v.item) || v.item.length === 0) e.err(`${path}/item`, "list needs a non-empty item array");
      else {
        const keys = new Set<string>();
        v.item.forEach((it, i) => {
          const s = checkSetting(it, `${path}/item/${i}`, e, true);
          if (s) {
            if (keys.has(s.key)) e.err(`${path}/item/${i}/key`, `duplicate field '${s.key}'`);
            keys.add(s.key);
          }
        });
      }
      if (typeof v.max === "number" && v.max > LIMITS.LIST_ROWS) e.err(`${path}/max`, `at most ${LIMITS.LIST_ROWS} rows`);
      if (def !== undefined && !Array.isArray(def)) e.err(`${path}/default`, "must be an array of rows");
      break;
    }
  }
  return v as unknown as Setting;
}

export function validateManifest(doc: unknown, opts: ValidateOptions = {}): ValidationResult {
  const e = new Errors();
  const d = requireObject(parseInput(doc, e), e, "manifest");
  if (!d) return e.result();
  checkStringSizes(d, "", e);
  checkSpecVersion(d, e);
  checkId(d.id, "/id", e, APP_ID_RE);
  if (!isStr(d.name) || d.name === "") e.err("/name", "is required");
  else if ([...d.name].length > LIMITS.NAME_CHARS) e.err("/name", `at most ${LIMITS.NAME_CHARS} characters`);
  checkVersion(d.version, "/version", e);
  checkVersion(d.min_os, "/min_os", e);
  checkEnum(d.orientation, "/orientation", e, ["portrait", "landscape"]);
  if (d.screens !== undefined) {
    if (!Array.isArray(d.screens)) e.err("/screens", "must be an array");
    else d.screens.forEach((s, i) => { if (!isStr(s) || !SCREEN_SIZE_RE.test(s)) e.err(`/screens/${i}`, "must look like 540x960"); });
  }

  // settings
  const settings: Setting[] = [];
  if (d.settings !== undefined) {
    if (!Array.isArray(d.settings)) e.err("/settings", "must be an array");
    else {
      if (d.settings.length > LIMITS.SETTINGS) e.err("/settings", `at most ${LIMITS.SETTINGS} settings`);
      const keys = new Set<string>();
      d.settings.forEach((s, i) => {
        const st = checkSetting(s, `/settings/${i}`, e, false);
        if (st) {
          if (isStr(st.key) && keys.has(st.key)) e.err(`/settings/${i}/key`, `duplicate setting '${st.key}'`);
          if (isStr(st.key)) keys.add(st.key);
          settings.push(st);
        }
      });
    }
  }
  const manifest = { ...d, settings } as unknown as Manifest;
  const scope: Scope = { dataIds: new Set(), manifest };

  // icon
  if (!isStr(d.icon) || d.icon === "") e.err("/icon", "is required");
  else if (/^(https?:\/\/|\/)/.test(d.icon)) checkUrl(d.icon, "/icon", e, scope, {});
  else {
    const icons = iconsFor(opts.icons);
    if (!ICON_NAME_RE.test(d.icon)) e.err("/icon", "must be an icon name or a PNG URL");
    else if (icons && !icons.has(d.icon)) e.err("/icon", unknownIcon(d.icon));
  }

  checkUrl(d.entry, "/entry", e, scope, { required: true });
  checkUrl(d.event, "/event", e, scope, {});

  if (d.hosts !== undefined) {
    if (!Array.isArray(d.hosts)) e.err("/hosts", "must be an array");
    else d.hosts.forEach((h, i) => {
      const p = `/hosts/${i}`;
      if (!isStr(h)) return e.err(p, "must be a string");
      if (hasTemplate(h)) {
        const m = /^\{\{\s*settings\.([a-z][a-z0-9_-]{0,31})\s*\}\}$/.exec(h);
        if (!m) return e.err(p, "must be a literal origin or exactly {{settings.<key>}}");
        const s = settings.find((x) => x.key === m[1]);
        if (!s) return e.err(p, `unknown setting '${m[1]}'`);
        if (s.type !== "url") return e.err(p, `setting '${m[1]}' must be a url setting`);
        return;
      }
      const m = ORIGIN_RE.exec(h);
      if (!m) return e.err(p, "must be an origin like https://api.example.com (no path)");
      if (h !== h.toLowerCase()) e.err(p, "origins are lower-case");
      if (m[1] === "http" && !isPrivateHost(m[2]!)) e.err(p, "plain http:// is only allowed to private-network hosts");
    });
  }
  return e.result();
}

// ---------------------------------------------------------------------------------------------
// Index

export function validateIndex(doc: unknown, opts: ValidateOptions = {}): ValidationResult {
  const e = new Errors();
  const d = requireObject(parseInput(doc, e), e, "index");
  if (!d) return e.result();
  checkStringSizes(d, "", e);
  checkSpecVersion(d, e);
  if (!isObj(d.store)) e.err("/store", "is required");
  else {
    if (!isStr(d.store.name) || d.store.name === "") e.err("/store/name", "is required");
    if (!isStr(d.store.updated) || Number.isNaN(Date.parse(d.store.updated))) e.err("/store/updated", "must be an ISO-8601 timestamp");
  }
  if (!Array.isArray(d.apps)) {
    e.err("/apps", "apps array is required");
    return e.result();
  }
  const icons = iconsFor(opts.icons);
  const ids = new Set<string>();
  d.apps.forEach((a, i) => {
    const p = `/apps/${i}`;
    if (!isObj(a)) return e.err(p, "must be an app entry");
    if (checkId(a.id, `${p}/id`, e, APP_ID_RE)) {
      if (ids.has(a.id as string)) e.err(`${p}/id`, `duplicate app id '${a.id}'`);
      ids.add(a.id as string);
    }
    if (!isStr(a.name) || a.name === "") e.err(`${p}/name`, "is required");
    else if ([...a.name].length > LIMITS.NAME_CHARS) e.err(`${p}/name`, `at most ${LIMITS.NAME_CHARS} characters`);
    if (!isStr(a.tagline)) e.err(`${p}/tagline`, "is required");
    else if ([...a.tagline].length > LIMITS.TAGLINE_CHARS) e.err(`${p}/tagline`, `at most ${LIMITS.TAGLINE_CHARS} characters`);
    if (!isStr(a.icon) || a.icon === "") e.err(`${p}/icon`, "is required");
    else if (/^(https?:\/\/|\/)/.test(a.icon)) {
      if (!classifyUrl(a.icon)) e.err(`${p}/icon`, "must be an icon name or a PNG URL");
    } else if (!ICON_NAME_RE.test(a.icon)) e.err(`${p}/icon`, "must be an icon name or a PNG URL");
    else if (icons && !icons.has(a.icon)) e.err(`${p}/icon`, unknownIcon(a.icon));
    checkVersion(a.version, `${p}/version`, e);
    checkVersion(a.min_os, `${p}/min_os`, e);
    if (!isStr(a.manifest) || classifyUrl(a.manifest)?.kind !== "absolute") e.err(`${p}/manifest`, "must be an absolute URL");
    if (a.screens !== undefined) {
      if (!Array.isArray(a.screens)) e.err(`${p}/screens`, "must be an array");
      else a.screens.forEach((s, j) => { if (!isStr(s) || !SCREEN_SIZE_RE.test(s)) e.err(`${p}/screens/${j}`, "must look like 540x960"); });
    }
    if (a.categories !== undefined && (!Array.isArray(a.categories) || !a.categories.every(isStr))) e.err(`${p}/categories`, "must be an array of strings");
    if (a.author !== undefined && !isStr(a.author)) e.err(`${p}/author`, "must be a string");
    checkEnum(a.kind, `${p}/kind`, e, ["hosted", "external"]);
    checkEnum(a.visibility, `${p}/visibility`, e, ["public", "unlisted", "private"]);
    checkInt(a.installs, `${p}/installs`, e, 0);
  });
  return e.result();
}

// ---------------------------------------------------------------------------------------------
// Bundle

export interface BundleOptions {
  icons?: Iterable<string>;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  hasAlpha: boolean;
}

/** Reads the IHDR of a PNG and notes whether a tRNS chunk (alpha) is present. */
export function pngInfo(bytes: Uint8Array): PngInfo | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return undefined;
  const info: PngInfo = {
    width: dv.getUint32(16),
    height: dv.getUint32(20),
    bitDepth: bytes[24]!,
    colorType: bytes[25]!,
    hasAlpha: false,
  };
  if (info.colorType === 4 || info.colorType === 6) info.hasAlpha = true;
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = dv.getUint32(off + 4);
    if (type === 0x74524e53) info.hasAlpha = true; // tRNS
    if (type === 0x49454e44) break; // IEND
    off += 12 + len;
  }
  return info;
}

/** Normalises a bundle file name; returns undefined for names that are not plain relative paths. */
function normalizeName(name: string): string | undefined {
  let n = name.replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  if (n === "" || n.startsWith("/") || n.endsWith("/")) return undefined;
  const parts = n.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return undefined;
  return n;
}

/** Directory prefix under which a hosted bundle expects to be served, from its `entry`. */
export function bundleMount(manifest: { entry?: unknown }): string | undefined {
  if (!isStr(manifest.entry)) return undefined;
  const info = classifyUrl(manifest.entry);
  if (!info || info.kind !== "relative") return undefined;
  const p = info.path!;
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

/** Collects every origin-relative URL in a document with its JSON pointer. */
function collectRelativeUrls(doc: unknown): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = [];
  const URL_KEYS = new Set(["url", "entry", "event", "icon", "src", "then_url", "manifest"]);
  const walk = (v: unknown, p: string, key: string | undefined): void => {
    if (isStr(v)) {
      if (key !== undefined && URL_KEYS.has(key) && classifyUrl(v)?.kind === "relative") out.push({ path: p, url: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`, key === "hosts" ? "hosts" : undefined));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${p}/${escapePtr(k)}`, k);
  };
  walk(doc, "", undefined);
  return out;
}

/**
 * Validates an extracted bundle: `manifest.json` at the root, every screen (`*.json` with a
 * `widgets` array), every PNG, and that origin-relative URLs resolve to files under the mount
 * implied by `entry` (see spec/NOTES-sdk.md, "Bundles").
 */
export function validateBundle(files: Map<string, Uint8Array>, opts: BundleOptions = {}): ValidationResult {
  const e = new Errors();
  const norm = new Map<string, Uint8Array>();
  let total = 0;
  for (const [name, bytes] of files) {
    if (name.endsWith("/")) continue;
    const n = normalizeName(name);
    if (n === undefined) {
      e.err(name, "file names must be plain relative paths");
      continue;
    }
    if (norm.has(n)) e.err(name, "duplicate file");
    norm.set(n, bytes);
    total += bytes.byteLength;
  }
  if (total > LIMITS.BUNDLE_BYTES) e.err("", `bundle is ${total} bytes; the limit is ${LIMITS.BUNDLE_BYTES}`);

  const manifestBytes = norm.get("manifest.json");
  if (!manifestBytes) {
    e.err("manifest.json", "bundle must contain manifest.json at its root");
    return e.result();
  }
  const mr = validateManifest(manifestBytes, { icons: opts.icons });
  for (const err of mr.errors) e.err(`manifest.json#${err.path}`, err.message);
  let manifest: Manifest | undefined;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  } catch {
    return e.result();
  }
  if (!isObj(manifest)) return e.result();

  const mount = bundleMount(manifest);
  if (mount === undefined) {
    if (isStr(manifest.entry) && !hasTemplate(manifest.entry)) e.err("manifest.json#/entry", "a hosted bundle's entry must be origin-relative (/…)");
  }
  const resolve = (url: string): string | undefined => {
    if (mount === undefined) return undefined;
    const path = classifyUrl(url)?.path;
    if (path === undefined) return undefined;
    const prefix = `${mount}/`;
    if (!path.startsWith(prefix)) return undefined;
    return path.slice(prefix.length);
  };
  const checkRefs = (doc: unknown, file: string): void => {
    for (const { path, url } of collectRelativeUrls(doc)) {
      const target = resolve(url);
      if (target === undefined) e.err(`${file}#${path}`, `${url} is outside the bundle mount ${mount ?? "(unknown)"}/`);
      else if (!norm.has(target)) e.err(`${file}#${path}`, `${url} does not exist in the bundle (expected file ${target})`);
    }
  };
  checkRefs(manifest, "manifest.json");

  // screens and other JSON
  for (const [name, bytes] of norm) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    let text: string;
    let doc: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      doc = JSON.parse(text);
    } catch (err) {
      e.err(name, `invalid JSON: ${(err as Error).message}`);
      continue;
    }
    if (name === "store.json") {
      if (!isObj(doc)) e.err(name, "must be an object");
      else if (doc.tagline !== undefined && (!isStr(doc.tagline) || [...doc.tagline].length > LIMITS.TAGLINE_CHARS)) e.err(`${name}#/tagline`, `at most ${LIMITS.TAGLINE_CHARS} characters`);
      continue;
    }
    if (!isObj(doc) || !Array.isArray(doc.widgets)) continue; // data fixture, not a screen
    const r = validateScreen(doc, { manifest, icons: opts.icons, bytes: bytes.byteLength });
    for (const err of r.errors) e.err(`${name}#${err.path}`, err.message);
    checkRefs(doc, name);
  }

  // images
  const iconTarget = isStr(manifest.icon) && classifyUrl(manifest.icon)?.kind === "relative" ? resolve(manifest.icon) : undefined;
  for (const [name, bytes] of norm) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const info = pngInfo(bytes);
    if (!info) {
      e.err(name, "not a PNG file");
      continue;
    }
    if (bytes.byteLength > LIMITS.IMAGE_BYTES) e.err(name, `PNG is ${bytes.byteLength} bytes; the limit is ${LIMITS.IMAGE_BYTES}`);
    const grey8 = info.colorType === 0 && info.bitDepth === 8;
    const palette = info.colorType === 3 && (info.bitDepth === 4 || info.bitDepth === 8);
    if (!grey8 && !palette) e.err(name, `PNG must be 8-bit greyscale or 4/8-bit palette (got colour type ${info.colorType}, depth ${info.bitDepth})`);
    if (info.hasAlpha) e.err(name, "PNG must not have alpha");
    if ((name === iconTarget || name === "icon.png") && (info.width !== LIMITS.ICON_PX || info.height !== LIMITS.ICON_PX)) {
      e.err(name, `icon must be ${LIMITS.ICON_PX}×${LIMITS.ICON_PX} (got ${info.width}×${info.height})`);
    }
  }
  return e.result();
}

/**
 * Rewrites every origin-relative URL under `fromMount` to `toMount` in the bundle's JSON files
 * (what a store does when it serves a bundle at `/a/<id>/<version>/`). Returns a new map.
 */
export function rebaseBundle(files: Map<string, Uint8Array>, fromMount: string, toMount: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const from = `${fromMount.replace(/\/$/, "")}/`;
  const to = `${toMount.replace(/\/$/, "")}/`;
  const dec = new TextDecoder();
  const rewrite = (v: unknown): unknown => {
    if (isStr(v)) return classifyUrl(v)?.kind === "relative" && v.startsWith(from) ? to + v.slice(from.length) : v;
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
        out.set(name, enc.encode(JSON.stringify(rewrite(JSON.parse(dec.decode(bytes))))));
        continue;
      } catch {
        /* leave as is */
      }
    }
    out.set(name, bytes);
  }
  return out;
}
