import { describe, expect, it } from "vitest";
import app from "../src/index";
import { validateIndex } from "../src/validate";
import { createAppRow, createUser, json, makeEnv, publishRow, signIn, form, type TestEnv } from "./fake_env";

async function registerDevice(env: TestEnv, hw = "aabbccddeeff") {
  const r = await app.request("/api/v1/devices", json({ hw_id: hw, os_version: "0.1.0", screen: "540x960x16@235" }), env);
  expect(r.status).toBe(200);
  return (await r.json()) as { device_id: string; token: string };
}

async function pairDeviceTo(env: TestEnv, token: string, userId: number) {
  const pr = await app.request("/api/v1/pair", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
  const { code } = (await pr.json()) as { code: string };
  const { cookie, csrf } = await signIn(env, userId);
  const claim = await app.request("/pair", { ...form({ code, _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
  expect(claim.status).toBe(302);
  expect(claim.headers.get("Location")).toContain("ok=");
}

describe("GET /api/v1/index", () => {
  it("returns the spec §4 document with a strong ETag and answers 304", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "ben-gy");
    await createAppRow(env, { slug: "hello", owner_id: owner, categories: ["demo"] });
    await publishRow(env, "hello", "1.0.0");
    await createAppRow(env, { slug: "draft", owner_id: owner }); // no version → not listed

    const r = await app.request("/api/v1/index", {}, env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("application/json");
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const etag = r.headers.get("ETag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const doc = (await r.json()) as { spec_version: number; store: { name: string; updated: string }; apps: Record<string, unknown>[] };
    expect(validateIndex(doc)).toEqual({ ok: true, errors: [] });
    expect(doc.spec_version).toBe(1);
    expect(doc.store.name).toBe("Test Store");
    expect(doc.apps).toHaveLength(1);
    const hello = doc.apps[0]!;
    expect(hello).toMatchObject({
      id: "hello",
      name: "hello",
      version: "1.0.0",
      min_os: "0.1.0",
      manifest: "http://localhost/a/hello/1.0.0/manifest.json",
      categories: ["demo"],
      author: "ben-gy",
      kind: "hosted",
      installs: 0,
    });
    expect(hello).not.toHaveProperty("visibility"); // anonymous

    const again = await app.request("/api/v1/index", { headers: { "If-None-Match": etag } }, env);
    expect(again.status).toBe(304);
    expect(again.headers.get("ETag")).toBe(etag);
    const weak = await app.request("/api/v1/index", { headers: { "If-None-Match": `W/${etag}, "other"` } }, env);
    expect(weak.status).toBe(304);
    const stale = await app.request("/api/v1/index", { headers: { "If-None-Match": '"nope"' } }, env);
    expect(stale.status).toBe(200);

    const missing = await app.request("/api/v1/nope", {}, env);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("changes the ETag when the catalogue changes", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "ben-gy");
    await createAppRow(env, { slug: "hello", owner_id: owner });
    await publishRow(env, "hello", "1.0.0");
    const e1 = (await app.request("/api/v1/index", {}, env)).headers.get("ETag");
    await publishRow(env, "hello", "1.1.0");
    const e2 = (await app.request("/api/v1/index", {}, env)).headers.get("ETag");
    expect(e1).not.toBe(e2);
  });

  it("uses the owner's manifest URL for external apps", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "ben-gy");
    await createAppRow(env, { slug: "hn", owner_id: owner, kind: "external", manifest_url: "https://hn.example.workers.dev/manifest.json" });
    await publishRow(env, "hn", "2.0.0", { hosted: false });
    const doc = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: { id: string; manifest: string; kind: string }[] };
    expect(doc.apps[0]).toMatchObject({ id: "hn", manifest: "https://hn.example.workers.dev/manifest.json", kind: "external" });
  });

  it("filters by visibility: public for everyone, unlisted/private only for the owner's paired devices", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "owner");
    const other = await createUser(env, "other");
    for (const [slug, visibility] of [["pub", "public"], ["unl", "unlisted"], ["prv", "private"]] as const) {
      await createAppRow(env, { slug, owner_id: owner, visibility });
      await publishRow(env, slug);
    }
    await createAppRow(env, { slug: "gone", owner_id: owner, visibility: "public", unlisted_by_admin: true });
    await publishRow(env, "gone");

    const ids = async (headers: Record<string, string> = {}) => {
      const r = await app.request("/api/v1/index", { headers }, env);
      expect(r.status).toBe(200);
      const d = (await r.json()) as { apps: { id: string; visibility?: string }[] };
      return d.apps;
    };
    expect((await ids()).map((a) => a.id)).toEqual(["pub"]);

    const ownerDev = await registerDevice(env, "owner-device");
    // Registered but unpaired: same as anonymous, but `visibility` is present.
    const unpaired = await ids({ Authorization: `Bearer ${ownerDev.token}` });
    expect(unpaired.map((a) => a.id)).toEqual(["pub"]);
    expect(unpaired[0]!.visibility).toBe("public");

    await pairDeviceTo(env, ownerDev.token, owner);
    const r = await app.request("/api/v1/index", { headers: { Authorization: `Bearer ${ownerDev.token}` } }, env);
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
    const mine = (await r.json()) as { apps: { id: string; visibility: string }[] };
    expect(mine.apps.map((a) => a.id)).toEqual(["gone", "prv", "pub", "unl"]);
    expect(mine.apps.find((a) => a.id === "prv")!.visibility).toBe("private");

    const otherDev = await registerDevice(env, "other-device");
    await pairDeviceTo(env, otherDev.token, other);
    expect((await ids({ Authorization: `Bearer ${otherDev.token}` })).map((a) => a.id)).toEqual(["pub"]);

    const bad = await app.request("/api/v1/index", { headers: { Authorization: "Bearer " + "x".repeat(43) } }, env);
    expect(bad.status).toBe(401);
  });

  it("counts installs from the latest report per device", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "owner");
    await createAppRow(env, { slug: "hello", owner_id: owner });
    await publishRow(env, "hello");
    const d1 = await registerDevice(env, "dev-1");
    const d2 = await registerDevice(env, "dev-2");
    const report = (token: string, action: string) =>
      app.request("/api/v1/installs", json({ app: "hello", version: "1.0.0", action }, { Authorization: `Bearer ${token}` }), env);
    expect((await report(d1.token, "install")).status).toBe(204);
    expect((await report(d2.token, "install")).status).toBe(204);
    expect((await report(d2.token, "update")).status).toBe(204);
    expect((await report(d1.token, "uninstall")).status).toBe(204);
    expect((await report(d1.token, "explode")).status).toBe(400);
    const doc = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: { installs: number }[] };
    expect(doc.apps[0]!.installs).toBe(1);
  });
});

