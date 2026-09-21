import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipBundle } from "../src/bundles";
import { bundleMount, rebaseBundle } from "../src/validate";
import app from "../src/index";
import { validateManifest } from "../src/validate";
import { createAppRow, createUser, fakePng, flash, form, json, makeEnv, manifestFor, signIn, type TestEnv } from "./fake_env";

/**
 * A bundle in the SDK layout: the entry file at the root, other screens anywhere. `mount` writes
 * URLs as if the bundle were served under that prefix (the SDK's `bundleMount` rule).
 */
function bundleZip(manifest: Record<string, unknown>, extra: Record<string, Uint8Array> = {}, opts: { folder?: string; mount?: string } = {}): Uint8Array {
  const m = opts.mount ?? "";
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "home.json": strToU8(
      JSON.stringify({
        spec_version: 1,
        id: "home",
        url: `${m}/home.json`,
        data: [{ id: "w", url: "https://api.example.com/x" }, { id: "ha", url: "{{settings.ha_url}}/api/states" }],
        widgets: [
          { type: "text", x: 0, y: 0, w: 100, text: "Hi" },
          { type: "image", x: 0, y: 50, w: 96, h: 96, src: `${m}/icon.png` },
          { type: "button", x: 0, y: 200, w: 100, h: 40, label: "Go", on_tap: { type: "navigate", url: `${m}/screens/two.json` } },
        ],
      }),
    ),
    "screens/two.json": strToU8(JSON.stringify({ spec_version: 1, id: "two", widgets: [] })),
    "icon.png": fakePng(),
    ...extra,
  };
  const prefixed: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) prefixed[opts.folder ? `${opts.folder}/${k}` : k] = v;
  if (opts.folder) prefixed["__MACOSX/._manifest.json"] = strToU8("junk");
  return zipSync(prefixed, { level: 1 });
}

async function setupOwner(env: TestEnv, slug = "hello", visibility: "private" | "unlisted" | "public" = "public") {
  const owner = await createUser(env, "ben-gy");
  await createAppRow(env, { slug, owner_id: owner, kind: "hosted", visibility });
  const session = await signIn(env, owner);
  return { owner, ...session };
}

async function upload(env: TestEnv, slug: string, cookie: string, csrf: string, zip: Uint8Array, changelog = "first") {
  const fd = new FormData();
  fd.append("_csrf", csrf);
  fd.append("changelog", changelog);
  fd.append("bundle", new Blob([zip], { type: "application/zip" }), "bundle.zip");
  const r = await app.request(`/apps/${slug}/versions`, { method: "POST", body: fd, headers: { Cookie: cookie } }, env);
  expect(r.status).toBe(302);
  return flash(r);
}

