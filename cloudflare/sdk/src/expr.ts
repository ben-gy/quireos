/**
 * Reference evaluator for §3 of the spec: templates (`{{ expr }}`), conditions and conditional
 * values. The firmware must produce byte-identical output; `spec/conformance/expr.json` pins it.
 * Decisions on points the spec leaves open are listed in spec/NOTES-sdk.md.
 */
import type { Cond, Scalar, Value } from "./types.js";

/** Template variables available at evaluation time. */
export interface DeviceVars {
  time: number;
  tz: string;
  battery: number;
  charging: boolean;
  /** Wi-Fi signal in dBm; `-100` when offline. */
  rssi: number;
  name: string;
  online: boolean;
  w: number;
  h: number;
  greys: number;
  dpi: number;
}

export interface EvalContext {
  settings?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  device?: Partial<DeviceVars> & Record<string, unknown>;
  /** Data-source responses keyed by data id. */
  data?: Record<string, unknown>;
}

export const RESERVED_ROOTS = ["settings", "vars", "device"] as const;
export const DEVICE_FIELDS = [
  "time", "tz", "battery", "charging", "rssi", "name", "online", "w", "h", "greys", "dpi",
] as const;
export const FILTER_NAMES = ["fixed", "default", "upper", "lower", "time"] as const;
export const COMPARISON_OPS = ["==", "!=", "<=", ">=", "<", ">"] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

export interface Filter {
  name: string;
  /** Raw literal text after `:`; absent for argument-less filters. */
  arg?: string;
  /** True when the argument was single-quoted. */
  quoted?: boolean;
}

export interface Expr {
  path: string[];
  filters: Filter[];
}

export interface ParsedCond {
  expr: Expr;
  op?: ComparisonOp;
  /** Comparison literal, unquoted. */
  literal?: string;
}

export type Token =
  | { type: "text"; value: string }
  | { type: "expr"; raw: string; expr: Expr | null; error?: string };

export class ExprError extends Error {}

// ---------------------------------------------------------------------------------------------
// Scanner

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*/;
const INDEX_RE = /^[0-9]+/;
const BARE_RE = /^[^\s|'{}]+/;
/** Strict numeric literal (both sides of a comparison; `fixed`; `time` epoch). */
export const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}
  ws(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }
  peek(): string {
    return this.src[this.pos] ?? "";
  }
  rest(): string {
    return this.src.slice(this.pos);
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  match(re: RegExp): string | null {
    const m = re.exec(this.rest());
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }
  expect(ch: string): void {
    if (this.peek() !== ch) throw new ExprError(`expected '${ch}' at ${this.pos} in "${this.src}"`);
    this.pos++;
  }
}

/** Reads `'quoted'` or a bare word. Returns the literal text and whether it was quoted. */
function scanLiteral(s: Scanner): { text: string; quoted: boolean } {
  s.ws();
  if (s.peek() === "'") {
    s.pos++;
    const end = s.src.indexOf("'", s.pos);
    if (end < 0) throw new ExprError(`unterminated quote in "${s.src}"`);
    const text = s.src.slice(s.pos, end);
    s.pos = end + 1;
    return { text, quoted: true };
  }
  const bare = s.match(BARE_RE);
  if (bare === null) throw new ExprError(`expected literal at ${s.pos} in "${s.src}"`);
  return { text: bare, quoted: false };
}

function scanPath(s: Scanner): string[] {
  s.ws();
  const root = s.match(IDENT_RE);
  if (root === null) throw new ExprError(`expected path at ${s.pos} in "${s.src}"`);
  const path = [root];
  while (s.peek() === ".") {
    s.pos++;
    const seg = s.match(IDENT_RE) ?? s.match(INDEX_RE);
    if (seg === null) throw new ExprError(`expected path segment at ${s.pos} in "${s.src}"`);
    path.push(seg);
  }
  return path;
}

