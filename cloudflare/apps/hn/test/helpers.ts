import { readFileSync } from "node:fs";
import { validateScreen, countWidgets, canonicalJson } from "@quireos/sdk";
import type { DeviceContext, Screen } from "@quireos/sdk";
import { manifest } from "../src/manifest.js";
import { expect } from "vitest";

const icons = (JSON.parse(readFileSync(new URL("../../../../spec/icons.json", import.meta.url), "utf8")) as { icons: string[] }).icons;

export const PORTRAIT = { w: 540, h: 960 };
export const LANDSCAPE = { w: 960, h: 540 };
const ORIGIN = "https://quireos-app-hn.example.workers.dev";

export function fakeDevice(over: Partial<DeviceContext> = {}): DeviceContext {
  return {
    id: "a1b2c3d4e5f6",
    osVersion: "0.1.0",
    specVersion: 1,
    screen: { w: 540, h: 960, greys: 16, dpi: 235 },
    tz: "Australia/Sydney",
    locale: "en-AU",
    installId: "11111111-2222-4333-8444-555555555555",
    appId: "hn",
    appVersion: "1.0.0",
    settings: {},
    userAgent: "QuireOS/0.1.0 (t5pro)",
    isDevice: true,
    ...over,
  };
}

/** Asserts a screen validates against the manifest with the real icon list and reports its size. */
export function check(screen: Screen, label = screen.id, panel = PORTRAIT): { widgets: number; bytes: number } {
  const r = validateScreen(screen, { manifest, origin: ORIGIN, icons, screen: panel });
  expect(r.errors, `${label}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`).toEqual([]);
  const widgets = countWidgets(screen.widgets);
  const bytes = new TextEncoder().encode(canonicalJson(screen)).byteLength;
  expect(widgets).toBeLessThanOrEqual(96);
  expect(bytes).toBeLessThan(32 * 1024);
  return { widgets, bytes };
}

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export const deviceHeaders = (over: Record<string, string> = {}): Record<string, string> => ({
  "User-Agent": "QuireOS/0.1.0 (t5pro)",
  "X-Device-Id": "a1b2c3d4e5f6",
  "X-OS-Version": "0.1.0",
  "X-Spec-Version": "1",
  "X-Screen": "540x960x16@235",
  "X-Timezone": "Australia/Sydney",
  "X-Locale": "en-AU",
  "X-Install-Id": "11111111-2222-4333-8444-555555555555",
  "X-App-Id": "hn",
  "X-App-Version": "1.0.0",
  Accept: "application/json",
  ...over,
});
