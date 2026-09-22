import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodePng4 } from "../src/png/encode.js";
import { bundleMount, rebaseBundle, validateBundle, validateIndex, validateManifest, validateScreen, compareVersions, isPrivateHost, classifyUrl } from "../src/validate.js";
import { ICON_NAMES } from "../src/profiles/icons.generated.js";
import type { Manifest } from "../src/types.js";
import { countWidgets } from "../src/screen.js";

const dir = new URL("../../../spec/conformance/screens/", import.meta.url);
interface Case { file: string; valid: boolean; rule?: string; path?: string; schema?: boolean }
const index = JSON.parse(readFileSync(new URL("cases.json", dir), "utf8")) as { cases: Case[] };
const read = (file: string) => readFileSync(new URL(file, dir), "utf8");

describe("spec/conformance/screens", () => {
  it("indexes every fixture", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "cases.json").sort();
    expect(index.cases.map((c) => c.file).sort()).toEqual(files);
    expect(index.cases.filter((c) => c.valid).length).toBeGreaterThanOrEqual(10);
    expect(index.cases.filter((c) => !c.valid).length).toBeGreaterThanOrEqual(15);
    for (const c of index.cases) expect(c.file.startsWith(c.valid ? "valid-" : "invalid-")).toBe(true);
  });
  for (const c of index.cases) {
    it(`${c.file}${c.rule ? ` (${c.rule})` : ""}`, () => {
      const text = read(c.file);
      const r = validateScreen(text);
      if (c.valid) {
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
      } else {
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.errors.map((e) => e.path)).toContain(c.path);
      }
    });
  }
  it("valid-limits-max sits exactly on the limits", () => {
    const doc = JSON.parse(read("valid-limits-max.json"));
    expect(countWidgets(doc.widgets)).toBe(96);
    expect(doc.data).toHaveLength(8);
    expect(Object.keys(doc.vars)).toHaveLength(16);
  });
  it("accepts objects, strings and bytes", () => {
    const doc = JSON.parse(read("valid-minimal.json"));
    expect(validateScreen(doc).ok).toBe(true);
    expect(validateScreen(new TextEncoder().encode(read("valid-minimal.json"))).ok).toBe(true);
    expect(validateScreen("{ not json").ok).toBe(false);
    expect(validateScreen([]).ok).toBe(false);
    expect(validateScreen(null).ok).toBe(false);
  });
});

const manifest: Manifest = {
  spec_version: 1,
  id: "ha-lights",
  name: "HA Lights",
  version: "1.0.0",
  min_os: "0.1.0",
  icon: "lightbulb",
  orientation: "portrait",
  screens: ["540x960"],
  entry: "/screens/home.json",
  event: "/event",
  hosts: ["{{settings.ha_url}}", "https://api.open-meteo.com"],
  settings: [
    { key: "ha_url", label: "Home Assistant URL", type: "url", required: true, default: "http://homeassistant.local:8123", help: "Where the device can reach HA" },
    { key: "ha_token", label: "Long-lived access token", type: "secret", required: true },
    { key: "entities", label: "Switches", type: "list", max: 8, required: true, item: [
      { key: "id", label: "Entity id", type: "string", required: true },
      { key: "label", label: "Tile label", type: "string", required: true } ] },
    { key: "units", label: "Units", type: "select", options: [{ value: "C", label: "Celsius" }, { value: "F", label: "Fahrenheit" }], default: "C" },
    { key: "n", label: "Count", type: "number", min: 1, max: 10, default: 3 },
    { key: "dark", label: "Dark", type: "bool", default: false },
  ],
};

