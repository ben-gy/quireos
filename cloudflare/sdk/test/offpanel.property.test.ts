/**
 * The off-panel check, as an executable property rather than an argument in a comment.
 *
 * The rule it must obey: **rejecting a widget means that widget could not have reached the panel
 * at its largest possible size.** Every unknown input (a size the device resolves at render time,
 * a malformed line count) must therefore be taken at its maximum, never at a default. That rule
 * was re-derived by hand three times while this check was being written, and was wrong twice: once
 * assuming one line where eight were possible, once assuming a medium size where a conditional
 * could resolve to the largest face. This file checks it mechanically instead.
 *
 * The oracle below is written from the spec, not from the implementation: it computes the largest
 * box a widget could occupy and asks only whether that box can touch the panel.
 */
import { describe, expect, it } from "vitest";
import { validateScreen } from "../src/index.js";

const PANEL = { w: 540, h: 960 };

/** The tallest line and the largest icon each size token can be on any profile (spec/fonts.json). */
const LINE = { xs: 24, sm: 29, md: 36, lg: 44, xl: 56, "2xl": 72, "3xl": 96, digits: 150 } as const;
const ICON = { sm: 24, md: 36, lg: 64 } as const;
const MAX_LINE = Math.max(...Object.values(LINE));
const MAX_ICON = Math.max(...Object.values(ICON));
const MAX_LINES = 8;

type Widget = Record<string, unknown>;

/** The largest box this widget could occupy, from the document alone. */
function largestBox(w: Widget): { x: number; y: number; w: number; h: number } {
  const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const x = n(w.x, 0);
  const y = n(w.y, 0);
  let width: number;
  let height: number;
  if (w.type === "text") {
    // A size the device resolves later could be the largest face; a line count that is not a
    // number could be the largest the spec allows.
    const lh = typeof w.size === "string" ? (LINE[w.size as keyof typeof LINE] ?? MAX_LINE) : MAX_LINE;
    const lines = w.lines === undefined ? 1 : typeof w.lines === "number" ? w.lines : MAX_LINES;
    width = n(w.w, Number.MAX_SAFE_INTEGER);
    height = n(w.h, lh * Math.min(MAX_LINES, Math.max(1, lines)));
  } else if (w.type === "icon") {
    const px = typeof w.size === "string" ? (ICON[w.size as keyof typeof ICON] ?? MAX_ICON) : MAX_ICON;
    width = n(w.w, px);
    height = n(w.h, px);
  } else {
    width = n(w.w, Number.MAX_SAFE_INTEGER);
    height = n(w.h, Number.MAX_SAFE_INTEGER);
  }
  return { x, y, w: width, h: height };
}

function canTouchPanel(w: Widget): boolean {
  const b = largestBox(w);
  return b.x < PANEL.w && b.y < PANEL.h && b.x + b.w > 0 && b.y + b.h > 0;
}

function rejected(w: Widget): boolean {
  const r = validateScreen({ spec_version: 1, id: "home", widgets: [w] }, { screen: PANEL });
  return r.errors.some((e) => e.message.includes("never be seen"));
}

/** A spread of documents: on the panel, bleeding off each edge, and far beyond each edge. */
function* widgets(): Generator<Widget> {
  const coords = [-5000, -1200, -400, -200, -64, -24, -1, 0, 1, 100, 539, 540, 541, 959, 960, 961, 5000];
  const sizes: unknown[] = [undefined, "xs", "md", "digits", { if: "vars.b", then: "digits", else: "xs" }];
  const lineCounts: unknown[] = [undefined, 1, 8, { if: "vars.b", then: 8, else: 1 }, "8"];
  for (const x of coords) {
    for (const y of coords) {
      yield { type: "rect", x, y, w: 100, h: 100 };
      yield { type: "rect", x, y, w: 0, h: 0 };
      for (const size of sizes) {
        for (const lines of lineCounts) {
          const t: Widget = { type: "text", x, y, w: 400, text: "hi" };
          if (size !== undefined) t.size = size;
          if (lines !== undefined) t.lines = lines;
          yield t;
        }
        const i: Widget = { type: "icon", x, y, name: "star" };
        if (size !== undefined) i.size = size;
        yield i;
      }
    }
  }
}

describe("off-panel: rejection implies certainly invisible", () => {
  it("never rejects a widget that could reach the panel at its largest", () => {
    const wrong: string[] = [];
    let count = 0;
    let rejections = 0;
    for (const w of widgets()) {
      count++;
      if (!rejected(w)) continue;
      rejections++;
      if (canTouchPanel(w)) wrong.push(JSON.stringify(w));
    }
    expect(count).toBeGreaterThan(400);
    expect(rejections).toBeGreaterThan(50); // the spread has to actually exercise the branch
    expect(wrong).toEqual([]);
  });

  it("does reject a widget whose largest box is entirely off the panel, when every input is known", () => {
    // Completeness, restricted to documents where nothing has to be estimated.
    const missed: string[] = [];
    for (const w of widgets()) {
      const known = typeof w.w === "number" && typeof w.h === "number";
      if (!known || canTouchPanel(w)) continue;
      if (!rejected(w)) missed.push(JSON.stringify(w));
    }
    expect(missed).toEqual([]);
  });

  it("holds for grid children, which resolve through their cell", () => {
    // Both directions: soundness alone is satisfied by a check that rejects nothing, which is how
    // a whole class of widgets can quietly stop being checked at all.
    const wrong: string[] = [];
    const missed: string[] = [];
    for (const cell of [0, 1, 3, 7]) {
      for (const dx of [-5000, -200, 0, 200, 5000]) {
        for (const dy of [-5000, -200, 0, 200, 5000]) {
          const child = { type: "rect", cell, x: dx, y: dy, w: 100, h: 100 };
          const doc = {
            spec_version: 1,
            id: "home",
            widgets: [{ type: "grid", x: 24, y: 24, cols: 2, rows: 4, cell_w: 238, cell_h: 190, gap: 16, children: [child] }],
          };
          const r = validateScreen(doc, { screen: PANEL });
          const rejects = r.errors.some((e) => e.message.includes("never be seen"));
          // Resolve the cell the way the spec says, then apply the same question.
          const col = cell % 2;
          const row = Math.floor(cell / 2);
          const box = { x: 24 + col * (238 + 16) + dx, y: 24 + row * (190 + 16) + dy, w: 100, h: 100 };
          const touches = box.x < PANEL.w && box.y < PANEL.h && box.x + box.w > 0 && box.y + box.h > 0;
          if (rejects && touches) wrong.push(JSON.stringify(child));
          if (!rejects && !touches) missed.push(JSON.stringify(child));
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(missed).toEqual([]);
  });
});
