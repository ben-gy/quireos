/** §8.1 responses: canonical JSON with strong ETags, `304` handling, PNGs and error bodies. */
import type { ErrorBody } from "./types.js";

/** Serialises with sorted object keys and no whitespace, so equal documents hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

const enc = new TextEncoder();

/** Strong ETag: `"` + first 32 hex chars of SHA-256 + `"`. */
export async function etag(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex.slice(0, 32)}"`;
}

/** True when the request's `If-None-Match` names `tag` (weak comparison; `*` matches anything). */
export function matchesEtag(req: Request | { headers: Headers } | string | null | undefined, tag: string): boolean {
  const header = typeof req === "string" ? req : req?.headers.get("If-None-Match");
  if (!header) return false;
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  const want = strip(tag);
  return header.split(",").some((part) => {
    const p = strip(part);
    return p === "*" || p === want;
  });
}

function mergeHeaders(base: Record<string, string>, init?: ResponseInit): Headers {
  const h = new Headers(base);
  if (init?.headers) new Headers(init.headers).forEach((v, k) => h.set(k, v));
  return h;
}

/** `304 Not Modified` carrying the ETag. */
export function notModified(tag: string, init?: ResponseInit): Response {
  return new Response(null, { status: 304, headers: mergeHeaders({ ETag: tag, "Cache-Control": "no-store" }, init) });
}

/**
 * JSON response with canonical body, strong ETag and `Cache-Control: no-store`.
 * Answers `304` when the request's `If-None-Match` matches.
 */
export async function json(doc: unknown, req?: Request | null, init?: ResponseInit): Promise<Response> {
  const body = canonicalJson(doc);
  const tag = await etag(body);
  if (req && matchesEtag(req, tag)) return notModified(tag, init);
  return new Response(body, {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: mergeHeaders({ "Content-Type": "application/json; charset=utf-8", ETag: tag, "Cache-Control": "no-store" }, init),
  });
}

/**
 * PNG response with an ETag derived from `seed` when given (so callers can answer `304` before
 * rendering: `etag(seed)` + `matchesEtag`), otherwise from the bytes.
 */
export async function png(bytes: Uint8Array, req?: Request | null, seed?: string, init?: ResponseInit): Promise<Response> {
  const tag = await etag(seed !== undefined ? seed : bytes);
  if (req && matchesEtag(req, tag)) return notModified(tag, init);
  return new Response(bytes as BodyInit, {
    status: init?.status ?? 200,
    headers: mergeHeaders(
      { "Content-Type": "image/png", ETag: tag, "Cache-Control": "no-store", "Content-Length": String(bytes.byteLength) },
      init,
    ),
  });
}

/** §8.2 error response. `message` is truncated to 120 characters. */
export function error(code: string, message: string, status = 400, init?: ResponseInit): Response {
  const body: ErrorBody = { spec_version: 1, error: { code, message: [...message].slice(0, 120).join("") } };
  return new Response(JSON.stringify(body), {
    status,
    headers: mergeHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, init),
  });
}

/** Throw from a screen or event handler to answer with a §8.2 error body. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}
