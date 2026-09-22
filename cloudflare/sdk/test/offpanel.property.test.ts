/**
 * The off-panel check, as an executable property rather than an argument in a comment.
 *
 * The rule it must obey: **a widget is reported exactly when it cannot reach the panel at its
 * largest possible size.** Stated as an equivalence rather than two implications, because
 * soundness alone is satisfied by a check that reports nothing and completeness alone by one that
 * reports everything, and an "if and only if" leaves nowhere to exempt a case. A class of widgets
 * quietly stopped being checked twice in this file's history.
 *
 * Three cases per input, not two: a value the document omits is the spec's default, a literal is
 * itself, and only a value the device resolves later is unknown and taken at its maximum.
 *
 * The oracle below is written from SPEC §6.2, not from the implementation. That matters more than
 * it sounds: an oracle edited to agree with the code cannot find a bug in the code, and the
 * absent-size defect survived here until the oracle was rewritten from the spec.
 *
 * Fifteen mutations are known to fail this file — three that make it report something visible,
 * six that make it stay silent about something invisible, two that break grid geometry, and one
 * off-by-one per panel edge. A property is only as strong as its oracle's independence, the
 * breadth of what it generates, and whether it samples where the answer changes; each of those
 * three was missing here at some point, and each hid a real defect.
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
    // SPEC §6.2: an absent size is `md`. Only a value the device resolves later is unknown.
    const lh = w.size === undefined ? LINE.md : typeof w.size === "string" ? (LINE[w.size as keyof typeof LINE] ?? MAX_LINE) : MAX_LINE;
    const lines = w.lines === undefined ? 1 : typeof w.lines === "number" ? w.lines : MAX_LINES;
    width = n(w.w, Number.MAX_SAFE_INTEGER);
    height = n(w.h, lh * Math.min(MAX_LINES, Math.max(1, lines)));
  } else if (w.type === "icon") {
    const px = w.size === undefined ? ICON.md : typeof w.size === "string" ? (ICON[w.size as keyof typeof ICON] ?? MAX_ICON) : MAX_ICON;
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
  // Sample where the answer can change. A fixed spread is only as sensitive as its gaps: an icon
  // bound of 36 and one of 64 agree everywhere except between them, so straddle every size the
  // spec can produce, and every panel edge.
  const bounds = [...new Set([...Object.values(LINE), ...Object.values(ICON)])];
  const coords = [
    ...new Set([
      -5000, -1200, -400, -200, -1, 0, 1, 100, 5000,
      ...bounds.flatMap((b) => [-b - 1, -b, -b + 1]),
      ...[PANEL.w, PANEL.h].flatMap((e) => [e - 1, e, e + 1]),
    ]),
  ].sort((a, b) => a - b);
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

describe("off-panel: reported exactly when unreachable", () => {
  it("reports a widget exactly when it cannot reach the panel", () => {
    // One equivalence rather than two implications. Soundness alone is satisfied by a check that
    // reports nothing, and completeness alone by one that reports everything; stating it as "if
    // and only if" leaves nowhere to exempt a case, which is how a class of widgets quietly
    // stopped being checked twice in this file's history.
    const disagreed: string[] = [];
    let count = 0;
    let unreachable = 0;
    for (const w of widgets()) {
      count++;
      const canReach = canTouchPanel(w);
      if (!canReach) unreachable++;
      if (rejected(w) !== !canReach) disagreed.push(`${canReach ? "reported but reachable" : "unreachable but silent"}: ${JSON.stringify(w)}`);
    }
    expect(count).toBeGreaterThan(400);
    expect(unreachable).toBeGreaterThan(200); // the spread has to exercise both sides
    expect(count - unreachable).toBeGreaterThan(200);
    expect(disagreed).toEqual([]);
  });

  it("holds for grid children, which resolve through their cell", () => {
    // The same equivalence, through a cell offset.
    const wrong: string[] = [];
    const missed: string[] = [];
    // Every child type, not just rect: a check that skips one type is sound and silent.
    const kinds: Widget[] = [
      { type: "rect", w: 100, h: 100 },
      { type: "text", w: 100, h: 100, text: "hi" },
      { type: "icon", w: 100, h: 100, name: "star" },
      { type: "button", w: 100, h: 100, label: "go" },
      { type: "image", w: 100, h: 100, src: "/i.png" },
      { type: "line", x1: 0, y1: 0, x2: 100, y2: 100 },
    ];
    for (const kind of kinds)
    for (const cell of [0, 1, 3, 7]) {
      for (const dx of [-5000, -200, 0, 200, 5000]) {
        for (const dy of [-5000, -200, 0, 200, 5000]) {
          // A line is positioned by its endpoints, not by x/y (SPEC §6.2), so offset those instead.
          const child = (kind.type === "line"
            ? { ...kind, cell, x1: dx, y1: dy, x2: dx + 100, y2: dy + 100 }
            : { ...kind, cell, x: dx, y: dy }) as Widget;
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
          const ox = 24 + col * (238 + 16) + dx;
          const oy = 24 + row * (190 + 16) + dy;
          const box = { x: ox, y: oy, w: 100, h: 100 };
          const touches = box.x < PANEL.w && box.y < PANEL.h && box.x + box.w > 0 && box.y + box.h > 0;
          if (rejects !== !touches) (touches ? wrong : missed).push(JSON.stringify(child));
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(missed).toEqual([]);
  });
});