describe("validateManifest", () => {
  it("accepts the spec example", () => {
    expect(validateManifest(manifest).errors).toEqual([]);
  });
  const bad = (over: Record<string, unknown>, path: string) => {
    const r = validateManifest({ ...manifest, ...over });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toContain(path);
  };
  it("rejects bad ids, names and versions", () => {
    bad({ id: "ha_lights" }, "/id");
    bad({ id: "HA" }, "/id");
    bad({ name: "x".repeat(25) }, "/name");
    bad({ name: "" }, "/name");
    bad({ version: "1.0" }, "/version");
    bad({ version: "v1.0.0" }, "/version");
    bad({ min_os: 1 }, "/min_os");
    bad({ spec_version: undefined }, "/spec_version");
    bad({ orientation: "upside-down" }, "/orientation");
    bad({ screens: ["540×960"] }, "/screens/0");
  });
  it("checks icon, entry and event", () => {
    bad({ icon: "Star Icon" }, "/icon");
    bad({ icon: "" }, "/icon");
    bad({ entry: undefined }, "/entry");
    bad({ entry: "screens/home.json" }, "/entry");
    bad({ entry: "/screens/{{vars.x}}.json" }, "/entry");
    bad({ event: "ftp://x" }, "/event");
    expect(validateManifest({ ...manifest, icon: "/icon.png" }).ok).toBe(true);
    expect(validateManifest({ ...manifest, icon: "https://cdn.example.com/i.png", event: undefined }).ok).toBe(true);
    expect(validateManifest({ ...manifest, icon: "star" }, { icons: ["star", "home"] }).ok).toBe(true);
    expect(validateManifest({ ...manifest, icon: "nope" }, { icons: ["star", "home"] }).ok).toBe(false);
  });
  it("checks hosts", () => {
    bad({ hosts: ["api.open-meteo.com"] }, "/hosts/0");
    bad({ hosts: ["https://api.open-meteo.com/v1"] }, "/hosts/0");
    bad({ hosts: ["{{settings.ha_token}}"] }, "/hosts/0");
    bad({ hosts: ["{{settings.missing}}"] }, "/hosts/0");
    bad({ hosts: ["{{settings.ha_url}}/api"] }, "/hosts/0");
    bad({ hosts: ["http://example.com"] }, "/hosts/0");
    bad({ hosts: ["https://API.example.com"] }, "/hosts/0");
    expect(validateManifest({ ...manifest, hosts: ["http://10.0.0.5:8080", "http://printer.local", "https://x.example.com:8443"] }).ok).toBe(true);
  });
  it("checks settings", () => {
    const s = (setting: unknown, path: string) => bad({ settings: [setting] }, path);
    s({ key: "Bad", label: "x", type: "string" }, "/settings/0/key");
    s({ key: "a", type: "string" }, "/settings/0/label");
    s({ key: "a", label: "x", type: "text" }, "/settings/0/type");
    s({ key: "a", label: "x", type: "secret", default: "x" }, "/settings/0/default");
    s({ key: "a", label: "x", type: "number", default: "3" }, "/settings/0/default");
    s({ key: "a", label: "x", type: "bool", default: "yes" }, "/settings/0/default");
    s({ key: "a", label: "x", type: "select" }, "/settings/0/options");
    s({ key: "a", label: "x", type: "select", options: [{ value: "a", label: "A" }], default: "b" }, "/settings/0/default");
    s({ key: "a", label: "x", type: "string", options: [] }, "/settings/0/options");
    s({ key: "a", label: "x", type: "list" }, "/settings/0/item");
    s({ key: "a", label: "x", type: "list", max: 17, item: [{ key: "b", label: "B", type: "string" }] }, "/settings/0/max");
    s({ key: "a", label: "x", type: "list", item: [{ key: "b", label: "B", type: "list", item: [] }] }, "/settings/0/item/0/type");
    s({ key: "a", label: "x", type: "list", item: [{ key: "b", label: "B", type: "string" }, { key: "b", label: "C", type: "string" }] }, "/settings/0/item/1/key");
    s({ key: "a", label: "x", type: "number", min: 5, max: 1 }, "/settings/0/max");
    s({ key: "a", label: "x", type: "url", default: "not a url" }, "/settings/0/default");
    bad({ settings: [{ key: "a", label: "x", type: "string" }, { key: "a", label: "y", type: "string" }] }, "/settings/1/key");
    bad({ settings: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: "x", type: "string" })) }, "/settings");
  });
});