function scanExpr(s: Scanner): Expr {
  const path = scanPath(s);
  const filters: Filter[] = [];
  s.ws();
  while (s.peek() === "|") {
    s.pos++;
    s.ws();
    const name = s.match(/^[a-z]+/);
    if (name === null) throw new ExprError(`expected filter name at ${s.pos} in "${s.src}"`);
    s.ws();
    if (s.peek() === ":") {
      s.pos++;
      const lit = scanLiteral(s);
      filters.push({ name, arg: lit.text, quoted: lit.quoted });
    } else {
      filters.push({ name });
    }
    s.ws();
  }
  return { path, filters };
}

/** Parses the inside of `{{ … }}`. Throws `ExprError` on malformed input. */
export function parseExpr(src: string): Expr {
  const s = new Scanner(src);
  const expr = scanExpr(s);
  s.ws();
  if (!s.eof()) throw new ExprError(`unexpected '${s.peek()}' at ${s.pos} in "${src}"`);
  return expr;
}

/** Finds the first comparison operator outside single quotes. */
function findOp(src: string): { index: number; op: ComparisonOp } | null {
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const two = src.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") return { index: i, op: two };
    if (c === "<" || c === ">") return { index: i, op: c };
  }
  return null;
}

/** Parses a condition (`expr (op literal)?`). Throws `ExprError` on malformed input. */
export function parseCond(src: string): ParsedCond {
  const found = findOp(src);
  if (!found) return { expr: parseExpr(src) };
  const expr = parseExpr(src.slice(0, found.index));
  const s = new Scanner(src.slice(found.index + found.op.length));
  const lit = scanLiteral(s);
  s.ws();
  if (!s.eof()) throw new ExprError(`unexpected '${s.peek()}' after literal in "${src}"`);
  return { expr, op: found.op, literal: lit.text };
}

/** Splits a template into literal text and `{{ expr }}` tokens. Malformed expressions are kept as tokens with `expr: null`. */
export function tokenize(template: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let text = "";
  while (i < template.length) {
    const open = template.indexOf("{{", i);
    if (open < 0) {
      text += template.slice(i);
      break;
    }
    text += template.slice(i, open);
    // find the closing }} outside single quotes
    let j = open + 2;
    let quoted = false;
    let close = -1;
    while (j < template.length) {
      const c = template[j]!;
      if (c === "'") quoted = !quoted;
      else if (!quoted && c === "}" && template[j + 1] === "}") {
        close = j;
        break;
      }
      j++;
    }
    if (close < 0) {
      text += template.slice(open);
      break;
    }
    if (text) out.push({ type: "text", value: text });
    text = "";
    const raw = template.slice(open + 2, close);
    try {
      out.push({ type: "expr", raw, expr: parseExpr(raw) });
    } catch (e) {
      out.push({ type: "expr", raw, expr: null, error: (e as Error).message });
    }
    i = close + 2;
  }
  if (text) out.push({ type: "text", value: text });
  return out;
}

/** True when the string contains at least one `{{`. */
export function hasTemplate(s: string): boolean {
  return s.includes("{{");
}

// ---------------------------------------------------------------------------------------------
// Values

/** Renders a resolved value the way the device does: shortest numbers, `true`/`false`, `""` for null/objects. */
export function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v === 0 ? 0 : v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return "";
}

/** Strict number parse used by comparisons and `fixed`; `undefined` when not a number. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && NUMBER_RE.test(v)) return Number(v);
  return undefined;
}

/** §3 truthiness: `null`, `""`, `"0"`, `"false"`, `"off"`, `0`, `false` are falsy. */
export function truthy(v: unknown): boolean {
  const s = stringify(v);
  return !(s === "" || s === "0" || s === "false" || s === "off");
}

