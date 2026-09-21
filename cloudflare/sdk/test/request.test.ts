import { describe, expect, it } from "vitest";
import { deviceVars, parseDevice, parseScreen, parseSettings } from "../src/request.js";

describe("parseDevice", () => {
  it("parses every §2 header", () => {
    const settings = { ha_url: "http://homeassistant.local:8123", entities: [{ id: "a" }] };
    const req = new Request("https://app/x", {
      headers: {
        "User-Agent": "QuireOS/0.1.0 (t5pro)",
        "X-Device-Id": "a1b2c3d4e5f6",
        "X-OS-Version": "0.1.0",
        "X-Spec-Version": "1",
        "X-Screen": "540x960x16@235",
        "X-Timezone": "Australia/Sydney",
        "X-Locale": "en-AU",
        "X-Install-Id": "0b6a1c1e-0c1e-4d1e-9c1e-0c1e0c1e0c1e",
        "X-App-Id": "hn",
        "X-App-Version": "1.2.0",
        "X-App-Settings": encodeURIComponent(JSON.stringify(settings)),
        "If-None-Match": '"abc"',
      },
    });
    const d = parseDevice(req);
    expect(d).toEqual({
      id: "a1b2c3d4e5f6",
      osVersion: "0.1.0",
      specVersion: 1,
      screen: { w: 540, h: 960, greys: 16, dpi: 235 },
      tz: "Australia/Sydney",
      locale: "en-AU",
      installId: "0b6a1c1e-0c1e-4d1e-9c1e-0c1e0c1e0c1e",
      appId: "hn",
      appVersion: "1.2.0",
      settings,
      userAgent: "QuireOS/0.1.0 (t5pro)",
      ifNoneMatch: '"abc"',
      isDevice: true,
    });
    expect(deviceVars(d, new Date(1758441600000))).toEqual({ time: 1758441600, tz: "Australia/Sydney", w: 540, h: 960, greys: 16, dpi: 235 });
  });
  it("defaults for browsers", () => {
    const d = parseDevice(new Request("https://app/x"));
    expect(d.isDevice).toBe(false);
    expect(d.screen).toEqual({ w: 540, h: 960, greys: 16, dpi: 235 });
    expect(d.tz).toBe("UTC");
    expect(d.settings).toEqual({});
  });
  it("tolerates malformed headers", () => {
    expect(parseScreen("960x540")).toEqual({ w: 960, h: 540, greys: 16, dpi: 235 });
    expect(parseScreen("garbage")).toEqual({ w: 540, h: 960, greys: 16, dpi: 235 });
    expect(parseSettings("%7Bnot json")).toEqual({});
    expect(parseSettings("%5B1%5D")).toEqual({});
    expect(parseSettings(encodeURIComponent('{"a":1}'))).toEqual({ a: 1 });
  });
});
