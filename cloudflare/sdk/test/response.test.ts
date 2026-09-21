import { describe, expect, it } from "vitest";
import { canonicalJson, error, etag, json, matchesEtag, png } from "../src/response.js";

describe("json", () => {
  it("serialises canonically with a strong ETag and no-store", async () => {
    const res = await json({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(await res.text()).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it("answers 304 when If-None-Match matches", async () => {
    const doc = { spec_version: 1, id: "x", widgets: [] };
    const first = await json(doc, new Request("https://x/"));
    const tag = first.headers.get("ETag")!;
    const second = await json(doc, new Request("https://x/", { headers: { "If-None-Match": tag } }));
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(tag);
    expect(await second.text()).toBe("");
    const weak = await json(doc, new Request("https://x/", { headers: { "If-None-Match": `W/${tag}, "other"` } }));
    expect(weak.status).toBe(304);
    const star = await json(doc, new Request("https://x/", { headers: { "If-None-Match": "*" } }));
    expect(star.status).toBe(304);
    const miss = await json(doc, new Request("https://x/", { headers: { "If-None-Match": '"nope"' } }));
    expect(miss.status).toBe(200);
    const changed = await json({ ...doc, id: "y" }, new Request("https://x/", { headers: { "If-None-Match": tag } }));
    expect(changed.status).toBe(200);
  });
  it("merges init", async () => {
    const res = await json({}, null, { status: 201, headers: { "X-Extra": "1", "Cache-Control": "public" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Extra")).toBe("1");
    expect(res.headers.get("Cache-Control")).toBe("public");
  });
  it("etag is deterministic", async () => {
    expect(await etag("abc")).toBe(await etag(new TextEncoder().encode("abc")));
    expect(matchesEtag('"a", "b"', '"b"')).toBe(true);
    expect(matchesEtag(null, '"b"')).toBe(false);
  });
});

describe("png", () => {
  it("serves bytes with an ETag from the seed", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const res = await png(bytes, new Request("https://x/"), "seed-1");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Length")).toBe("3");
    expect(res.headers.get("ETag")).toBe(await etag("seed-1"));
    const nm = await png(bytes, new Request("https://x/", { headers: { "If-None-Match": await etag("seed-1") } }), "seed-1");
    expect(nm.status).toBe(304);
    const byBytes = await png(bytes);
    expect(byBytes.headers.get("ETag")).toBe(await etag(bytes));
  });
});

describe("error", () => {
  it("produces the spec body", async () => {
    const res = error("settings_missing", "Add your HA token in Settings");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ spec_version: 1, error: { code: "settings_missing", message: "Add your HA token in Settings" } });
    const long = error("x", "m".repeat(200), 503);
    expect(long.status).toBe(503);
    expect(((await long.json()) as { error: { message: string } }).error.message).toHaveLength(120);
  });
});
