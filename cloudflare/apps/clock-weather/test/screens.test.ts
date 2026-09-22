import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, countWidgets, validateManifest, validateScreen } from "@quireos/sdk";
import type { Screen } from "@quireos/sdk";
import app, { deps, manifest } from "../src/index.js";
import { homeScreen } from "../src/screens.js";
import { apiUrl, clearWeatherCache, condition, parsePlace, parseWeather, weekday } from "../src/weather.js";

const icons = (JSON.parse(readFileSync(new URL("../../../../spec/icons.json", import.meta.url), "utf8")) as { icons: string[] }).icons;
const PORTRAIT = { w: 540, h: 960 };
const LANDSCAPE = { w: 960, h: 540 };
const ORIGIN = "https://quireos-app-clock-weather.example.workers.dev";
const fixture = readFileSync(new URL("./fixtures/open-meteo.json", import.meta.url), "utf8");
const weather = parseWeather(JSON.parse(fixture), "metric", 1_790_000_000)!;
const sydney = parsePlace({});

function check(s: Screen, label: string, screen = PORTRAIT) {
  const r = validateScreen(s, { manifest, origin: ORIGIN, icons, screen });
  expect(r.errors, `${label}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`).toEqual([]);
  const widgets = countWidgets(s.widgets);
  const bytes = new TextEncoder().encode(canonicalJson(s)).byteLength;
  expect(widgets).toBeLessThanOrEqual(96);
  expect(bytes).toBeLessThan(32 * 1024);
  return { widgets, bytes };
}

describe("weather", () => {
  it("validates the manifest", () => {
    expect(validateManifest(manifest, { icons }).errors).toEqual([]);
  });
  it("parses settings and builds the Open-Meteo URL", () => {
    expect(sydney).toEqual({ name: "Sydney", lat: -33.87, lon: 151.21, units: "metric" });
    const p = parsePlace({ place: "Boulder", lat: "40.015", lon: -105.27, units: "imperial" });
    expect(p).toEqual({ name: "Boulder", lat: 40.015, lon: -105.27, units: "imperial" });
    expect(apiUrl(p)).toContain("temperature_unit=fahrenheit");
    expect(apiUrl(sydney)).not.toContain("temperature_unit");
    expect(parsePlace({ lat: 999 }).lat).toBe(-33.87);
  });
  it("parses the forecast", () => {
    expect(weather.temp).toBe(18.4);
    expect(weather.days).toHaveLength(4);
    expect(weather.days[1]).toEqual({ date: "2026-09-23", code: 61, hi: 19.5, lo: 13.1 });
    expect(parseWeather({}, "metric", 0)).toBeUndefined();
  });
  it("maps WMO codes to icons that exist, with display-tier fallbacks at lg", () => {
    const display = new Set(["weather-sunny", "weather-night", "weather-partly-cloudy", "weather-cloudy", "weather-rainy", "weather-snowy", "weather-lightning"]);
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 123]) {
      for (const day of [true, false]) {
        const c = condition(code, day);
        expect(icons, `${code} md`).toContain(c.icon);
        expect(display.has(c.big), `${code} lg ${c.big}`).toBe(true);
      }
    }
    expect(condition(0, false).icon).toBe("weather-night");
    expect(weekday("2026-09-22")).toBe("Tue");
  });
});

describe("home screen", () => {
  it("validates portrait and landscape, with and without weather", () => {
    for (const screen of [{ w: 540, h: 960 }, { w: 960, h: 540 }]) {
      const s = homeScreen({ place: sydney, weather, screen });
      const { widgets, bytes } = check(s, `home ${screen.w}x${screen.h}`, screen);
      expect(widgets).toBeLessThan(30);
      expect(bytes).toBeLessThan(4 * 1024);
      const json = JSON.stringify(s);
      expect(json).toContain("{{device.time | time:'HH:mm'}}");
      expect(json).toContain("18°");
      expect(json).toContain("Partly cloudy");
      expect(s.ttl).toBe(600);
      const fail = homeScreen({ place: sydney, error: "Open-Meteo answered 503", screen });
      check(fail, `unavailable ${screen.w}x${screen.h}`, screen);
      expect(JSON.stringify(fail)).toContain("Weather unavailable");
      const imperial = homeScreen({ place: { ...sydney, units: "imperial" }, weather: { ...weather, units: "imperial" }, screen });
      check(imperial, "imperial", screen);
      expect(JSON.stringify(imperial)).toContain("mph");
    }
  });
});

describe("worker", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    clearWeatherCache();
  });
  it("fetches Open-Meteo once per ten minutes and answers 304", async () => {
    deps.fetch = async (input) => {
      calls.push(String(input));
      return new Response(fixture, { headers: { "Content-Type": "application/json" } });
    };
    const settings = encodeURIComponent(JSON.stringify({ place: "Sydney", lat: -33.87, lon: 151.21, units: "metric" }));
    const res = await app.fetch(new Request(`${ORIGIN}/screens/home.json`, { headers: { "X-App-Settings": settings } }), { DEV: "1" });
    expect(res.status).toBe(200);
    const tag = res.headers.get("ETag")!;
    const again = await app.fetch(new Request(`${ORIGIN}/screens/home.json`, { headers: { "X-App-Settings": settings, "If-None-Match": tag } }), { DEV: "1" });
    expect(again.status).toBe(304);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("latitude=-33.8700");
  });
  it("still shows the clock when Open-Meteo fails", async () => {
    deps.fetch = async () => new Response("down", { status: 503 });
    const res = await app.fetch(new Request(`${ORIGIN}/screens/home.json`), { DEV: "1" });
    expect(res.status).toBe(200);
    const s = (await res.json()) as Screen;
    expect(JSON.stringify(s)).toContain("Weather unavailable");
    expect(JSON.stringify(s)).toContain("{{device.time | time:'HH:mm'}}");
  });
});
