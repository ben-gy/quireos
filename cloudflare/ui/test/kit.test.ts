import { describe, it, expect } from "vitest";
import { createKit, profileIds, tokens, Icons, validateScreen, wrap, measure, parseScreen, resolveProfile } from "../src/index.js";

const MM = (px: number, dpi: number, distance: number) => (px / dpi) * 25.4 / distance;

describe("tokens", () => {
  it("keeps every profile's touch targets at 7 mm or more (6 mm for rows)", () => {
    for (const id of profileIds) {
      const p = tokens.profiles[id];
      expect(MM(p.touch_target.min, p.dpi, p.distance)).toBeGreaterThanOrEqual(6.89);
      expect(MM(p.touch_target.row, p.dpi, p.distance)).toBeGreaterThanOrEqual(5.9);
      if (p.touch) expect(p.chrome.nav).toBeGreaterThanOrEqual(p.touch_target.row - 2);
    }
  });
  it("keeps line heights ordered and above the 12 px floor", () => {
    const order = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "digits"] as const;
    for (const id of profileIds) {
      const t = tokens.profiles[id].type;
      for (let i = 1; i < order.length; i++) expect(t[order[i]!].line).toBeGreaterThan(t[order[i - 1]!].line);
      expect(t.xs.line).toBeGreaterThanOrEqual(12);
    }
  });
  it("uses even pixel sizes for everything but strokes", () => {
    for (const id of profileIds) {
      const p = tokens.profiles[id];
      for (const v of [...Object.values(p.space), ...Object.values(p.icon), ...Object.values(p.chrome), ...Object.values(p.touch_target)]) expect(v % 2).toBe(0);
    }
  });
  it("matches the reference profile's firmware line heights", () => {
    expect(tokens.profiles.t5pro.type.md.line).toBe(36);
    expect(tokens.profiles.t5pro.type.digits.line).toBe(150);
    expect(tokens.profiles.t5pro.chrome.nav).toBe(56);
    expect(tokens.profiles.t5pro.space.page).toBe(24);
  });
});

describe("profile resolution", () => {
  it("parses X-Screen and picks the exact profile in either orientation", () => {
    expect(parseScreen("540x960x16@235")).toEqual({ w: 540, h: 960, greys: 16, dpi: 235 });
    expect(resolveProfile({ screen: parseScreen("540x960x16@235") }).id).toBe("t5pro");
    expect(resolveProfile({ screen: parseScreen("960x540x16@235") }).orientation).toBe("landscape");
    expect(resolveProfile({ screen: parseScreen("800x480x2@125") }).id).toBe("panel75");
    expect(resolveProfile({ screen: parseScreen("296x128x2@111") }).id).toBe("badge29");
  });
  it("falls back to the nearest profile and keeps the reported greys", () => {
    const p = resolveProfile({ screen: parseScreen("1200x825x4@150") });
    expect(p.depth).toBe(4);
    expect(p.w).toBe(1200);
  });
});

