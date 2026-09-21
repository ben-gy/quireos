// Device bearer tokens (spec §9). Tokens are random; D1 stores only SHA-256 hashes.
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getDeviceByTokenHash, touchDevice } from "./db";
import type { Ctx, Env } from "./env";
import { sha256Hex } from "./util";

export function apiError(c: Ctx, status: ContentfulStatusCode, code: string, message: string): Response {
  return c.json({ spec_version: 1, error: { code, message } }, status);
}

/**
 * Reads `Authorization: Bearer <token>`. With `required`, a missing token is a
 * 401; in both modes a malformed or unknown token is a 401 so a device learns
 * it must re-register rather than silently seeing the anonymous index.
 */
export function deviceAuth(required: boolean): MiddlewareHandler<Env> {
  return async (c, next) => {
    const h = c.req.header("Authorization");
    if (!h) {
      if (required) return apiError(c, 401, "unauthorized", "Device token required");
      c.set("device", null);
      await next();
      return;
    }
    const m = /^Bearer\s+([A-Za-z0-9_-]{43})$/.exec(h.trim());
    if (!m) return apiError(c, 401, "unauthorized", "Malformed device token");
    const device = await getDeviceByTokenHash(c.env.DB, await sha256Hex(m[1]!));
    if (!device) return apiError(c, 401, "unauthorized", "Unknown device token; register again");
    c.set("device", device);
    // Keep last_seen fresh without a write on every poll.
    const last = device.last_seen ? Date.parse(device.last_seen) : 0;
    if (Date.now() - last > 60_000) {
      await touchDevice(c.env.DB, device.id, c.req.header("X-OS-Version") ?? null, c.req.header("X-Screen")?.split("x").slice(0, 2).join("x") ?? null);
    }
    await next();
  };
}
