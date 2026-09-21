/** §2 device headers. */
import type { DeviceContext } from "./types.js";
import type { DeviceVars } from "./expr.js";

export const DEFAULT_SCREEN = { w: 540, h: 960, greys: 16, dpi: 235 } as const;

/** Parses `X-Screen` (`540x960x16@235`). Returns the default profile on malformed input. */
export function parseScreen(value: string | null | undefined): { w: number; h: number; greys: number; dpi: number } {
  const m = /^\s*(\d+)x(\d+)(?:x(\d+))?(?:@(\d+))?\s*$/.exec(value ?? "");
  if (!m) return { ...DEFAULT_SCREEN };
  return {
    w: Number(m[1]),
    h: Number(m[2]),
    greys: m[3] ? Number(m[3]) : DEFAULT_SCREEN.greys,
    dpi: m[4] ? Number(m[4]) : DEFAULT_SCREEN.dpi,
  };
}

/** Parses `X-App-Settings` (URL-encoded JSON). Malformed input yields `{}`. */
export function parseSettings(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const decoded = decodeURIComponent(value);
    const obj: unknown = JSON.parse(decoded);
    return obj !== null && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Builds a `DeviceContext` from a request's headers. Works for non-device requests too (browsers get defaults). */
export function parseDevice(req: Request): DeviceContext {
  const h = req.headers;
  const get = (name: string) => h.get(name) ?? undefined;
  const id = get("X-Device-Id") ?? "";
  return {
    id,
    osVersion: get("X-OS-Version") ?? "",
    specVersion: Number(get("X-Spec-Version") ?? "1") || 1,
    screen: parseScreen(get("X-Screen")),
    tz: get("X-Timezone") ?? "UTC",
    locale: get("X-Locale") ?? "en",
    installId: get("X-Install-Id"),
    appId: get("X-App-Id"),
    appVersion: get("X-App-Version"),
    settings: parseSettings(get("X-App-Settings")),
    userAgent: get("User-Agent") ?? "",
    ifNoneMatch: get("If-None-Match"),
    isDevice: id !== "" || (get("User-Agent") ?? "").startsWith("QuireOS/"),
  };
}

/** The `device.*` template variables a server can know from the headers (for server-side `evaluate`). */
export function deviceVars(ctx: DeviceContext, now: Date = new Date()): Partial<DeviceVars> {
  return {
    time: Math.floor(now.getTime() / 1000),
    tz: ctx.tz,
    w: ctx.screen.w,
    h: ctx.screen.h,
    greys: ctx.screen.greys,
    dpi: ctx.screen.dpi,
  };
}