describe("publishing a hosted bundle", () => {
  it("validates, rewrites root-relative URLs, stores the files and serves them immutably", async () => {
    const env = makeEnv();
    const { cookie, csrf } = await setupOwner(env);
    const loc = await upload(env, "hello", cookie, csrf, bundleZip(manifestFor("hello", "1.0.0", { icon: "/icon.png", screens: ["540x960"] }), {}, { folder: "hello" }));
    expect(loc).toBe("Published version 1.0.0.");

    const v = await env.DB.prepare("SELECT * FROM app_versions WHERE app_slug = 'hello'").first<{ version: string; bundle_prefix: string; manifest_json: string; changelog: string }>();
    expect(v).toMatchObject({ version: "1.0.0", bundle_prefix: "bundles/hello/1.0.0/", changelog: "first" });
    expect(JSON.parse(v!.manifest_json)).toMatchObject({ entry: "/a/hello/1.0.0/home.json", icon: "/a/hello/1.0.0/icon.png" });
    expect([...env.fakeR2.objects.keys()].sort()).toEqual(["bundles/hello/1.0.0/home.json", "bundles/hello/1.0.0/icon.png", "bundles/hello/1.0.0/manifest.json", "bundles/hello/1.0.0/screens/two.json"]);
    const appRow = await env.DB.prepare("SELECT name, min_os, screens FROM apps WHERE slug = 'hello'").first<{ name: string; min_os: string; screens: string }>();
    expect(appRow).toEqual({ name: "hello", min_os: "0.1.0", screens: '["540x960"]' });

    const m = await app.request("/a/hello/1.0.0/manifest.json", {}, env);
    expect(m.status).toBe(200);
    expect(m.headers.get("Content-Type")).toContain("application/json");
    expect(m.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(m.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const etag = m.headers.get("ETag")!;
    expect(etag).toMatch(/^"/);
    expect(await m.json()).toMatchObject({ id: "hello", entry: "/a/hello/1.0.0/home.json" });
    expect((await app.request("/a/hello/1.0.0/manifest.json", { headers: { "If-None-Match": etag } }, env)).status).toBe(304);

    const home = (await (await app.request("/a/hello/1.0.0/home.json", {}, env)).json()) as { url: string; data: { url: string }[]; widgets: Record<string, unknown>[] };
    expect(home.url).toBe("/a/hello/1.0.0/home.json");
    expect(home.data.map((d) => d.url)).toEqual(["https://api.example.com/x", "{{settings.ha_url}}/api/states"]);
    expect(home.widgets[1]!.src).toBe("/a/hello/1.0.0/icon.png");
    expect((home.widgets[2]!.on_tap as { url: string }).url).toBe("/a/hello/1.0.0/screens/two.json");

    const png = await app.request("/a/hello/1.0.0/icon.png", {}, env);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect((await app.request("/a/hello/1.0.0/nope.json", {}, env)).status).toBe(404);
    expect((await app.request("/a/hello/1.0.0/../x", {}, env)).status).toBe(404);
    expect((await app.request("/a/hello/9.9.9/manifest.json", {}, env)).status).toBe(404);

    // The index now lists it with the manifest URL and the rewritten icon URL.
    const idx = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: { manifest: string; icon: string; screens: string[] }[] };
    expect(idx.apps[0]).toMatchObject({ manifest: "http://localhost/a/hello/1.0.0/manifest.json", icon: "http://localhost/a/hello/1.0.0/icon.png", screens: ["540x960"] });
  });

  it("rejects bad bundles with readable errors and never writes to R2", async () => {
    const env = makeEnv();
    const { cookie, csrf } = await setupOwner(env);
    const bad = async (zip: Uint8Array) => {
      const loc = await upload(env, "hello", cookie, csrf, zip);
      expect(loc).toContain("Not published");
      expect(env.fakeR2.objects.size).toBe(0);
      return loc;
    };
    expect(await bad(zipSync({ "readme.txt": strToU8("hi") }))).toContain("must contain manifest.json at its root");
    expect(await bad(bundleZip(manifestFor("other")))).toContain('manifest.id is "other"');
    expect(await bad(bundleZip(manifestFor("hello", "1.0")))).toContain("manifest.json#/version");
    expect(await bad(bundleZip({ ...manifestFor("hello"), entry: "/missing.json" }))).toContain("does not exist in the bundle (expected file missing.json)");
    // SDK rule: the entry's directory is the mount, so the entry file must sit at the bundle root.
    expect(await bad(bundleZip({ ...manifestFor("hello"), entry: "/screens/two.json" }))).toContain("expected file two.json");
    expect(await bad(bundleZip(manifestFor("hello"), { "icon.png": fakePng(64, 64) }))).toContain("icon must be 96×96");
    expect(await bad(bundleZip(manifestFor("hello"), { "screens/broken.json": strToU8("{oops") }))).toContain("invalid JSON");
    expect(await bad(bundleZip(manifestFor("hello"), { "evil/../../x.json": strToU8("{}") }))).toContain("unsafe path");
    expect(await bad(strToU8("definitely not a zip"))).toContain("not a valid zip");
    // SDK semantics reach the store unweakened: icon names are checked against spec/icons.json,
    // and templates/origins used by screens must be declared in the manifest.
    expect(await bad(bundleZip(manifestFor("hello", "1.0.0", { icon: "definitely-not-an-icon" })))).toMatch(/icon/);
    expect(await bad(bundleZip(manifestFor("hello", "1.0.0", { settings: [] })))).toContain("ha_url");
    expect(await bad(bundleZip(manifestFor("hello", "1.0.0", { hosts: ["{{settings.ha_url}}"] })))).toContain("api.example.com");
  });

  it("requires a strictly greater version and keeps versions immutable", async () => {
    const env = makeEnv();
    const { cookie, csrf } = await setupOwner(env);
    expect(await upload(env, "hello", cookie, csrf, bundleZip(manifestFor("hello", "1.2.0")))).toBe("Published version 1.2.0.");
    expect(await upload(env, "hello", cookie, csrf, bundleZip(manifestFor("hello", "1.2.0")))).toContain("must be greater than the latest published version 1.2.0");
    expect(await upload(env, "hello", cookie, csrf, bundleZip(manifestFor("hello", "1.1.9")))).toContain("must be greater");
    expect(await upload(env, "hello", cookie, csrf, bundleZip(manifestFor("hello", "1.10.0")))).toBe("Published version 1.10.0.");
    const rows = await env.DB.prepare("SELECT version FROM app_versions WHERE app_slug = 'hello' ORDER BY id").all<{ version: string }>();
    expect(rows.results.map((r) => r.version)).toEqual(["1.2.0", "1.10.0"]);
  });

  it("rebases a bundle written for a mount prefix and merges store.json listing data", async () => {
    const env = makeEnv();
    const { cookie, csrf } = await setupOwner(env);
    const meta = {
      tagline: "Says hello",
      description: "The ten-line tutorial app.",
      categories: ["demo", "Getting Started"],
      screenshots: ["https://shots.example/hello.png", "not a url"],
      changelog: [{ version: "1.0.0", notes: "Initial release" }],
    };
    const zip = bundleZip(manifestFor("hello", "1.0.0", { entry: "/hello/home.json", icon: "/hello/icon.png" }), { "store.json": strToU8(JSON.stringify(meta)) }, { mount: "/hello" });
    expect(await upload(env, "hello", cookie, csrf, zip, "")).toBe("Published version 1.0.0.");

    const m = (await (await app.request("/a/hello/1.0.0/manifest.json", {}, env)).json()) as { entry: string; icon: string };
    expect(m).toMatchObject({ entry: "/a/hello/1.0.0/home.json", icon: "/a/hello/1.0.0/icon.png" });
    const home = (await (await app.request("/a/hello/1.0.0/home.json", {}, env)).json()) as { url: string; widgets: { on_tap?: { url: string } }[] };
    expect(home.url).toBe("/a/hello/1.0.0/home.json");
    expect(home.widgets[2]!.on_tap!.url).toBe("/a/hello/1.0.0/screens/two.json");

    const row = await env.DB.prepare("SELECT tagline, description, categories, screenshots FROM apps WHERE slug = 'hello'").first<Record<string, string>>();
    expect(row).toEqual({ tagline: "Says hello", description: "The ten-line tutorial app.", categories: '["demo","getting-started"]', screenshots: '["https://shots.example/hello.png"]' });
    const ver = await env.DB.prepare("SELECT changelog FROM app_versions WHERE app_slug = 'hello'").first<{ changelog: string }>();
    expect(ver!.changelog).toBe("Initial release");

    const idx = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: Record<string, unknown>[] };
    expect(idx.apps[0]).toMatchObject({ tagline: "Says hello", categories: ["demo", "getting-started"], icon: "http://localhost/a/hello/1.0.0/icon.png" });
  });

  it("enforces ownership, sign-in and CSRF on publish", async () => {
    const env = makeEnv();
    const { csrf } = await setupOwner(env);
    const stranger = await createUser(env, "stranger");
    const s = await signIn(env, stranger);
    const fd = new FormData();
    fd.append("_csrf", s.csrf);
    fd.append("bundle", new Blob([bundleZip(manifestFor("hello"))]), "b.zip");
    expect((await app.request("/apps/hello/versions", { method: "POST", body: fd, headers: { Cookie: s.cookie } }, env)).status).toBe(404);
    expect((await app.request("/apps/hello/versions", { method: "POST", body: fd }, env)).status).toBe(302); // → login
    const fd2 = new FormData();
    fd2.append("_csrf", csrf); // owner's token, stranger's session
    expect((await app.request("/apps/hello/versions", { method: "POST", body: fd2, headers: { Cookie: s.cookie } }, env)).status).toBe(403);
  });

  it("serves private bundles only to the owner's paired devices (or the owner's browser)", async () => {
    const env = makeEnv();
    const { owner, cookie, csrf } = await setupOwner(env, "secret", "private");
    await upload(env, "secret", cookie, csrf, bundleZip(manifestFor("secret")));
    expect((await app.request("/a/secret/1.0.0/manifest.json", {}, env)).status).toBe(404);
    expect((await app.request("/a/secret/1.0.0/manifest.json", { headers: { Cookie: cookie } }, env)).status).toBe(200);

    const reg = async (hw: string) => (await (await app.request("/api/v1/devices", json({ hw_id: hw, os_version: "0.1.0", screen: "" }), env)).json()) as { token: string };
    const mine = await reg("mine");
    const theirs = await reg("theirs");
    const code = ((await (await app.request("/api/v1/pair", { method: "POST", headers: { Authorization: `Bearer ${mine.token}` } }, env)).json()) as { code: string }).code;
    await app.request("/pair", { ...form({ code, _csrf: csrf }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    const r = await app.request("/a/secret/1.0.0/manifest.json", { headers: { Authorization: `Bearer ${mine.token}` } }, env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect((await app.request("/a/secret/1.0.0/manifest.json", { headers: { Authorization: `Bearer ${theirs.token}` } }, env)).status).toBe(404);
    expect(owner).toBeGreaterThan(0);
  });
});

describe("publishing an external app", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the manifest, validates it and snapshots it", async () => {
    const env = makeEnv();
    const owner = await createUser(env, "ben-gy");
    await createAppRow(env, { slug: "hn", owner_id: owner, kind: "external", visibility: "private", manifest_url: "https://hn.example.workers.dev/manifest.json" });
    const { cookie, csrf } = await signIn(env, owner);
    const calls: string[] = [];
    let manifest: Record<string, unknown> = manifestFor("hn", "0.3.0", { icon: "/icon.png" });
    let etag: string | null = '"abc"';
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(manifest), { headers: etag ? { ETag: etag, "Content-Type": "application/json" } : {} });
    });
    const post = () => app.request("/apps/hn/versions", { ...form({ _csrf: csrf, changelog: "snap" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie } }, env);
    expect(flash(await post())).toBe("Published version 0.3.0.");
    expect(calls).toEqual(["https://hn.example.workers.dev/manifest.json"]);

    const idx = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: { id: string; manifest: string; icon: string }[] };
    expect(idx.apps).toHaveLength(0); // still private
    await env.DB.prepare("UPDATE apps SET visibility = 'public' WHERE slug = 'hn'").run();
    const idx2 = (await (await app.request("/api/v1/index", {}, env)).json()) as { apps: { id: string; manifest: string; icon: string }[] };
    expect(idx2.apps[0]).toMatchObject({ id: "hn", manifest: "https://hn.example.workers.dev/manifest.json", icon: "https://hn.example.workers.dev/icon.png" });

    expect(flash(await post())).toContain("must be greater");
    manifest = manifestFor("other", "0.4.0");
    expect(flash(await post())).toContain('manifest.id is "other"');
    manifest = manifestFor("hn", "0.4.0");
    etag = null;
    expect(flash(await post())).toContain("ETag");
  });
});

