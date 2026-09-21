import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadProfile } from "../src/profiles.js";
import { countLines, lineHeight, measure, wrap } from "../src/wrap.js";

const sample = JSON.parse(readFileSync(new URL("./fixtures/profile.sample.json", import.meta.url), "utf8"));
const p = loadProfile(sample, "t5pro");
// md regular: default 16, " " 8, "i"/"l" 7, "m" 25, "w" 22, "W" 28, "M" 26, "…" 21, "."/"," 8, "A" 18

describe("measure", () => {
  it("sums advances with a default for unknown glyphs", () => {
    expect(measure("", "md", "regular", p)).toBe(0);
    expect(measure("A", "md", "regular", p)).toBe(18);
    expect(measure("AB", "md", "regular", p)).toBe(18 + 16);
    expect(measure("i m", "md", "regular", p)).toBe(7 + 8 + 25);
    expect(measure("é", "md", "regular", p)).toBe(16);
  });
  it("uses the bold table and falls back to regular", () => {
    expect(measure("A", "md", "bold", p)).toBe(19);
    expect(measure("1", "digits", "bold", p)).toBe(68); // digits has no bold face
  });
  it("counts code points, not UTF-16 units", () => {
    expect(measure("😀", "md", "regular", p)).toBe(16);
  });
  it("line heights come from the profile", () => {
    expect(lineHeight("md", p)).toBe(36);
    expect(lineHeight("digits", p)).toBe(150);
  });
});

describe("wrap", () => {
  const md = (text: string, w: number, lines: number) => wrap(text, { w, lines, size: "md", weight: "regular", profile: p });
  it("returns a single fitting line unchanged", () => {
    expect(md("hello", 200, 2)).toEqual(["hello"]);
  });
  it("returns an empty line for empty text", () => {
    expect(md("", 200, 2)).toEqual([""]);
  });
  it("wraps greedily at spaces", () => {
    // "aaa" = 48, " " = 8 → "aaa aaa" = 104
    expect(md("aaa aaa aaa", 110, 3)).toEqual(["aaa aaa", "aaa"]);
    expect(md("aaa aaa aaa", 104, 3)).toEqual(["aaa aaa", "aaa"]);
    expect(md("aaa aaa aaa", 103, 3)).toEqual(["aaa", "aaa", "aaa"]);
  });
  it("keeps consecutive spaces as empty words", () => {
    expect(md("a  b", 200, 2)).toEqual(["a  b"]);
    expect(md("a  b", 40, 3)).toEqual(["a ", "b"]); // greedy: the empty word still fits on line 1
    expect(md("a  b", 20, 3)).toEqual(["a", "", "b"]);
  });
  it("splits paragraphs on newlines", () => {
    expect(md("one\ntwo", 200, 4)).toEqual(["one", "two"]);
    expect(md("one\n\ntwo", 200, 4)).toEqual(["one", "", "two"]);
    expect(md("one\n", 200, 4)).toEqual(["one", ""]);
  });
  it("breaks over-long words at the last fitting character", () => {
    // each 'a' is 16 → 5 per 80px
    expect(md("aaaaaaaaaaaa", 80, 5)).toEqual(["aaaaa", "aaaaa", "aa"]);
  });
  it("starts an over-long word on a fresh line", () => {
    expect(md("bb aaaaaaa", 80, 5)).toEqual(["bb", "aaaaa", "aa"]);
  });
  it("always makes progress when even one character does not fit", () => {
    expect(md("abc", 10, 5)).toEqual(["a", "b", "c"]);
  });
  it("truncates with an ellipsis fitted within w", () => {
    // "aaaaa" = 80; "…" = 21 → "aaa…" = 69 fits in 80, "aaaa…" = 85 does not
    expect(md("aaaaa aaaaa aaaaa", 80, 2)).toEqual(["aaaaa", "aaa…"]);
  });
  it("ellipsises a single line", () => {
    expect(md("aaaaa aaaaa", 80, 1)).toEqual(["aaa…"]);
    expect(md("hello", 30, 1)).toEqual(["…"]);
  });
  it("ellipsises when overflow comes from a newline", () => {
    expect(md("aaa\nbbb", 200, 1)).toEqual(["aaa…"]);
    expect(md("aaa\nbbb", 60, 1)).toEqual(["aa…"]);
  });
  it("does not ellipsise when it exactly fits the line count", () => {
    expect(md("aaa aaa", 60, 2)).toEqual(["aaa", "aaa"]);
  });
  it("drops the ellipsis onto an empty line when nothing fits", () => {
    expect(md("aaaaa aaaaa", 20, 1)).toEqual(["…"]);
  });
  it("uses the bold table", () => {
    // bold: "A" 19, " " 8 → "A A" = 46
    expect(wrap("A A A", { w: 46, lines: 3, size: "md", weight: "bold", profile: p })).toEqual(["A A", "A"]);
  });
  it("counts lines without truncating", () => {
    expect(countLines("aaa aaa aaa aaa", { w: 60, size: "md", weight: "regular", profile: p })).toBe(4);
  });
  it("treats lines below 1 as 1", () => {
    expect(md("aaa aaa", 60, 0)).toEqual(["aa…"]);
  });
});

const wrapFixture = new URL("../../../spec/conformance/wrap.json", import.meta.url);
const fontsFile = new URL("../../../spec/fonts.json", import.meta.url);
const haveWrapFixture = existsSync(wrapFixture) && existsSync(fontsFile);
describe.skipIf(!haveWrapFixture)("spec/conformance/wrap.json", () => {
  if (!haveWrapFixture) return;
  const fx = JSON.parse(readFileSync(wrapFixture, "utf8")) as {
    profile?: string;
    cases: { name?: string; text: string; w: number; lines: number; size?: string; weight?: string; profile?: string; expect: string[] }[];
  };
  const fonts = JSON.parse(readFileSync(fontsFile, "utf8"));
  for (const [i, c] of fx.cases.entries()) {
    it(c.name ?? `case ${i}`, () => {
      const prof = loadProfile(fonts, c.profile ?? fx.profile ?? "t5pro");
      expect(wrap(c.text, { w: c.w, lines: c.lines, size: (c.size ?? "md") as never, weight: (c.weight ?? "regular") as never, profile: prof })).toEqual(c.expect);
    });
  }
});
