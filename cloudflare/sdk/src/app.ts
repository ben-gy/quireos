/**
 * `createApp` wires a manifest, screen handlers, an event handler and image renderers into a
 * Cloudflare Workers `ExportedHandler` with the routes an app needs:
 * `GET /manifest.json`, `GET /screens/:id.json`, `POST /event`, `GET /img/:name.png`.
 */
import { parseDevice } from "./request.js";
import { AppError, error, json, png } from "./response.js";
import { ICON_NAMES } from "./profiles/icons.generated.js";
import { validateScreen } from "./validate.js";
import { SPEC_VERSION } from "./types.js";
import type { DeviceContext, Manifest, Screen, SubmitEvent } from "./types.js";

export interface AppContext<Env = unknown> {
  device: DeviceContext;
  request: Request;
  env: Env;
  /** `ExecutionContext` when running on Workers. */
  ec?: ExecutionContext;
  manifest: Manifest;
}

export type ScreenHandler<Env = unknown> = (ctx: AppContext<Env>, url: URL) => Screen | Promise<Screen>;

/** Return a screen (`200`), `null`/`undefined` (`204`) or a `Response`. */
export type EventHandler<Env = unknown> = (
  event: SubmitEvent,
  ctx: AppContext<Env>,
) => Screen | Response | null | undefined | void | Promise<Screen | Response | null | undefined | void>;

/** Return PNG bytes, `{ bytes, seed }` (seed drives the ETag) or a `Response`. */
export type ImageHandler<Env = unknown> = (
  ctx: AppContext<Env>,
  url: URL,
) => Uint8Array | { bytes: Uint8Array; seed?: string } | Response | Promise<Uint8Array | { bytes: Uint8Array; seed?: string } | Response>;

export interface AppOptions<Env = unknown> {
  manifest: Manifest;
  screens: Record<string, ScreenHandler<Env>>;
  onEvent?: EventHandler<Env>;
  images?: Record<string, ImageHandler<Env>>;
  /** Force validation of every screen (default: `env.DEV === "1"` or `import.meta.env.DEV`). */
  validate?: boolean;
  /**
   * Icon names the target firmware compiles. Defaults to the reference build's set, so a name the
   * device cannot draw fails in dev instead of silently drawing nothing on glass. Pass a wider list
   * for a board that compiles more, or `[]` to skip the check.
   */
  icons?: readonly string[];
  /** Extra routes: return a `Response` to handle, `undefined` to fall through to 404. */
  fallback?: (req: Request, ctx: AppContext<Env>) => Response | undefined | Promise<Response | undefined>;
}

type Handler<Env> = { fetch(request: Request, env: Env, ec?: ExecutionContext): Promise<Response> };

function isDev(env: unknown): boolean {
  if (env && typeof env === "object" && (env as Record<string, unknown>).DEV === "1") return true;
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    return meta.env?.DEV === true;
  } catch {
    return false;
  }
}

/** Fills `entry`/`event` with origin-relative defaults when missing. */
export function completeManifest(manifest: Manifest, screens: string[], hasEvent: boolean): Manifest {
  const m: Manifest = { ...manifest, spec_version: manifest.spec_version ?? SPEC_VERSION };
  if (!m.entry) {
    const first = screens.includes("home") ? "home" : screens[0];
    if (first) m.entry = `/screens/${first}.json`;
  }
  if (!m.event && hasEvent) m.event = "/event";
  return m;
}

export function createApp<Env = unknown>(opts: AppOptions<Env>): Handler<Env> {
  const manifest = completeManifest(opts.manifest, Object.keys(opts.screens), Boolean(opts.onEvent));
  const icons = opts.icons ?? ICON_NAMES;
  const iconList = icons.length ? (icons as string[]) : undefined;
  const screenRe = /^\/screens\/([a-z][a-z0-9_-]{0,31})\.json$/;
  const imageRe = /^\/img\/([a-z0-9][a-z0-9_-]{0,63})\.png$/;

  async function handle(request: Request, env: Env, ec?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const ctx: AppContext<Env> = { device: parseDevice(request), request, env, ec, manifest };
    const validate = opts.validate ?? isDev(env);
    const { method } = request;
    const path = url.pathname;

    if (path === "/manifest.json") {
      if (method !== "GET" && method !== "HEAD") return error("method_not_allowed", "GET only", 405);
      return json(manifest, request);
    }

    const sm = screenRe.exec(path);
    if (sm) {
      if (method !== "GET" && method !== "HEAD") return error("method_not_allowed", "GET only", 405);
      const handler = opts.screens[sm[1]!];
      if (!handler) return error("not_found", `No screen '${sm[1]}'`, 404);
      const screen = withDefaults(await handler(ctx, url), sm[1]!, path);
      if (validate) {
        const r = validateScreen(screen, { manifest, origin: url.origin, icons: iconList });
        if (!r.ok) {
          const first = r.errors[0]!;
          console.error(`screen ${sm[1]} invalid:`, r.errors);
          return error("invalid_screen", `${first.path || "/"}: ${first.message}`, 500);
        }
      }
      return json(screen, request);
    }

    if (path === "/event") {
      if (method !== "POST") return error("method_not_allowed", "POST only", 405);
      if (!opts.onEvent) return error("not_found", "This app has no event handler", 404);
      let body: SubmitEvent;
      try {
        body = (await request.json()) as SubmitEvent;
      } catch {
        return error("bad_request", "Event body must be JSON", 400);
      }
      if (!body || typeof body !== "object" || typeof body.event !== "string") return error("bad_request", "Event body needs an event name", 400);
      const result = await opts.onEvent(body, ctx);
      if (result instanceof Response) return result;
      if (result === null || result === undefined) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      const screen = withDefaults(result, result.id ?? body.screen, undefined);
      if (validate) {
        const r = validateScreen(screen, { manifest, origin: url.origin, icons: iconList });
        if (!r.ok) {
          const first = r.errors[0]!;
          console.error(`event ${body.event} produced an invalid screen:`, r.errors);
          return error("invalid_screen", `${first.path || "/"}: ${first.message}`, 500);
        }
      }
      return json(screen, null);
    }

    const im = imageRe.exec(path);
    if (im && opts.images) {
      if (method !== "GET" && method !== "HEAD") return error("method_not_allowed", "GET only", 405);
      const handler = opts.images[im[1]!];
      if (!handler) return error("not_found", `No image '${im[1]}'`, 404);
      const result = await handler(ctx, url);
      if (result instanceof Response) return result;
      if (result instanceof Uint8Array) return png(result, request);
      return png(result.bytes, request, result.seed);
    }

    if (opts.fallback) {
      const r = await opts.fallback(request, ctx);
      if (r) return r;
    }
    return error("not_found", "Not found", 404);
  }

  return {
    async fetch(request: Request, env: Env, ec?: ExecutionContext): Promise<Response> {
      try {
        return await handle(request, env, ec);
      } catch (err) {
        if (err instanceof AppError) return error(err.code, err.message, err.status);
        console.error(err);
        return error("internal", "Something went wrong", 500);
      }
    },
  };
}

function withDefaults(screen: Screen, id: string, path: string | undefined): Screen {
  const s: Screen = { ...screen };
  if (s.spec_version === undefined) s.spec_version = SPEC_VERSION;
  if (!s.id) s.id = id;
  if (!s.url && path) s.url = path;
  return s;
}