describe("wrap", () => {
  it("is greedy, breaks long words, and fits the ellipsis", () => {
    const w = measure("t5pro", "md", "regular", "Hello world again");
    expect(wrap("t5pro", "md", "regular", "Hello world again", w)).toEqual(["Hello world again"]);
    expect(wrap("t5pro", "md", "regular", "Hello world again", w - 1).length).toBe(2);
    const lines = wrap("t5pro", "md", "regular", "one two three four five six seven", 120, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(measure("t5pro", "md", "regular", lines[1]!)).toBeLessThanOrEqual(120);
    expect(wrap("t5pro", "md", "regular", "a\n\nb", 500)).toEqual(["a", "", "b"]);
    const long = wrap("t5pro", "md", "regular", "x".repeat(200), 100);
    for (const l of long) expect(measure("t5pro", "md", "regular", l)).toBeLessThanOrEqual(100);
  });
});

describe("components", () => {
  for (const id of profileIds.filter((p) => tokens.profiles[p].class !== "badge")) for (const orientation of ["portrait", "landscape"] as const) {
    it(`builds a valid page with every component on ${id} ${orientation}`, () => {
      const ui = createKit({ profile: id, orientation });
      const screen = ui.page({
        id: "all",
        nav: { title: "Everything", back: true, actions: [{ icon: Icons.refresh, on_tap: { type: "refresh" } }], status: "1 / 3" },
        toolbar: { rows: [ui.pagerRow({ page: 1, pages: 3, prev: { type: "set", vars: { p: 0 } }, next: { type: "set", vars: { p: 2 } } })] },
        body: (f) => ui.stack(f, [
          (b) => ui.heading(b, { text: "A title that is long enough to wrap onto more than one line for sure", lines: 2 }),
          (b) => ui.metaLine(b, { facts: ["675 pts", "273 comments", "1 d", "example.com"] }),
          (b) => ui.listRow(b, { title: "Row", subtitle: "Sub", meta: "meta", trailing: { value: "Value", chevron: true }, on_tap: { type: "back" } }),
          (b) => ui.toggleRow(b, { title: "Toggle", on: "vars.x == on", on_tap: { type: "refresh" } }),
          (b) => ui.checkboxRow(b, { title: "Check", checked: true, on_tap: { type: "refresh" } }),
          (b) => ui.stepper(b, { label: "Steps", value: "3", on_dec: { type: "refresh" }, on_inc: { type: "refresh" } }),
          (b) => ui.segmented(b, { segments: [{ label: "A" }, { label: "B" }], selected: 0 }),
          (b) => ui.chips(b, { chips: [{ label: "One", selected: true }, { label: "Two" }] }),
          (b) => ui.slider(b, { steps: 5, value: 2, on_set: () => ({ type: "refresh" }) }),
          (b) => ui.stat(b, { value: "21.5", unit: "°C", label: "Outside" }),
          (b) => ui.progress(b, { value: 0.4 }),
          (b) => ui.steps(b, { count: 4, current: 2 }),
          (b) => ui.barChart(b, { values: [1, 3, 2], labels: ["a", "b", "c"] }),
          (b) => ui.sparkline(b, { values: [1, 5, 3, 8, 2] }),
          (b) => ui.table(b, { columns: [{ title: "k" }, { title: "v", align: "right" }], rows: [["a", 1]] }),
          (b) => ui.buttonRow(b, { buttons: [{ label: "Cancel" }, { label: "Save", kind: "primary" }] }),
        ]),
        overlay: ui.dialog({ title: "Sure?", message: "Really", primary: { label: "Yes", on_tap: { type: "back" } }, secondary: { label: "No" } }),
      });
      const problems = validateScreen(screen).filter((p) => !p.message.includes("widgets, limit"));
      expect(problems).toEqual([]);
      // every shape sits on the unit grid and inside the screen (text boxes follow line heights, which may be odd)
      for (const w of screen.widgets) {
        if (w.type === "line") continue;
        if (w.type !== "text") {
          expect(w.x % ui.u, `${w.type} x=${w.x}`).toBe(0);
          expect(w.y % ui.u, `${w.type} y=${w.y}`).toBe(0);
        }
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.x + (w.w ?? 0)).toBeLessThanOrEqual(ui.W);
      }
      // the OS corner is clear of hit targets
      const c = ui.cornerRect();
      for (const w of screen.widgets) {
        if (w.type === "line" || !w.on_tap || w.w === undefined || w.h === undefined) continue;
        const hits = w.x < c.x + c.w && w.x + w.w > c.x && w.y < c.y + c.h && w.y + w.h > c.y;
        expect(hits, `${w.type} ${w.id ?? ""} overlaps the OS corner`).toBe(false);
      }
    });
  }
  for (const id of profileIds.filter((p) => tokens.profiles[p].class === "badge")) {
    it(`builds a badge page with the reduced set on ${id}`, () => {
      const ui = createKit({ profile: id });
      const screen = ui.page({
        id: "badge",
        toolbar: { rows: [ui.pagerRow({ page: 1, pages: 2, prev: { type: "back" }, next: { type: "home" } })] },
        body: (f) => ui.stack(f, [
          (b) => ui.stat(b, { value: "21.5", unit: "°C", label: "Outside" }),
          (b) => ui.progress(b, { value: 0.4 }),
        ]),
      });
      expect(validateScreen(screen)).toEqual([]);
      for (const w of screen.widgets) {
        if (w.type === "line" || w.type === "text") continue;
        expect(w.x % ui.u).toBe(0); expect(w.y % ui.u).toBe(0);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.x + (w.w ?? 0)).toBeLessThanOrEqual(ui.W);
      }
    });
  }
  it("moves the toolbar to a rail on landscape handhelds and keeps it at the bottom on portrait", () => {
    const land = createKit({ profile: "t5pro", orientation: "landscape" });
    const s1 = land.page({ id: "a", toolbar: { rows: [[{ icon: Icons.refresh, on_tap: { type: "refresh" } }]] }, body: () => [] });
    expect(s1.widgets.some((w) => w.type === "line" && w.x1 === land.t.chrome.rail - 1)).toBe(true);
    const port = createKit({ profile: "t5pro" });
    const s2 = port.page({ id: "a", toolbar: { rows: [[{ icon: Icons.refresh, on_tap: { type: "refresh" } }]] }, body: () => [] });
    expect(s2.widgets.some((w) => w.type === "line" && w.y1 === port.H - port.t.chrome.toolbar)).toBe(true);
  });
  it("gives every profile a two-column tile grid that meets the recommended target", () => {
    for (const id of profileIds) {
      const ui = createKit({ profile: id });
      const f = ui.frame({ nav: true });
      const g = ui.tileGrid(f, { cols: 2, rows: 4, tiles: Array.from({ length: 8 }, (_, i) => ({ label: `Tile ${i}`, on: i % 2 === 0, on_tap: { type: "refresh" } })) });
      const grid = g.widgets[0]!;
      expect(grid.type).toBe("grid");
      if (grid.type === "grid") {
        expect(grid.cell_h).toBeGreaterThanOrEqual(ui.t.touch_target.recommended);
        expect(grid.children.length).toBe(8);
      }
    }
  });
  it("rejects an icon this firmware cannot draw, and says which kind of mistake it is", () => {
    const ui = createKit({ profile: "t5pro" });
    const screen = (name: string) => ({ spec_version: 1 as const, id: "t", widgets: [ui.icon({ x: 0, y: 0, name })] });
    // A name the library knows but the firmware does not compile: the author can pick another.
    const extended = validateScreen(screen("airplane"));
    expect(extended.length).toBe(1);
    expect(extended[0]!.message).toContain("not compiled into this firmware");
    // A name that is not an icon at all.
    const nonsense = validateScreen(screen("totally-made-up"));
    expect(nonsense.length).toBe(1);
    expect(nonsense[0]!.message).toContain("unknown icon");
    // Everything the kit itself draws must be compiled, or the OS screens ship blanks.
    for (const name of [Icons.store, Icons.paired, Icons.account, Icons.back, Icons.settings, Icons.update_available]) {
      expect(validateScreen(screen(name)), `${name} is not compiled`).toEqual([]);
    }
  });
  it("catches a widget laid out past the glass even when page() never ran", () => {
    const ui = createKit({ profile: "t5pro" });
    // Assembled by hand, the way an app author might, without going through ui.page().
    const below = { spec_version: 1 as const, id: "hand", widgets: [ui.text({ x: 24, y: 2000, w: 400, text: "past the bottom" })] };
    const problems = ui.validate(below);
    expect(problems.length).toBe(1);
    expect(problems[0]!.message).toContain("can never be seen");
    // Every edge, not just the two a widget can "start" past: something at x = -200 with w = 100
    // ends before the left edge and is just as invisible.
    const invisible = [
      ui.rect({ x: ui.W + 10, y: 10, w: 100, h: 40, fill: "ink" }),
      ui.rect({ x: 10, y: ui.H + 10, w: 100, h: 40, fill: "ink" }),
      ui.rect({ x: -200, y: 10, w: 100, h: 40, fill: "ink" }),
      ui.rect({ x: 10, y: -200, w: 100, h: 100, fill: "ink" }),
    ];
    for (const w of invisible) {
      const r = ui.validate({ spec_version: 1 as const, id: "off", widgets: [w] });
      expect(r.length, `${JSON.stringify(w)} was accepted`).toBe(1);
      expect(r[0]!.message).toContain("can never be seen");
    }
    // A size the device resolves at render time may be far taller than it looks: the estimate has
    // to be an upper bound, or the check rejects widgets that are in fact visible.
    const conditional = [
      { type: "text" as const, x: 24, y: -100, w: 400, text: "21.5", size: { if: "vars.big == on", then: "digits" as const, else: "md" as const }, lines: 1 },
      { type: "icon" as const, x: 10, y: -50, name: "home-outline", size: { if: "vars.big == on", then: "lg" as const, else: "md" as const } },
    ];
    for (const w of conditional) {
      expect(ui.validate({ spec_version: 1 as const, id: "cond", widgets: [w] }), `${w.type} with a conditional size was rejected`).toEqual([]);
    }
    // The bound stays tight enough to still catch what is genuinely off the panel.
    expect(ui.validate({ spec_version: 1 as const, id: "cond2", widgets: [
      { type: "text" as const, x: 24, y: -400, w: 400, text: "gone", size: { if: "vars.big == on", then: "digits" as const, else: "md" as const }, lines: 1 },
    ] }).length).toBe(1);
    // A widget that overlaps an edge is clipped, which is sometimes deliberate.
    for (const w of [
      ui.rect({ x: 0, y: ui.H - 8, w: ui.W, h: 200, fill: "ink" }),
      ui.rect({ x: -40, y: 10, w: 100, h: 40, fill: "ink" }),
      ui.rect({ x: 10, y: -40, w: 100, h: 100, fill: "ink" }),
    ]) {
      expect(ui.validate({ spec_version: 1 as const, id: "bleed", widgets: [w] }), `${JSON.stringify(w)} was rejected`).toEqual([]);
    }
    // Grid children are resolved through their cell before being judged.
    const grid = ui.tileGrid({ x: ui.margin, y: ui.H - 40, w: ui.contentW, h: 400 }, {
      cols: 2, rows: 4, tiles: Array.from({ length: 8 }, (_, i) => ({ label: `T${i}` })),
    });
    const offCells = ui.validate({ spec_version: 1 as const, id: "grid", widgets: grid.widgets });
    expect(offCells.length).toBeGreaterThan(0);
  });
  it("never reports a widget that could be visible, across a generated space of documents", () => {
    // The invariant this check lives by: it may be too quiet, but it must never be wrong. Stated
    // as a property rather than prose, because prose is what kept having to be re-derived by hand.
    //
    // Verified by mutation rather than trusted, and aimed at each half separately, because a
    // mutation that only probes soundness says nothing about the half that can quietly stop
    // checking. Every one of these was reintroduced and confirmed to fail this suite:
    //   soundness     a conditional `size` falling back to md, or an icon's to md
    //                 a non-numeric `lines` falling back to one line
    //   completeness  dropping the left edge, or the top edge
    //                 skipping grid children, or only the `line` ones among them
    //                 treating an ABSENT size as unknown rather than as the spec's default
    // Two of those are worth remembering. The `lines` one gave the right answer before this
    // rewrite only because the arithmetic produced NaN and every comparison against NaN is false.
    // The absent-size one is sound and still blind: it stops reporting every widget that did not
    // state a size, which is most of them, and only the completeness half sees it.
    const ui = createKit({ profile: "t5pro" });
    const BIGGEST_LINE = ui.lh("digits"), BIGGEST_ICON = ui.t.icon.lg, MAX_LINES = 8;
    const coords = [-2000, -400, -150, -40, -1, 0, 1, 100, ui.W - 1, ui.W, ui.W + 1, ui.H - 1, ui.H, ui.H + 400];
    const sizes: unknown[] = ["xs", "md", "digits", { if: "vars.b == on", then: "digits", else: "xs" }, undefined];
    const lines: unknown[] = [undefined, 1, 8, { if: "vars.b == on", then: 8, else: 1 }];
    let flagged = 0, checked = 0, missed = 0;
    for (const x of coords) for (const y of coords) for (const size of sizes) for (const ln of lines) {
      for (const w of [
        { type: "text" as const, x, y, w: 200, text: "t", ...(size !== undefined ? { size } : {}), ...(ln !== undefined ? { lines: ln } : {}) },
        { type: "icon" as const, x, y, name: "home-outline", ...(size !== undefined ? { size } : {}) },
        { type: "rect" as const, x, y, w: 200, h: 40, fill: 0 },
      ] as unknown[]) {
        checked++;
        const problems = ui.validate({ spec_version: 1 as const, id: "p", widgets: [w as never] });
        const offPanel = problems.filter((p) => p.message.includes("never be seen"));
        // Independently compute the LARGEST the widget could possibly be — taking a field the
        // document states literally at its word, and a field the device resolves later at its
        // maximum — then assert that even at that size it cannot touch the panel.
        const d = w as { type: string; x: number; y: number; w?: number; h?: number; size?: unknown; lines?: unknown };
        // Three cases, matching the spec: absent means the default `md`, a literal means itself,
        // and only something the device resolves later is unknown and takes the largest.
        const literalSize = d.size === undefined ? "md" : typeof d.size === "string" ? d.size : null;
        const lineH = literalSize ? ui.lh(literalSize as never) : BIGGEST_LINE;
        const nLines = d.lines === undefined ? 1 : typeof d.lines === "number" ? d.lines : MAX_LINES;
        const iconPx = literalSize === "sm" || literalSize === "md" || literalSize === "lg" ? ui.t.icon[literalSize] : BIGGEST_ICON;
        const maxW = d.type === "icon" ? iconPx : (d.w ?? ui.W);
        const maxH = d.type === "icon" ? iconPx : d.type === "text" ? lineH * nLines : (d.h ?? ui.H);
        const intersects = d.x < ui.W && d.y < ui.H && d.x + maxW > 0 && d.y + maxH > 0;
        if (offPanel.length > 0) {
          // Soundness: what it rejects must really be unreachable, even at its largest.
          flagged++;
          expect(intersects, `flagged ${JSON.stringify(w)} but at its largest it reaches the panel`).toBe(false);
        } else if (!intersects && literalSize !== null && typeof d.lines !== "object") {
          // Completeness, but only where nothing had to be estimated: with a literal size and a
          // literal line count there is no slack left, so an unreachable widget must be reported.
          missed++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(flagged).toBeGreaterThan(20);   // the check is doing something, not vacuously passing
    expect(missed).toBe(0);
  });
  it("holds the same rule for grid children, in both directions", () => {
    // Soundness alone would be satisfied by a check that skips every grid child, which is a whole
    // class of widgets going unchecked with nothing to say so. Inside a grid a child that omits
    // w/h fills its cell, so no dimension is ever estimated and completeness applies everywhere.
    const ui = createKit({ profile: "t5pro" });
    const cellW = 200, cellH = 100, gap = 8, cols = 2, rows = 3;
    const offsets = [-600, -250, -40, 0, 40, 300, 900];
    let flagged = 0, missed = 0, checked = 0;
    for (const gy of [-400, -80, 0, 300, ui.H - 40, ui.H + 40]) {
      for (const gx of [-500, -40, 0, ui.margin, ui.W - 20, ui.W + 40]) {
        for (const off of offsets) {
          for (let cell = 0; cell < cols * rows; cell++) {
            const kids = [
              { type: "rect" as const, x: off, y: off, w: 60, h: 30, fill: 0, cell },
              { type: "icon" as const, x: off, y: off, name: "home-outline", cell },
              { type: "text" as const, x: off, y: off, w: 80, text: "t", size: "md" as const, cell },
              { type: "line" as const, x1: off, y1: off, x2: off + 40, y2: off, cell },
              { type: "rect" as const, w: 10, h: 10, fill: 0, cell },   // no x/y: fills the cell
            ];
            const grid = { type: "grid" as const, x: gx, y: gy, cols, rows, cell_w: cellW, cell_h: cellH, gap, children: kids };
            const problems = ui.validate({ spec_version: 1 as const, id: "g", widgets: [grid as never] });
            kids.forEach((c, j) => {
              checked++;
              const cx = gx + (cell % cols) * (cellW + gap), cy = gy + Math.floor(cell / cols) * (cellH + gap);
              const b = c.type === "line"
                ? { x: cx + Math.min(c.x1!, c.x2!), y: cy + Math.min(c.y1!, c.y2!), w: Math.abs(c.x2! - c.x1!) + 1, h: 1 }
                : { x: cx + (c.x ?? 0), y: cy + (c.y ?? 0),
                    w: c.type === "icon" ? ui.t.icon.md : (c.w ?? cellW),
                    h: c.type === "icon" ? ui.t.icon.md : c.type === "text" ? ui.lh("md") : (c.h ?? cellH) };
              const reaches = b.x < ui.W && b.y < ui.H && b.x + b.w > 0 && b.y + b.h > 0;
              const said = problems.some((p) => p.path === `/widgets/0/children/${j}` && p.message.includes("never be seen"));
              if (said) { flagged++; expect(reaches, `flagged child ${j} of ${JSON.stringify(grid)} but it reaches the panel`).toBe(false); }
              else if (!reaches) { missed++; }
            });
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(flagged).toBeGreaterThan(20);
    expect(missed, "a grid child that cannot reach the panel went unreported").toBe(0);
  });
  it("collects button-only keys from the pager", () => {
    const ui = createKit({ profile: "panel75" });
    const s = ui.page({ id: "p", toolbar: { rows: [ui.pagerRow({ page: 2, pages: 3, prev: { type: "back" }, next: { type: "home" } })], placement: "bottom" }, body: () => [] });
    expect(s.keys).toEqual({ double: { type: "back" }, short: { type: "home" } });
  });
  it("drops disabled glyphs on 1-bit panels instead of greying them", () => {
    const ui = createKit({ profile: "panel75", orientation: "landscape" });
    const s = ui.page({ id: "p", toolbar: { rows: [ui.pagerRow({ page: 1, pages: 3, prev: { type: "back" }, next: { type: "home" } })], placement: "bottom" }, body: () => [] });
    const icons = s.widgets.filter((w) => w.type === "icon");
    expect(icons.length).toBe(1);
  });
  it("never lets a page overflow its frame", () => {
    for (const id of profileIds) {
      const ui = createKit({ profile: id });
      const rows = Array.from({ length: 40 }, (_, i) => (b: any) => ui.listRow(b, { title: `Row ${i}`, on_tap: { type: "refresh" } }));
      const screen = ui.page({ id: "long", nav: { title: "Long" }, toolbar: { rows: [[{ icon: Icons.home, on_tap: { type: "home" } }]] }, body: (f) => ui.paged(f, rows, { page: 2 }) });
      expect(ui.overflow, `${id} overflowed by ${ui.overflow?.by}`).toBe(null);
      expect(ui.validate(screen).filter((p) => p.message.includes("cannot scroll"))).toEqual([]);
      expect(ui.pageCount).toBeGreaterThan(1);
    }
  });
  it("reports overflow rather than clipping", () => {
    const ui = createKit({ profile: "t5pro" });
    const rows = Array.from({ length: 40 }, (_, i) => (b: any) => ui.listRow(b, { title: `Row ${i}` }));
    ui.page({ id: "over", nav: { title: "Over" }, body: (f) => ui.stack(f, rows, 0) });
    expect(ui.overflow).not.toBe(null);
    expect(ui.overflow!.by).toBeGreaterThan(0);
  });
  it("keeps every block on the vertical rhythm", () => {
    for (const id of profileIds) {
      const ui = createKit({ profile: id });
      const b = { x: ui.margin, y: ui.t.chrome.nav, w: ui.contentW };
      const r = ui.t.space.rhythm;
      for (const [name, piece] of [
        ["1-line row", ui.listRow(b, { title: "One", on_tap: { type: "refresh" } })],
        ["2-line row", ui.listRow(b, { title: "One", subtitle: "Two", on_tap: { type: "refresh" } })],
        ["3-line row", ui.listRow(b, { title: "One", subtitle: "Two", meta: "Three" })],
        ["section", ui.sectionHeader(b, { text: "Group" })],
        ["stat", ui.stat(b, { value: "21.5", unit: "°C", label: "Outside" })],
        ["key-value", ui.keyValue(b, { key: "Battery", value: "72%" })],
        ["stepper", ui.stepper(b, { label: "Level", value: "3", on_dec: { type: "refresh" }, on_inc: { type: "refresh" } })],
      ] as const) {
        expect(piece.h % r, `${id} ${name} h=${piece.h}`).toBe(0);
      }
    }
  });
  it("paginates text into pages that fit", () => {
    const ui = createKit({ profile: "t5pro" });
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`).join("\n\n");
    const pages = ui.paginate(492, 700, { text });
    expect(pages.length).toBeGreaterThan(1);
    for (const pg of pages) {
      const p = ui.paragraph({ x: 0, y: 0, w: 492 }, { text: pg });
      expect(p.h).toBeLessThanOrEqual(700);
    }
  });
});
