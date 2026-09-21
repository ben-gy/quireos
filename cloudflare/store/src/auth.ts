// Web sessions (cookie → D1), GitHub OAuth and CSRF protection.
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, deleteSession, getSessionUser, SESSION_TTL_S, upsertGithubUser } from "./db";
import type { Ctx, Env } from "./env";
import { hmacHex, randomToken, safeEqual } from "./util";

export const SESSION_COOKIE = "qs_session";
const ANON_COOKIE = "qs_anon";
const STATE_COOKIE = "qs_oauth";

function secure(c: Ctx): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function cookieOpts(c: Ctx, maxAge: number) {
  return { httpOnly: true, secure: secure(c), sameSite: "Lax" as const, path: "/", maxAge };
}

/** Loads the signed-in user (if any) into c.var.user for every request. */
export const sessionMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE) ?? null;
  let user = null;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) user = await getSessionUser(c.env.DB, token);
  c.set("user", user);
  c.set("sessionToken", user ? token : null);
  c.set("device", null);
  await next();
};

/** Pages: redirect anonymous visitors to the login page. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.var.user) {
    const u = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(u.pathname + u.search)}`);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.var.user) return c.redirect(`/login?next=${encodeURIComponent(new URL(c.req.url).pathname)}`);
  if (!c.var.user.is_admin) return c.text("Forbidden", 403);
  await next();
};

// ---- CSRF -----------------------------------------------------------------
// The token is an HMAC of the session cookie (or of an anonymous cookie for
// public forms such as reports), so nothing is stored server-side.

function csrfKey(c: Ctx): string {
  if (c.var.sessionToken) return `s:${c.var.sessionToken}`;
  let anon = getCookie(c, ANON_COOKIE);
  if (!anon || !/^[A-Za-z0-9_-]{43}$/.test(anon)) {
    anon = randomToken();
    setCookie(c, ANON_COOKIE, anon, cookieOpts(c, 7 * 24 * 3600));
  }
  return `a:${anon}`;
}

export async function csrfToken(c: Ctx): Promise<string> {
  return hmacHex(c.env.SESSION_SECRET, `csrf:${csrfKey(c)}`);
}

/** Middleware for state-changing form posts: rejects a missing or wrong `_csrf` field. */
export const requireCsrf: MiddlewareHandler<Env> = async (c, next) => {
  const body = await c.req.parseBody();
  const got = typeof body._csrf === "string" ? body._csrf : "";
  const want = await csrfToken(c);
  if (!got || !safeEqual(got, want)) return c.text("Invalid or missing CSRF token. Reload the page and try again.", 403);
  await next();
};

// ---- GitHub OAuth ---------------------------------------------------------

function callbackUrl(c: Ctx): string {
  return `${new URL(c.req.url).origin}/auth/github/callback`;
}

function safeNext(v: string | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

export async function loginStart(c: Ctx): Promise<Response> {
  if (!c.env.GITHUB_CLIENT_ID) return c.text("GITHUB_CLIENT_ID is not configured (see README)", 500);
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, `${state}|${next}`, cookieOpts(c, 600));
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", callbackUrl(c));
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return c.redirect(u.toString());
}

export async function oauthCallback(c: Ctx): Promise<Response> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookie = getCookie(c, STATE_COOKIE) ?? "";
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  const [wantState, next] = cookie.split("|", 2);
  if (!code || !state || !wantState || !safeEqual(state, wantState)) return c.text("OAuth state mismatch. Try signing in again.", 400);

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "quireos-store" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(c),
    }),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenJson.access_token) return c.text(`GitHub sign-in failed (${tokenJson.error ?? tokenRes.status}).`, 502);

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "quireos-store" },
  });
  if (!userRes.ok) return c.text(`GitHub profile lookup failed (${userRes.status}).`, 502);
  const gh = (await userRes.json()) as { id: number; login: string; name?: string | null; avatar_url?: string | null };
  if (typeof gh.id !== "number" || typeof gh.login !== "string") return c.text("Unexpected GitHub response.", 502);

  const user = await upsertGithubUser(c.env.DB, {
    github_id: gh.id,
    login: gh.login,
    name: gh.name ?? null,
    avatar_url: gh.avatar_url ?? null,
  });
  const session = await createSession(c.env.DB, user.id);
  setCookie(c, SESSION_COOKIE, session, cookieOpts(c, SESSION_TTL_S));
  return c.redirect(safeNext(next));
}

export async function logout(c: Ctx): Promise<Response> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/");
}
