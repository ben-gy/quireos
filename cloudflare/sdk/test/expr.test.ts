import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, evaluateCond, resolveValue, tokenize, parseExpr, parseCond, formatTime, parseTime, resolveDeep } from "../src/expr.js";
import type { EvalContext } from "../src/expr.js";

interface Case {
  name: string;
  template?: string;
  cond?: string;
  value?: unknown;
  expect: unknown;
  ctx?: EvalContext;
}
interface Fixture {
  spec_version: number;
  ctx: EvalContext;
  cases: Case[];
}

const fixture = JSON.parse(readFileSync(new URL("../../../spec/conformance/expr.json", import.meta.url), "utf8")) as Fixture;

describe("spec/conformance/expr.json", () => {
  it("has enough cases", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(60);
    const kinds = { template: 0, cond: 0, value: 0 };
    for (const c of fixture.cases) {
      if (c.template !== undefined) kinds.template++;
      else if (c.cond !== undefined) kinds.cond++;
      else kinds.value++;
    }
    expect(kinds.template).toBeGreaterThan(20);
    expect(kinds.cond).toBeGreaterThan(20);
    expect(kinds.value).toBeGreaterThan(5);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const ctx = c.ctx ?? fixture.ctx;
      if (c.template !== undefined) expect(evaluate(c.template, ctx)).toBe(c.expect);
      else if (c.cond !== undefined) expect(evaluateCond(c.cond, ctx)).toBe(c.expect);
      else expect(resolveValue(c.value as never, ctx)).toStrictEqual(c.expect);
    });
  }
});

describe("tokenize", () => {
  it("splits text and expressions", () => {
    const t = tokenize("a {{vars.x | upper}} b {{bad..}} {{unterminated");
    expect(t).toEqual([
      { type: "text", value: "a " },
      { type: "expr", raw: "vars.x | upper", expr: { path: ["vars", "x"], filters: [{ name: "upper" }] } },
      { type: "text", value: " b " },
      { type: "expr", raw: "bad..", expr: null, error: expect.any(String) },
      { type: "text", value: " {{unterminated" },
    ]);
  });
  it("keeps }} inside quotes", () => {
    const t = tokenize("{{vars.x | default:'}}'}}");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ type: "expr", expr: { filters: [{ name: "default", arg: "}}", quoted: true }] } });
  });
  it("parses filter arguments", () => {
    expect(parseExpr("e0.state | fixed:2 | default:'n/a' | time:'HH:mm' | lower")).toEqual({
      path: ["e0", "state"],
      filters: [
        { name: "fixed", arg: "2", quoted: false },
        { name: "default", arg: "n/a", quoted: true },
        { name: "time", arg: "HH:mm", quoted: true },
        { name: "lower" },
      ],
    });
  });
  it("rejects junk", () => {
    expect(() => parseExpr("vars.x extra")).toThrow();
    expect(() => parseExpr("vars.x | ")).toThrow();
    expect(() => parseExpr("| upper")).toThrow();
    expect(() => parseExpr("vars.x | default:'unterminated")).toThrow();
  });
  it("parses conditions", () => {
    expect(parseCond("vars.x | default:'a==b' == 'c'")).toEqual({
      expr: { path: ["vars", "x"], filters: [{ name: "default", arg: "a==b", quoted: true }] },
      op: "==",
      literal: "c",
    });
    expect(parseCond("device.battery<20")).toEqual({ expr: { path: ["device", "battery"], filters: [] }, op: "<", literal: "20" });
    expect(parseCond("vars.x")).toEqual({ expr: { path: ["vars", "x"], filters: [] } });
  });
});

describe("time helpers", () => {
  it("parses and formats in a zone", () => {
    const tz = "Australia/Sydney";
    expect(parseTime(1758441600, tz)).toBe(1758441600000);
    expect(parseTime("2025-09-21T08:00:00Z", tz)).toBe(1758441600000);
    expect(parseTime("2025-09-21T18:00:00", tz)).toBe(1758441600000);
    expect(parseTime("2025-09-21T18:00:00+10:00", tz)).toBe(1758441600000);
    expect(parseTime("2025-09-21T18:00:00+1000", tz)).toBe(1758441600000);
    expect(parseTime("nonsense", tz)).toBeUndefined();
    expect(parseTime("2025-13-01", tz)).toBeUndefined();
    expect(formatTime(1758441600000, "yyyy-MM-dd HH:mm:ss a", tz)).toBe("2025-09-21 18:00:00 pm");
  });
  it("handles DST transition days for zone-less ISO strings", () => {
    const tz = "Australia/Sydney";
    // 2025-10-05: clocks go 02:00 -> 03:00. 01:30 is AEST, 03:30 is AEDT.
    expect(formatTime(parseTime("2025-10-05T01:30:00", tz)!, "HH:mm", tz)).toBe("01:30");
    expect(formatTime(parseTime("2025-10-05T03:30:00", tz)!, "HH:mm", tz)).toBe("03:30");
  });
});

describe("resolveDeep", () => {
  it("walks bodies and headers", () => {
    const ctx: EvalContext = { settings: { tok: "T" }, vars: { on: "on" } };
    expect(
      resolveDeep({ Authorization: "Bearer {{settings.tok}}", nested: { a: ["{{vars.on}}", 1, null] }, c: { if: "vars.on == on", then: "yes" } }, ctx),
    ).toEqual({ Authorization: "Bearer T", nested: { a: ["on", 1, null] }, c: "yes" });
  });
});
