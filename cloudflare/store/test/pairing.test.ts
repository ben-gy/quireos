import { describe, expect, it } from "vitest";
import { PAIR_ALPHABET } from "../src/db";
import app from "../src/index";
import { createUser, flash, form, json, makeEnv, signIn, type TestEnv } from "./fake_env";

const register = (env: TestEnv, hw_id = "aabbccddeeff") =>
  app.request("/api/v1/devices", json({ hw_id, os_version: "0.1.0", screen: "540x960x16@235" }), env);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("device registration", () => {
  it("issues a token, rotates it on re-registration and rejects the old one", async () => {
    const env = makeEnv();
    const a = (await (await register(env)).json()) as { device_id: string; token: string };
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await app.request("/api/v1/pair", { method: "POST", headers: bearer(a.token) }, env)).status).toBe(200);

    const b = (await (await register(env)).json()) as { device_id: string; token: string };
    expect(b.device_id).toBe(a.device_id);
    expect(b.token).not.toBe(a.token);
    expect((await app.request("/api/v1/pair", { method: "POST", headers: bearer(a.token) }, env)).status).toBe(401);
    expect((await app.request("/api/v1/pair", { method: "POST", headers: bearer(b.token) }, env)).status).toBe(200);

    // Only the hash is stored.
    const row = await env.DB.prepare("SELECT token_hash FROM devices WHERE id = ?").bind(a.device_id).first<{ token_hash: string }>();
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token_hash).not.toBe(b.token);
  });

  it("validates the body", async () => {
    const env = makeEnv();
    expect((await app.request("/api/v1/devices", json({ hw_id: "x", os_version: "0.1.0", screen: "" }), env)).status).toBe(400);
    expect((await app.request("/api/v1/devices", json({ hw_id: "abcdef", os_version: "1", screen: "" }), env)).status).toBe(400);
    expect((await app.request("/api/v1/devices", { method: "POST", body: "nope" }, env)).status).toBe(400);
    expect((await app.request("/api/v1/pair", { method: "POST" }, env)).status).toBe(401);
  });
});

