/** Thin typed builders for §7 actions and §3 bindings. */
import type {
  BackAction,
  Body,
  Cond,
  HomeAction,
  HttpAction,
  HttpMethod,
  NavigateAction,
  RefreshAction,
  SetAction,
  SubmitAction,
  Then,
  Tpl,
  Value,
} from "./types.js";

export function navigate(url: Tpl, opts: { replace?: boolean } = {}): NavigateAction {
  const a: NavigateAction = { type: "navigate", url };
  if (opts.replace) a.replace = true;
  return a;
}

export function submit(
  event: string,
  opts: { args?: Record<string, Value>; set?: Record<string, Value>; then?: Then; then_url?: Tpl; after?: number } = {},
): SubmitAction {
  return prune({ type: "submit", event, ...opts }) as SubmitAction;
}

export function http(
  url: Tpl,
  opts: {
    method?: HttpMethod;
    headers?: Record<string, Tpl>;
    body?: Body;
    body_raw?: boolean;
    set?: Record<string, Value>;
    then?: Then;
    then_url?: Tpl;
    after?: number;
  } = {},
): HttpAction {
  return prune({ type: "http", url, ...opts }) as HttpAction;
}

export function set(vars: Record<string, Value>, opts: { then?: Then; then_url?: Tpl; after?: number } = {}): SetAction {
  return prune({ type: "set", vars, ...opts }) as SetAction;
}

export function refresh(): RefreshAction {
  return { type: "refresh" };
}
export function back(): BackAction {
  return { type: "back" };
}
export function home(): HomeAction {
  return { type: "home" };
}

/** `bind("e0.state", "upper")` → `"{{e0.state | upper}}"`. */
export function bind(path: string, ...filters: string[]): string {
  return `{{${[path, ...filters].join(" | ")}}}`;
}

/** Filter helpers for `bind`. */
export const f = {
  fixed: (n: number) => `fixed:${n}`,
  default: (v: string | number) => (typeof v === "number" ? `default:${v}` : `default:'${v.replace(/'/g, "")}'`),
  time: (fmt: string) => `time:'${fmt.replace(/'/g, "")}'`,
  upper: "upper",
  lower: "lower",
} as const;

/** `cond("vars.pool == on", 0, 15)` → `{ if, then, else }`. */
export function cond<T extends string | number | boolean | null>(
  test: string,
  then: Value<T>,
  otherwise?: Value<T>,
): Cond<T> {
  const c: Cond<T> = { if: test, then };
  if (otherwise !== undefined) c.else = otherwise;
  return c;
}

/** Drops `undefined` members so builders emit compact documents. */
export function prune<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
