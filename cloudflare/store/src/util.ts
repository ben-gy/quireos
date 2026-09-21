// Small helpers shared by the API, auth and pages. No secrets are ever logged.

const enc = new TextEncoder();

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 32 random bytes, base64url (43 chars). Used for device tokens and session cookies. */
export function randomToken(): string {
  return b64url(randomBytes(32));
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += b.toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- versions -------------------------------------------------------------

export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isVersion(s: unknown): s is string {
  return typeof s === "string" && VERSION_RE.test(s);
}

/** Numeric MAJOR.MINOR.PATCH comparison: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---- identifiers ----------------------------------------------------------

/** Spec §1: identifiers; app ids (slugs) additionally may not contain `_`. */
export const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const HW_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
export const SCREEN_RE = /^\d{2,4}x\d{2,4}$/;

export function parseJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Comma/newline separated list → trimmed, de-duplicated, lower-case slugs. */
export function parseCategories(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const c = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (c && /^[a-z0-9][a-z0-9-]{0,23}$/.test(c) && !out.includes(c)) out.push(c);
    if (out.length >= 8) break;
  }
  return out;
}

export function parseUrlList(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/\s+/)) {
    const u = raw.trim();
    if (!u) continue;
    try {
      const p = new URL(u);
      if (p.protocol === "https:" || p.protocol === "http:") out.push(p.toString());
    } catch {
      /* skip */
    }
    if (out.length >= 8) break;
  }
  return out;
}

// ---- HTTP -----------------------------------------------------------------

/** True when the request's If-None-Match matches a strong ETag. */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  const want = strip(etag);
  return ifNoneMatch.split(",").some((t) => strip(t) === want);
}

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "json":
      return "application/json; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "txt":
    case "md":
      return "text/plain; charset=utf-8";
    case "html":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

/** PNG signature check. */
export function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= 8 && sig.every((b, i) => bytes[i] === b);
}

export function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // IHDR is always the first chunk: length(4) type(4) width(4) height(4)
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