describe("pairing", () => {
  it("walks pending → paired, and re-registration drops the pairing", async () => {
    const env = makeEnv();
    const user = await createUser(env, "ben-gy");
    const dev = (await (await register(env)).json()) as { device_id: string; token: string };

    const pr = await app.request("/api/v1/pair", { method: "POST", headers: bearer(dev.token) }, env);
    expect(pr.status).toBe(200);
    const p = (await pr.json()) as { code: string; expires_in: number; url: string };
    expect(p.code).toHaveLength(6);
    for (const ch of p.code) expect(PAIR_ALPHABET).toContain(ch);
    expect(p.expires_in).toBe(600);
    expect(p.url).toBe("http://localhost/pair");

    const pending = await app.request(`/api/v1/pair/${p.code}`, { headers: bearer(dev.token) }, env);
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: "pending" });

    // Another device cannot poll this code.
    const other = (await (await register(env, "other-device")).json()) as { token: string };
    expect((await app.request(`/api/v1/pair/${p.code}`, { headers: bearer(other.token) }, env)).status).toBe(404);

    // The website requires sign-in and a CSRF token.
    expect((await app.request("/pair", form({ code: p.code }), env)).status).toBe(302); // → /login
    const { cookie, csrf } = await signIn(env, user);
    const noCsrf = await app.request("/pair", { ...form({ code: p.code }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    expect(noCsrf.status).toBe(403);
    const claim = await app.request("/pair", { ...form({ code: p.code.toLowerCase(), _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    expect(claim.status).toBe(302);
    expect(claim.headers.get("Location")).toMatch(/^\/devices\?ok=/);

    const paired = await app.request(`/api/v1/pair/${p.code}`, { headers: bearer(dev.token) }, env);
    expect(paired.status).toBe(200);
    expect(await paired.json()).toEqual({ status: "paired", user: { login: "ben-gy", name: "BEN-GY" } });

    // Claiming twice fails.
    const again = await app.request("/pair", { ...form({ code: p.code, _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    expect(again.headers.get("Location")).toMatch(/^\/pair\?err=/);

    const devRow = await env.DB.prepare("SELECT user_id FROM devices WHERE id = ?").bind(dev.device_id).first<{ user_id: number }>();
    expect(devRow!.user_id).toBe(user);

    await register(env);
    const after = await env.DB.prepare("SELECT user_id FROM devices WHERE id = ?").bind(dev.device_id).first<{ user_id: number | null }>();
    expect(after!.user_id).toBeNull();
  });

  it("returns 410 for an expired code and refuses to claim it", async () => {
    const env = makeEnv();
    const user = await createUser(env, "ben-gy");
    const dev = (await (await register(env)).json()) as { token: string };
    const p = (await (await app.request("/api/v1/pair", { method: "POST", headers: bearer(dev.token) }, env)).json()) as { code: string };
    await env.DB.prepare("UPDATE pairings SET expires_at = ? WHERE code = ?").bind(new Date(Date.now() - 1000).toISOString(), p.code).run();
    expect((await app.request(`/api/v1/pair/${p.code}`, { headers: bearer(dev.token) }, env)).status).toBe(410);
    const { cookie, csrf } = await signIn(env, user);
    const claim = await app.request("/pair", { ...form({ code: p.code, _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    expect(claim.headers.get("Location")).toMatch(/^\/pair\?err=/);
    expect((await app.request(`/api/v1/pair/ZZZZZZ`, { headers: bearer(dev.token) }, env)).status).toBe(404);
  });

  it("rate-limits claim attempts per IP", async () => {
    const env = makeEnv();
    const user = await createUser(env, "ben-gy");
    const { cookie, csrf } = await signIn(env, user);
    const attempt = () =>
      app.request("/pair", { ...form({ code: "ABCDEF", _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, "CF-Connecting-IP": "203.0.113.9" } }, env);
    for (let i = 0; i < 10; i++) expect(flash(await attempt())).toContain("unknown");
    expect(flash(await attempt())).toContain("Too many attempts");
  });
});

describe("web pages", () => {
  it("renders browse and app pages, and protects the dashboard", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "ben-gy");
    await env.DB.prepare("INSERT INTO apps (slug, owner_id, name, tagline, kind, visibility, created_at, updated_at) VALUES ('hello', ?, 'Hello', 'Hi there', 'hosted', 'public', '2026-01-01', '2026-01-01')").bind(owner).run();
    await env.DB.prepare("INSERT INTO app_versions (app_slug, version, min_os, bundle_prefix, manifest_json, published_at) VALUES ('hello', '1.0.0', '0.1.0', 'bundles/hello/1.0.0/', '{}', '2026-01-02')").run();
    const home = await app.request("/", {}, env);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Hello");
    expect(html).toContain('href="/apps/hello"');
    const page = await app.request("/apps/hello", {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("http://localhost/a/hello/1.0.0/manifest.json");
    const dash = await app.request("/dashboard", {}, env);
    expect(dash.status).toBe(302);
    expect(dash.headers.get("Location")).toBe("/login?next=%2Fdashboard");
    expect((await app.request("/pair?code=ABC234", {}, env)).headers.get("Location")).toBe("/login?next=%2Fpair%3Fcode%3DABC234");
    const noSecret = await app.request("/", {}, { ...env, SESSION_SECRET: "" });
    expect(noSecret.status).toBe(500);
    expect(await noSecret.text()).toContain("SESSION_SECRET");
    const { cookie } = await signIn(env, owner);
    expect((await app.request("/dashboard", { headers: { Cookie: cookie } }, env)).status).toBe(200);
    expect((await app.request("/admin", { headers: { Cookie: cookie } }, env)).status).toBe(403);
  });
});