describe("helpers", () => {
  it("bundleMount and rebaseBundle follow the SDK's mount rule", () => {
    expect(bundleMount({ entry: "/home.json" })).toBe("");
    expect(bundleMount({ entry: "/hello/screens/home.json" })).toBe("/hello/screens");
    expect(bundleMount({ entry: "https://x.example/home.json" })).toBeUndefined();
    expect(bundleMount({})).toBeUndefined();
    const files = new Map<string, Uint8Array>([
      ["manifest.json", strToU8(JSON.stringify({ entry: "/hello/home.json", icon: "star", hosts: ["https://api.example.com", "{{settings.ha_url}}"] }))],
      ["home.json", strToU8(JSON.stringify({ widgets: [{ src: "https://cdn.example.com/x.png" }, { src: "/hello/x.png", url: "//proto-relative" }, { on_tap: { url: "{{settings.ha_url}}/x" } }, { url: "/other/x.json" }] }))],
      ["icon.png", new Uint8Array([1, 2, 3])],
    ]);
    const out = rebaseBundle(files, "/hello", "/a/app/1.0.0");
    expect(JSON.parse(new TextDecoder().decode(out.get("manifest.json")))).toEqual({ entry: "/a/app/1.0.0/home.json", icon: "star", hosts: ["https://api.example.com", "{{settings.ha_url}}"] });
    expect(JSON.parse(new TextDecoder().decode(out.get("home.json")))).toEqual({
      widgets: [{ src: "https://cdn.example.com/x.png" }, { src: "/a/app/1.0.0/x.png", url: "//proto-relative" }, { on_tap: { url: "{{settings.ha_url}}/x" } }, { url: "/other/x.json" }],
    });
    expect(out.get("icon.png")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("unzipBundle strips one top-level folder and macOS junk", () => {
    const { files, errors } = unzipBundle(bundleZip(manifestFor("x"), {}, { folder: "x-1.0.0" }));
    expect(errors).toEqual([]);
    expect([...files.keys()].sort()).toEqual(["home.json", "icon.png", "manifest.json", "screens/two.json"]);
  });

  it("validateManifest catches the common mistakes", () => {
    expect(validateManifest(manifestFor("ok")).ok).toBe(true);
    const bad = validateManifest({ ...manifestFor("Bad_Id", "1"), name: "x".repeat(30), settings: [{ key: "t", label: "T", type: "secret", default: "x" }], hosts: ["example.com"] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.path).sort()).toEqual(["/hosts/0", "/id", "/name", "/settings/0/default", "/version"]);
  });
});