function lookup(path: string[], ctx: EvalContext): unknown {
  const root = path[0]!;
  let cur: unknown;
  if (root === "settings") cur = ctx.settings;
  else if (root === "vars") cur = ctx.vars;
  else if (root === "device") cur = ctx.device;
  else cur = ctx.data ? ctx.data[root] : undefined;
  for (let i = 1; i < path.length; i++) {
    if (cur === null || typeof cur !== "object") return undefined;
    const seg = path[i]!;
    if (Array.isArray(cur)) {
      if (!INDEX_RE.test(seg) || INDEX_RE.exec(seg)![0] !== seg) return undefined;
      cur = cur[Number(seg)];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

const asciiUpper = (s: string) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());
const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

function applyFilter(v: unknown, f: Filter, ctx: EvalContext): unknown {
  switch (f.name) {
    case "fixed": {
      const n = toNumber(v);
      if (n === undefined) return v;
      const digits = Math.max(0, Math.min(10, Math.trunc(toNumber(f.arg ?? "") ?? 0)));
      return n.toFixed(digits);
    }
    case "default":
      return stringify(v) === "" ? (f.arg ?? "") : v;
    case "upper":
      return asciiUpper(stringify(v));
    case "lower":
      return asciiLower(stringify(v));
    case "time": {
      const ms = parseTime(v, tzOf(ctx));
      if (ms === undefined) return v;
      return formatTime(ms, f.arg ?? "", tzOf(ctx));
    }
    default:
      throw new ExprError(`unknown filter '${f.name}'`);
  }
}

function tzOf(ctx: EvalContext): string {
  const tz = ctx.device?.tz;
  return typeof tz === "string" && tz ? tz : "UTC";
}

/** Evaluates a parsed expression to its rendered string. Unknown filters yield `""`. */
export function evalExpr(expr: Expr, ctx: EvalContext): string {
  let v = lookup(expr.path, ctx);
  if (v !== null && typeof v === "object") v = "";
  try {
    for (const f of expr.filters) v = applyFilter(v, f, ctx);
  } catch {
    return "";
  }
  return stringify(v);
}

/** Substitutes every `{{ expr }}` in `template`. Malformed expressions render as `""`. */
export function evaluate(template: string, ctx: EvalContext): string {
  if (!template.includes("{{")) return template;
  let out = "";
  for (const t of tokenize(template)) {
    if (t.type === "text") out += t.value;
    else if (t.expr) out += evalExpr(t.expr, ctx);
  }
  return out;
}

/** Evaluates a §3 condition to a boolean. Malformed conditions are falsy; a missing condition is truthy. */
export function evaluateCond(cond: string | boolean | null | undefined, ctx: EvalContext): boolean {
  if (cond === undefined || cond === null) return true;
  if (typeof cond === "boolean") return cond;
  let parsed: ParsedCond;
  try {
    parsed = parseCond(cond);
  } catch {
    return false;
  }
  const lhs = evalExpr(parsed.expr, ctx);
  if (!parsed.op) return truthy(lhs);
  const rhs = parsed.literal ?? "";
  const ln = toNumber(lhs);
  const rn = toNumber(rhs);
  if (ln !== undefined && rn !== undefined) return compare(ln, rn, parsed.op);
  return compare(lhs, rhs, parsed.op);
}

function compare<T extends number | string>(a: T, b: T, op: ComparisonOp): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
  }
}

/** True for a `{ if, then }` conditional value object. */
export function isCond(v: unknown): v is Cond<Scalar> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as Cond).if === "string" &&
    "then" in (v as object)
  );
}

export const MAX_COND_DEPTH = 3;

/**
 * Resolves a property value: scalars pass through, templates are substituted, conditionals are
 * evaluated (depth ≤ 3; deeper levels resolve to `null`, as does a missing `else`).
 */
export function resolveValue<T extends Scalar>(value: Value<T> | undefined, ctx: EvalContext, depth = 0): Scalar {
  if (value === undefined) return null;
  if (typeof value === "string") return evaluate(value, ctx);
  if (isCond(value)) {
    if (depth >= MAX_COND_DEPTH) return null;
    const branch = evaluateCond(value.if, ctx) ? value.then : value.else;
    return resolveValue(branch as Value<T> | undefined, ctx, depth + 1);
  }
  return value as Scalar;
}

/** Resolves templates and conditionals anywhere inside an object or array (headers, bodies, args). */
export function resolveDeep(value: unknown, ctx: EvalContext): unknown {
  if (typeof value === "string") return evaluate(value, ctx);
  if (value === null || typeof value !== "object") return value;
  if (isCond(value)) return resolveValue(value, ctx);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveDeep(v, ctx);
  return out;
}

