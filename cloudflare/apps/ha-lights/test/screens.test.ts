import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, countWidgets, validateManifest, validateScreen } from "@quireos/sdk";
import type { Screen } from "@quireos/sdk";
import app, { manifest } from "../src/index.js";
import { homeScreen, parseEntities } from "../src/screens.js";

const icons = (JSON.parse(readFileSync(new URL("../../../../spec/icons.json", import.meta.url), "utf8")) as { icons: string[] }).icons;
const PORTRAIT = { w: 540, h: 960 };
const LANDSCAPE = { w: 960, h: 540 };
const ORIGIN = "https://quireos-app-ha-lights.example.workers.dev";

const example = [
  { id: "switch.shelly1minig3_48f6ee868fc4", label: "Pool Lights" },
  { id: "switch.shelly1minig3_48f6ee86ada8", label: "Hallway Main" },
  { id: "switch.shelly1minig3_48f6ee8776a8", label: "Hallway Entrance" },
  { id: "switch.shelly1minig3_48f6ee87d198", label: "Office" },
  { id: "switch.shelly1minig3_48f6ee880e10", label: "Chandelier" },
  { id: "switch.shelly1minig3_48f6ee8e99fc", label: "Verandah Front" },
  { id: "switch.garage_outside", label: "Garage Outside" },
];

function check(s: Screen, label: string, screen = PORTRAIT) {
  const r = validateScreen(s, { manifest, origin: ORIGIN, icons, screen });
  expect(r.errors, `${label}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`).toEqual([]);
  const widgets = countWidgets(s.widgets);
  const bytes = new TextEncoder().encode(canonicalJson(s)).byteLength;
  expect(widgets).toBeLessThanOrEqual(96);
  expect(bytes).toBeLessThan(32 * 1024);
  expect((s.data ?? []).length).toBeLessThanOrEqual(8);
  return { widgets, bytes };
}

describe("manifest", () => {
  it("is the §5 example plus single_request", () => {
    expect(validateManifest(manifest, { icons }).errors).toEqual([]);
    expect(manifest.hosts).toEqual(["{{settings.ha_url}}"]);
    expect(manifest.settings?.map((s) => s.key)).toEqual(["ha_url", "ha_token", "entities", "single_request"]);
  });
});

describe("home screen", () => {
  it("renders the setup screen without entities", () => {
    const s = homeScreen({ entities: [], screen: { w: 540, h: 960 } });
    check(s, "setup");
    expect(s.data).toBeUndefined();
    expect(JSON.stringify(s)).toContain("No switches yet");
  });
  it("binds one data source per entity, tiles with optimistic toggles and All off", () => {
    const s = homeScreen({ entities: example, screen: { w: 540, h: 960 } });
    const { widgets, bytes } = check(s, "7 entities");
    expect(s.data).toHaveLength(7);
    expect(s.data![0]).toMatchObject({ id: "e0", url: "{{settings.ha_url}}/api/states/switch.shelly1minig3_48f6ee868fc4", headers: { Authorization: "Bearer {{settings.ha_token}}" }, ttl: 30 });
    expect(s.vars).toMatchObject({ e0: "{{e0.state}}", e6: "{{e6.state}}" });
    const g = s.widgets.find((w) => w.type === "grid")!;
    expect(g.type === "grid" && g.children).toHaveLength(8);
    const tile = (g.type === "grid" ? g.children[0] : undefined) as { on_tap: { type: string; url: string; body: unknown; set: unknown; then: string; after: number }; fill: unknown };
    expect(tile.fill).toEqual({ if: "vars.e0 == on", then: 0, else: 15 });
    expect(tile.on_tap).toMatchObject({ type: "http", url: "{{settings.ha_url}}/api/services/switch/toggle", body: { entity_id: "switch.shelly1minig3_48f6ee868fc4" }, then: "refresh", after: 1 });
    const all = (g.type === "grid" ? g.children[7] : undefined) as unknown as { id: string; on_tap: { url: string; body: { entity_id: string[] } } };
    expect(all.id).toBe("all-off");
    expect(all.on_tap.url).toBe("{{settings.ha_url}}/api/services/homeassistant/turn_off");
    expect(all.on_tap.body.entity_id).toHaveLength(7);
    expect(widgets).toBeLessThan(20);
    expect(bytes).toBeLessThan(8 * 1024);
  });
  it("puts All off under the grid with eight entities, and lays out landscape", () => {
    const eight = [...example, { id: "light.kitchen", label: "Kitchen" }];
    const s = homeScreen({ entities: eight, screen: { w: 540, h: 960 } });
    check(s, "8 entities");
    expect(s.data).toHaveLength(8);
    const all = s.widgets.find((w) => w.type === "button" && w.id === "all-off")!;
    expect(all.type === "button" && all.y + all.h).toBeLessThanOrEqual(960);
    const light = (s.widgets.find((w) => w.type === "grid") as { children: { on_tap: { url: string } }[] }).children[7]!;
    expect(light.on_tap.url).toBe("{{settings.ha_url}}/api/services/light/toggle");
    const land = homeScreen({ entities: eight, screen: { w: 960, h: 540 } });
    check(land, "landscape", LANDSCAPE);
    const g = land.widgets.find((w) => w.type === "grid")!;
    expect(g.type === "grid" && g.cols).toBe(4);
    expect(g.type === "grid" && g.y + g.rows * g.cell_h + (g.rows - 1) * g.gap).toBeLessThan(540);
  });
  it("single_request uses one raw-bodied POST to /api/template", () => {
    const s = homeScreen({ entities: example, singleRequest: true, screen: { w: 540, h: 960 } });
    check(s, "single request");
    expect(s.data).toHaveLength(1);
    expect(s.data![0]).toMatchObject({ id: "st", method: "POST", body_raw: true, url: "{{settings.ha_url}}/api/template" });
    expect(String(s.data![0]!.body)).toContain("states('switch.garage_outside')");
    expect(s.vars).toMatchObject({ e0: "{{st.e0}}" });
  });
  it("parses X-App-Settings rows defensively", () => {
    expect(parseEntities({})).toEqual([]);
    expect(parseEntities({ entities: [{ id: "switch.a", label: "" }, { id: "bad id" }, { id: "light.b_2", label: "B" }] })).toEqual([
      { id: "switch.a", label: "a" },
      { id: "light.b_2", label: "B" },
    ]);
    expect(parseEntities({ entities: Array.from({ length: 12 }, (_, i) => ({ id: `switch.s${i}`, label: `S${i}` })) })).toHaveLength(8);
  });
});

describe("worker", () => {
  const settings = encodeURIComponent(JSON.stringify({ ha_url: "http://homeassistant.local:8123", entities: example.slice(0, 3) }));
  it("serves the screen for the settings in the header with an ETag", async () => {
    const res = await app.fetch(new Request(`${ORIGIN}/screens/home.json`, { headers: { "X-App-Settings": settings, "X-Screen": "540x960x16@235" } }), { DEV: "1" });
    expect(res.status).toBe(200);
    const s = (await res.json()) as Screen;
    expect(s.data).toHaveLength(3);
    const tag = res.headers.get("ETag")!;
    const again = await app.fetch(new Request(`${ORIGIN}/screens/home.json`, { headers: { "X-App-Settings": settings, "If-None-Match": tag } }), { DEV: "1" });
    expect(again.status).toBe(304);
    const empty = await app.fetch(new Request(`${ORIGIN}/screens/home.json`), { DEV: "1" });
    expect(JSON.stringify(await empty.json())).toContain("No switches yet");
  });
});