describe("GET /api/v1/apps/:slug", () => {
  it("returns the entry plus description, screenshots, changelog and versions; 404 when not visible", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "owner");
    await createAppRow(env, { slug: "hello", owner_id: owner, visibility: "unlisted" });
    await env.DB.prepare("UPDATE apps SET description = ?, screenshots = ? WHERE slug = ?").bind("Says hello.", JSON.stringify(["https://x.example/1.png"]), "hello").run();
    await publishRow(env, "hello", "1.0.0");
    await publishRow(env, "hello", "1.1.0");
    await createAppRow(env, { slug: "secret", owner_id: owner, visibility: "private" });
    await publishRow(env, "secret");

    const r = await app.request("/api/v1/apps/hello", {}, env);
    expect(r.status).toBe(200);
    const d = (await r.json()) as Record<string, unknown>;
    expect(d).toMatchObject({ spec_version: 1, id: "hello", version: "1.1.0", description: "Says hello.", screenshots: ["https://x.example/1.png"] });
    expect((d.versions as { version: string; manifest: string }[]).map((v) => v.version)).toEqual(["1.1.0", "1.0.0"]);
    expect((d.versions as { manifest: string }[])[1]!.manifest).toBe("http://localhost/a/hello/1.0.0/manifest.json");
    expect((d.changelog as unknown[]).length).toBe(2);

    expect((await app.request("/api/v1/apps/secret", {}, env)).status).toBe(404);
    expect((await app.request("/api/v1/apps/nope", {}, env)).status).toBe(404);
    expect((await app.request("/api/v1/apps/Bad_Slug", {}, env)).status).toBe(404);

    const dev = await registerDevice(env, "owner-device");
    await pairDeviceTo(env, dev.token, owner);
    expect((await app.request("/api/v1/apps/secret", { headers: { Authorization: `Bearer ${dev.token}` } }, env)).status).toBe(200);
  });
});