/** All `path` roots referenced by a template or condition (for static validation). */
export function referencedPaths(src: string, cond = false): string[][] {
  const paths: string[][] = [];
  if (cond) {
    try {
      paths.push(parseCond(src).expr.path);
    } catch {
      /* reported by the validator separately */
    }
    return paths;
  }
  for (const t of tokenize(src)) if (t.type === "expr" && t.expr) paths.push(t.expr.path);
  return paths;
}

// ---------------------------------------------------------------------------------------------
// time: filter

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface Wall {
  y: number;
  M: number;
  d: number;
  H: number;
  m: number;
  s: number;
}

function wallClock(ms: number, tz: string): Wall {
  const parts = dtf(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const H = get("hour");
  return { y: get("year"), M: get("month"), d: get("day"), H: H === 24 ? 0 : H, m: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC in ms at instant `ms`. */
function tzOffset(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  return Date.UTC(w.y, w.M - 1, w.d, w.H, w.m, w.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Parses an epoch in seconds (number or numeric string) or an ISO-8601 string to epoch ms.
 * An ISO string without a zone designator is interpreted in `tz`.
 */
export function parseTime(v: unknown, tz: string): number | undefined {
  const n = toNumber(v);
  if (n !== undefined) return Math.floor(n) * 1000;
  if (typeof v !== "string") return undefined;
  const m = ISO_RE.exec(v.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const M = Number(m[2]);
  const d = Number(m[3]);
  const H = Number(m[4] ?? "0");
  const mi = Number(m[5] ?? "0");
  const s = Number(m[6] ?? "0");
  if (M < 1 || M > 12 || d < 1 || d > 31 || H > 23 || mi > 59 || s > 60) return undefined;
  const wall = Date.UTC(y, M - 1, d, H, mi, s);
  const zone = m[8];
  if (zone === "Z") return wall;
  if (zone) {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4) || "0");
    return wall - sign * (oh * 60 + om) * 60_000;
  }
  // No zone: interpret as local time in tz. Two passes handle DST transitions.
  let t = wall - tzOffset(wall, tz);
  const o2 = tzOffset(t, tz);
  if (wall - o2 !== t) t = wall - o2;
  return t;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_TOKENS = ["MMMM", "MMM", "MM", "M", "EEEE", "EEE", "yyyy", "HH", "H", "hh", "h", "mm", "ss", "dd", "d", "a"];

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Formats epoch ms with the §3 `time:` tokens in `tz`. Unknown characters are copied. */
export function formatTime(ms: number, fmt: string, tz: string): string {
  const w = wallClock(ms, tz);
  const weekday = new Date(Date.UTC(w.y, w.M - 1, w.d)).getUTCDay();
  const h12 = w.H % 12 === 0 ? 12 : w.H % 12;
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const tok = TIME_TOKENS.find((t) => fmt.startsWith(t, i));
    if (!tok) {
      out += fmt[i];
      i++;
      continue;
    }
    i += tok.length;
    switch (tok) {
      case "HH": out += pad2(w.H); break;
      case "H": out += String(w.H); break;
      case "hh": out += pad2(h12); break;
      case "h": out += String(h12); break;
      case "mm": out += pad2(w.m); break;
      case "ss": out += pad2(w.s); break;
      case "a": out += w.H < 12 ? "am" : "pm"; break;
      case "d": out += String(w.d); break;
      case "dd": out += pad2(w.d); break;
      case "M": out += String(w.M); break;
      case "MM": out += pad2(w.M); break;
      case "MMM": out += MONTHS[w.M - 1]!.slice(0, 3); break;
      case "MMMM": out += MONTHS[w.M - 1]!; break;
      case "yyyy": out += String(w.y).padStart(4, "0"); break;
      case "EEE": out += DAYS[weekday]!.slice(0, 3); break;
      case "EEEE": out += DAYS[weekday]!; break;
    }
  }
  return out;
}