describe("validateScreen with a manifest", () => {
  const screen = (widgets: unknown[], extra: Record<string, unknown> = {}) => ({ spec_version: 1, id: "s", widgets, ...extra });
  const opts = { manifest, origin: "https://ha-lights.example.workers.dev" };
  it("checks settings keys and list fields", () => {
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.ha_url}} {{settings.entities.0.label}} {{settings.n}}" }]), opts).errors).toEqual([]);
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.nope}}" }]), opts).errors[0]?.message).toMatch(/unknown setting/);
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.entities.0.nope}}" }]), opts).errors[0]?.message).toMatch(/no field/);
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.entities.x.id}}" }]), opts).errors[0]?.message).toMatch(/row number/);
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.n.x}}" }]), opts).errors[0]?.message).toMatch(/scalar/);
  });
  it("allows secrets only in request URLs, headers and bodies", () => {
    const ok = screen([{ type: "image", x: 0, y: 0, w: 1, h: 1, src: "{{settings.ha_url}}/cam.png?token={{settings.ha_token}}",
      on_tap: { type: "http", url: "{{settings.ha_url}}/api", headers: { Authorization: "Bearer {{settings.ha_token}}" }, body: { t: "{{settings.ha_token}}" } } }],
      { data: [{ id: "d", url: "{{settings.ha_url}}/x", headers: { A: "{{settings.ha_token}}" } }] });
    expect(validateScreen(ok, opts).errors).toEqual([]);
    for (const w of [
      { type: "text", x: 0, y: 0, w: 1, text: "{{settings.ha_token}}" },
      { type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", on_tap: { type: "navigate", url: "/s.json?t={{settings.ha_token}}" } },
      { type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", on_tap: { type: "submit", event: "e", args: { t: "{{settings.ha_token}}" } } },
      { type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", when: "settings.ha_token" },
    ]) {
      const r = validateScreen(screen([w]), opts);
      expect(r.ok).toBe(false);
      expect(r.errors[0]?.message).toMatch(/secret/);
    }
    expect(validateScreen(screen([]), { ...opts, manifest: undefined }).ok).toBe(true);
    expect(validateScreen(screen([{ type: "text", x: 0, y: 0, w: 1, text: "{{settings.ha_token}}" }])).ok).toBe(true); // no manifest: not checked
  });
  it("checks origins against hosts", () => {
    expect(validateScreen(screen([{ type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", on_tap: { type: "http", url: "https://api.open-meteo.com/v1/forecast" } }]), opts).ok).toBe(true);
    expect(validateScreen(screen([{ type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", on_tap: { type: "http", url: "https://ha-lights.example.workers.dev/api" } }]), opts).ok).toBe(true);
    const r = validateScreen(screen([{ type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", on_tap: { type: "http", url: "https://evil.example.com/api" } }]), opts);
    expect(r.errors[0]?.message).toMatch(/not declared/);
    expect(validateScreen(screen([{ type: "image", x: 0, y: 0, w: 1, h: 1, src: "{{settings.ha_token}}/x.png" }]), opts).errors[0]?.message).toMatch(/url setting/);
  });
  it("checks icon names when a set is given", () => {
    expect(validateScreen(screen([{ type: "icon", x: 0, y: 0, name: "star" }]), { icons: ["star"] }).ok).toBe(true);
    expect(validateScreen(screen([{ type: "icon", x: 0, y: 0, name: "nope" }]), { icons: ["star"] }).ok).toBe(false);
    expect(validateScreen(screen([{ type: "button", x: 0, y: 0, w: 1, h: 1, label: "x", icon: "nope" }]), { icons: ["star"] }).ok).toBe(false);
  });
});

describe("validateIndex", () => {
  const idx = {
    spec_version: 1,
    store: { name: "QuireOS Store", updated: "2026-09-21T08:00:00Z" },
    apps: [{ id: "hello", name: "Hello", tagline: "The ten-line tutorial app", icon: "star", version: "1.0.0",
      manifest: "https://quireos-store.example.workers.dev/a/hello/1.0.0/manifest.json", min_os: "0.1.0",
      screens: ["540x960", "960x540"], categories: ["demo"], author: "ben-gy", kind: "hosted", visibility: "public", installs: 12 }],
  };
  it("accepts the spec example", () => expect(validateIndex(idx).errors).toEqual([]));
  const bad = (over: Record<string, unknown>, path: string) => {
    const r = validateIndex({ ...idx, apps: [{ ...idx.apps[0], ...over }] });
    expect(r.errors.map((e) => e.path)).toContain(path);
  };
  it("rejects bad entries", () => {
    bad({ manifest: "/a/hello/manifest.json" }, "/apps/0/manifest");
    bad({ tagline: "x".repeat(81) }, "/apps/0/tagline");
    bad({ name: "x".repeat(25) }, "/apps/0/name");
    bad({ kind: "static" }, "/apps/0/kind");
    bad({ visibility: "secret" }, "/apps/0/visibility");
    bad({ installs: -1 }, "/apps/0/installs");
    bad({ icon: "Big Star" }, "/apps/0/icon");
    bad({ id: "hello_world" }, "/apps/0/id");
    expect(validateIndex({ ...idx, store: { name: "x" } }).errors.map((e) => e.path)).toContain("/store/updated");
    expect(validateIndex({ ...idx, apps: [idx.apps[0], idx.apps[0]] }).errors.map((e) => e.path)).toContain("/apps/1/id");
    expect(validateIndex({ spec_version: 1, store: idx.store }).ok).toBe(false);
  });
});

describe("validateBundle", () => {
  const enc = new TextEncoder();
  const file = (v: unknown) => enc.encode(JSON.stringify(v));
  const mk = async (over: Record<string, Uint8Array | null> = {}) => {
    const idx = new Uint8Array(96 * 96).fill(15);
    const icon = await encodePng4(idx, 96, 96);
    const files = new Map<string, Uint8Array>([
      ["manifest.json", file({ spec_version: 1, id: "hello", name: "Hello", version: "1.0.0", min_os: "0.1.0", icon: "/apps/hello/icon.png", entry: "/apps/hello/screen.json" })],
      ["screen.json", file({ spec_version: 1, id: "home", widgets: [
        { type: "text", x: 0, y: 0, w: 100, text: "Hi" },
        { type: "image", x: 0, y: 0, w: 96, h: 96, src: "/apps/hello/icon.png" },
        { type: "button", x: 0, y: 100, w: 100, h: 50, label: "About", on_tap: { type: "navigate", url: "/apps/hello/about.json" } } ] })],
      ["about.json", file({ spec_version: 1, id: "about", widgets: [{ type: "button", x: 0, y: 0, w: 100, h: 50, label: "Back", on_tap: { type: "back" } }] })],
      ["icon.png", icon],
      ["data.json", file({ not: "a screen" })],
      ["store.json", file({ tagline: "Hi" })],
    ]);
    for (const [k, v] of Object.entries(over)) v === null ? files.delete(k) : files.set(k, v);
    return files;
  };
  it("accepts a self-contained bundle", async () => {
    const r = validateBundle(await mk());
    expect(r.errors).toEqual([]);
  });
  it("requires manifest.json at the root", async () => {
    expect(validateBundle(await mk({ "manifest.json": null })).errors[0]?.path).toBe("manifest.json");
    const nested = new Map([["hello/manifest.json", file({})]]);
    expect(validateBundle(nested).ok).toBe(false);
  });
  it("reports manifest and screen errors with file prefixes", async () => {
    const r = validateBundle(await mk({ "about.json": file({ spec_version: 1, id: "about", widgets: [{ type: "text", x: 0, y: 0 }] }) }));
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["about.json#/widgets/0/w", "about.json#/widgets/0/text"]));
  });
  it("checks that relative URLs resolve inside the bundle", async () => {
    const r = validateBundle(await mk({ "about.json": null }));
    expect(r.errors.map((e) => e.path)).toContain("screen.json#/widgets/2/on_tap/url");
    const r2 = validateBundle(await mk({ "manifest.json": file({ spec_version: 1, id: "hello", name: "Hello", version: "1.0.0", min_os: "0.1.0", icon: "/other/icon.png", entry: "/apps/hello/screen.json", event: "/apps/hello/event.json" }) }));
    expect(r2.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["manifest.json#/icon", "manifest.json#/event"]));
    const r3 = validateBundle(await mk({ "manifest.json": file({ spec_version: 1, id: "hello", name: "Hello", version: "1.0.0", min_os: "0.1.0", icon: "star", entry: "https://x.example.com/screen.json" }) }));
    expect(r3.errors.map((e) => e.path)).toContain("manifest.json#/entry");
  });
  it("checks PNGs", async () => {
    const small = await encodePng4(new Uint8Array(4), 2, 2);
    const r = validateBundle(await mk({ "icon.png": small }));
    expect(r.errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringMatching(/96×96/)]));
    const r2 = validateBundle(await mk({ "photo.png": enc.encode("not png") }));
    expect(r2.errors.map((e) => e.path)).toContain("photo.png");
  });
  it("rejects odd file names and invalid JSON", async () => {
    const r = validateBundle(await mk({ "../x.json": file({}), "/abs.json": file({}), "broken.json": enc.encode("{") }));
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["../x.json", "/abs.json", "broken.json"]));
  });
  it("computes the mount and rebases", async () => {
    expect(bundleMount({ entry: "/apps/hello/screen.json" })).toBe("/apps/hello");
    expect(bundleMount({ entry: "/screen.json" })).toBe("");
    expect(bundleMount({ entry: "https://x/y.json" })).toBeUndefined();
    const out = rebaseBundle(await mk(), "/apps/hello", "/a/hello/1.0.0");
    const m = JSON.parse(new TextDecoder().decode(out.get("manifest.json")!));
    expect(m.entry).toBe("/a/hello/1.0.0/screen.json");
    const s = JSON.parse(new TextDecoder().decode(out.get("screen.json")!));
    expect(s.widgets[2].on_tap.url).toBe("/a/hello/1.0.0/about.json");
    expect(out.get("icon.png")).toBe((await mk()).get("icon.png")?.constructor && out.get("icon.png"));
  });
});

describe("helpers", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });
  it("recognises private hosts", () => {
    for (const h of ["10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255", "169.254.1.1", "127.0.0.1", "homeassistant.local", "localhost"]) expect(isPrivateHost(h)).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "example.com", "local.example.com"]) expect(isPrivateHost(h)).toBe(false);
  });
  it("classifies URLs", () => {
    expect(classifyUrl("https://A.example.com/x")).toEqual({ kind: "absolute", origin: "https://a.example.com" });
    expect(classifyUrl("/x/y.json?z#f")).toEqual({ kind: "relative", path: "/x/y.json" });
    expect(classifyUrl("{{ settings.base }}/x")).toEqual({ kind: "settings", settingKey: "base" });
    expect(classifyUrl("./x")).toBeUndefined();
    expect(classifyUrl("//x")).toBeUndefined();
  });
});

describe("disabled and keys", () => {
  const base = (over: Record<string, unknown>) => ({ spec_version: 1, id: "k", widgets: [{ type: "text", x: 0, y: 0, w: 1, text: "x" }], ...over });
  it("validates disabled like when", () => {
    expect(validateScreen(base({ widgets: [{ type: "text", x: 0, y: 0, w: 1, text: "x", disabled: "vars.busy == 1" }] })).ok).toBe(true);
    const r = validateScreen(base({ widgets: [{ type: "text", x: 0, y: 0, w: 1, text: "x", disabled: "{{vars.busy}}" }] }));
    expect(r.errors.map((e) => e.path)).toEqual(["/widgets/0/disabled"]);
    expect(validateScreen(base({ widgets: [{ type: "text", x: 0, y: 0, w: 1, text: "x", disabled: "nope.x" }] })).errors[0]?.message).toMatch(/unknown template root/);
  });
  it("validates keys actions and rejects long", () => {
    expect(validateScreen(base({ keys: {} })).ok).toBe(true);
    expect(validateScreen(base({ keys: { short: { type: "refresh" }, double: { type: "navigate", url: "/x.json" } } })).ok).toBe(true);
    expect(validateScreen(base({ keys: { short: { type: "navigate" } } })).errors.map((e) => e.path)).toEqual(["/keys/short/url"]);
    expect(validateScreen(base({ keys: { long: { type: "home" } } })).errors.map((e) => e.path)).toEqual(["/keys/long"]);
    expect(validateScreen(base({ keys: [] })).errors.map((e) => e.path)).toEqual(["/keys"]);
  });
});

describe("the icon set defaults", () => {
  const withIcon = (name: string) => ({
    spec_version: 1 as const,
    id: "home",
    widgets: [{ type: "icon" as const, x: 0, y: 0, w: 36, h: 36, name }],
  });

  it("checks against the compiled set when the caller forgets to pass one", () => {
    // The old behaviour skipped the check silently, which shipped blanks to glass.
    const r = validateScreen(withIcon("airplane"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toContain("not compiled");
  });

  it("still accepts a compiled name with no options at all", () => {
    expect(validateScreen(withIcon("star")).ok).toBe(true);
  });

  it("skips only when the caller says so with an empty list", () => {
    expect(validateScreen(withIcon("anything-at-all"), { icons: [] }).ok).toBe(true);
  });

  it("honours a wider list", () => {
    expect(validateScreen(withIcon("airplane"), { icons: [...ICON_NAMES, "airplane"] }).ok).toBe(true);
  });
});

describe("widgets that can never be seen", () => {
  const screen = { w: 540, h: 960 };
  const one = (w: Record<string, unknown>) => validateScreen({ spec_version: 1, id: "home", widgets: [w] }, { screen });

  it("leaves a widget that bleeds off an edge alone", () => {
    // A fill running past the bottom is a deliberate design, not a mistake.
    expect(one({ type: "rect", x: 24, y: 900, w: 400, h: 200 }).ok).toBe(true);
  });

  it("rejects one that starts past an edge", () => {
    expect(one({ type: "rect", x: 24, y: 1100, w: 400, h: 100 }).errors[0]!.message).toContain("never be seen");
    expect(one({ type: "rect", x: 900, y: 24, w: 100, h: 100 }).errors[0]!.message).toContain("never be seen");
  });

  it("rejects one that ends before an edge", () => {
    expect(one({ type: "rect", x: -200, y: 24, w: 100, h: 100 }).errors[0]!.message).toContain("never be seen");
  });

  it("resolves a grid child through its cell before judging it", () => {
    const grid = (child: Record<string, unknown>) =>
      validateScreen(
        { spec_version: 1, id: "home", widgets: [{ type: "grid", x: 24, y: 24, cols: 2, rows: 4, cell_w: 238, cell_h: 190, gap: 16, children: [child] }] },
        { screen },
      );
    expect(grid({ type: "rect", cell: 7 }).ok).toBe(true); // last cell is on the panel
    expect(grid({ type: "rect", cell: 1, y: 1200 }).errors[0]!.message).toContain("never be seen");
  });

  it("derives an unknown dimension as an upper bound, so it never flags a visible widget", () => {
    // An icon and a single-line text are small; both of these are far enough off to be certain.
    expect(one({ type: "icon", x: -400, y: 100, name: "star" }).ok).toBe(false);
    expect(one({ type: "text", x: 24, y: -500, w: 400, text: "hi" }).ok).toBe(false);
    // ...but anything that could still reach the panel on some board is left alone.
    expect(one({ type: "icon", x: -60, y: 100, name: "star" }).ok).toBe(true);
    expect(one({ type: "text", x: 24, y: -100, w: 400, lines: 8, text: "hi" }).ok).toBe(true);
    expect(one({ type: "text", x: 24, y: -10, w: 400, text: "hi" }).ok).toBe(true);
  });

  it("does not claim a widget is off the panel because another field is malformed", () => {
    // `lines` is static, so a conditional there is invalid — but assuming one line would
    // under-estimate the height and report a widget that eight lines would make visible.
    const r = one({ type: "text", x: 24, y: -900, w: 400, lines: { if: "v", then: 8, else: 1 }, text: "hi" });
    expect(r.errors.map((e) => e.path)).toEqual(["/widgets/0/lines"]);
  });

  it("says nothing when the caller does not know the panel", () => {
    expect(validateScreen({ spec_version: 1, id: "home", widgets: [{ type: "rect", x: 24, y: 5000, w: 10, h: 10 }] }).ok).toBe(true);
  });
});
