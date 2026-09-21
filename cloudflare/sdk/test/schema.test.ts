import { readdirSync, readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { validateIndex, validateManifest, validateScreen } from "../src/validate.js";

const schemaDir = new URL("../../../spec/schema/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(`${name}.schema.json`, schemaDir), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const screenSchema = ajv.compile(load("screen"));
const manifestSchema = ajv.compile(load("manifest"));
const indexSchema = ajv.compile(load("index"));
const eventSchema = ajv.compile(load("event"));
const errorSchema = ajv.compile(load("error"));

const dir = new URL("../../../spec/conformance/screens/", import.meta.url);
interface Case { file: string; valid: boolean; rule?: string; path?: string; schema?: boolean }
const cases = (JSON.parse(readFileSync(new URL("cases.json", dir), "utf8")) as { cases: Case[] }).cases;

describe("screen.schema.json agrees with validateScreen", () => {
  it("compiles all five schemas", () => {
    expect(readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json")).sort()).toEqual(["error.schema.json", "event.schema.json", "index.schema.json", "manifest.schema.json", "screen.schema.json"]);
  });
  for (const c of cases) {
    it(`${c.file}${c.schema === false ? " (schema-blind)" : ""}`, () => {
      const doc = JSON.parse(readFileSync(new URL(c.file, dir), "utf8"));
      const ts = validateScreen(doc).ok;
      const js = screenSchema(doc);
      expect(ts).toBe(c.valid);
      if (c.schema === false) expect(js).toBe(true); // semantic rule the schema cannot express
      else expect(js).toBe(c.valid);
    });
  }
});

describe("manifest and index schemas", () => {
  const manifest = {
    spec_version: 1, id: "ha-lights", name: "HA Lights", version: "1.0.0", min_os: "0.1.0", icon: "lightbulb", orientation: "portrait", screens: ["540x960"],
    entry: "/screens/home.json", event: "/event", hosts: ["{{settings.ha_url}}", "https://api.open-meteo.com"],
    settings: [
      { key: "ha_url", label: "Home Assistant URL", type: "url", required: true, default: "http://homeassistant.local:8123", help: "Where the device can reach HA on your LAN" },
      { key: "ha_token", label: "Long-lived access token", type: "secret", required: true },
      { key: "entities", label: "Switches", type: "list", max: 8, required: true, item: [{ key: "id", label: "Entity id", type: "string", required: true }, { key: "label", label: "Tile label", type: "string", required: true }] },
      { key: "units", label: "Units", type: "select", options: [{ value: "C", label: "C" }], default: "C" },
    ],
  };
  it("accept the spec manifest", () => {
    expect(manifestSchema(manifest)).toBe(true);
    expect(validateManifest(manifest).ok).toBe(true);
  });
  const both = (doc: unknown) => [manifestSchema(doc), validateManifest(doc).ok];
  it("reject the same manifests", () => {
    expect(both({ ...manifest, id: "ha_lights" })).toEqual([false, false]);
    expect(both({ ...manifest, name: "x".repeat(25) })).toEqual([false, false]);
    expect(both({ ...manifest, version: "1.0" })).toEqual([false, false]);
    expect(both({ ...manifest, entry: "screens/home.json" })).toEqual([false, false]);
    expect(both({ ...manifest, hosts: ["api.open-meteo.com"] })).toEqual([false, false]);
    expect(both({ ...manifest, settings: [{ key: "t", label: "T", type: "secret", default: "x" }] })).toEqual([false, false]);
    expect(both({ ...manifest, settings: [{ key: "t", label: "T", type: "select" }] })).toEqual([false, false]);
    expect(both({ ...manifest, settings: [{ key: "t", label: "T", type: "list", item: [{ key: "u", label: "U", type: "list", item: [] }] }] })).toEqual([false, false]);
    expect(both({ ...manifest, settings: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: "x", type: "string" })) })).toEqual([false, false]);
  });
  const idx = { spec_version: 1, store: { name: "S", updated: "2026-09-21T08:00:00Z" }, apps: [{ id: "hello", name: "Hello", tagline: "t", icon: "star", version: "1.0.0", manifest: "https://s.example.com/a/hello/1.0.0/manifest.json", min_os: "0.1.0", kind: "hosted" }] };
  it("index", () => {
    expect(indexSchema(idx)).toBe(true);
    expect(validateIndex(idx).ok).toBe(true);
    const bad = { ...idx, apps: [{ ...idx.apps[0], manifest: "/relative" }] };
    expect(indexSchema(bad)).toBe(false);
    expect(validateIndex(bad).ok).toBe(false);
  });
  it("event and error", () => {
    expect(eventSchema({ spec_version: 1, event: "next", screen: "home", widget: "btn_next", args: { seed: "5" }, vars: { page: "2" }, x: 300, y: 812, ts: 1758441600 })).toBe(true);
    expect(eventSchema({ spec_version: 1, event: "next", screen: "home", widget: "#3" })).toBe(true);
    expect(eventSchema({ spec_version: 1, event: "next", screen: "home" })).toBe(false);
    expect(errorSchema({ spec_version: 1, error: { code: "settings_missing", message: "Add your HA token in Settings" } })).toBe(true);
    expect(errorSchema({ spec_version: 1, error: { code: "Bad Code", message: "x" } })).toBe(false);
  });
});
