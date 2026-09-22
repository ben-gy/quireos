/**
 * Geometry, theme and chrome shared by every screen, plus the pixel-height paginator used by the
 * comments and article screens (a port of hn-t5/src/ui.cpp: layoutDoc / renderDoc).
 *
 * Portrait 540×960 is the primary layout; any other size (landscape 960×540 in particular) gets
 * the same chrome with the content split into two columns.
 */
import { button, cond, icon, line, lineHeight, measure, rect, t5pro, text, utf8Length, wrap } from "@quireos/sdk";
import type { Action, Profile, TextSize, Value, Widget } from "@quireos/sdk";

export const profile: Profile = t5pro;
export const MARGIN = 24;
export const HEADER_H = 44;
export const BAR_ROW = 44;
export const COMMENT_GAP = 18;
export const INDENT_PX = 22;
export const MAX_DEPTH = 5;
/** Longest text a single widget carries (spec: any string ≤ 512 bytes). */
export const TEXT_BYTES = 480;
export const MAX_LINES = 8;

export interface Geo {
  W: number;
  H: number;
  landscape: boolean;
  M: number;
  cols: number;
  gutter: number;
  colW: number;
  contentW: number;
  headerH: number;
  contentTop: number;
  contentBot: number;
  contentH: number;
  footerH: number;
  footerTop: number;
}

export function geometry(screen: { w: number; h: number }, footerRows: number): Geo {
  const W = screen.w;
  const H = screen.h;
  const landscape = W > H;
  const cols = landscape ? 2 : 1;
  const gutter = 24;
  const contentW = W - 2 * MARGIN;
  const colW = cols === 1 ? contentW : Math.floor((contentW - gutter * (cols - 1)) / cols);
  const footerH = footerRows * BAR_ROW;
  const footerTop = H - footerH;
  const contentTop = HEADER_H + 6;
  const contentBot = footerTop - (footerRows ? 6 : 8);
  return { W, H, landscape, M: MARGIN, cols, gutter, colW, contentW, headerH: HEADER_H, contentTop, contentBot, contentH: contentBot - contentTop, footerH, footerTop };
}

export function colX(g: Geo, c: number): number {
  return g.M + c * (g.colW + g.gutter);
}

export interface Theme {
  dark: boolean;
  paper: number;
  ink: number;
  dim: number;
  faint: number;
  read: number;
  readFacts: number;
  rule: number;
}

/** Light: ink on paper. Dark: a true inversion (paper 0, ink 15, greys mirrored). */
export function theme(dark: boolean): Theme {
  return dark
    ? { dark, paper: 0, ink: 15, dim: 8, faint: 4, read: 7, readFacts: 5, rule: 15 }
    : { dark, paper: 15, ink: 0, dim: 7, faint: 11, read: 9, readFacts: 11, rule: 0 };
}

/** Full-screen paper; only needed in dark mode. */
export function background(g: Geo, t: Theme): Widget[] {
  return t.dark ? [rect({ x: 0, y: 0, w: g.W, h: g.H, fill: 0 })] : [];
}

/** The OS draws its status glyphs in a 48 px square whose right edge is `margin` from the screen edge (§6); the status text stops before it. */
const CORNER = 48;
const STATUS_W = 260;
/** A condition that is always true (there are no literals in conditions): used for static `disabled`. */
export const ALWAYS = "device.w > 0";

/** Title (optionally with a back chevron) on the left, status on the right, a rule beneath. */
export function header(g: Geo, t: Theme, opts: { title: string; pageInfo?: string; back?: Action }): Widget[] {
  const out: Widget[] = [];
  let x = g.M;
  if (opts.back) {
    out.push(icon({ x: g.M - 6, y: 6, name: "chevron-left", size: "sm", color: t.ink }));
    x += 30;
  }
  const statusRight = g.W - g.M - CORNER - 8;
  out.push(text({ x, y: 8, w: statusRight - STATUS_W - x - 8, text: opts.title, size: "sm", color: t.ink }));
  const left = opts.pageInfo ? `${opts.pageInfo}   ` : "";
  out.push(
    text({
      x: statusRight - STATUS_W,
      y: 8,
      w: STATUS_W,
      align: "right",
      size: "sm",
      color: t.dim,
      text: cond("device.battery >= 0", `${left}{{device.battery}}%   {{device.time | time:'HH:mm'}}`, `${left}{{device.time | time:'HH:mm'}}`),
    }),
  );
  out.push(line({ x1: g.M, y1: g.headerH - 1, x2: g.W - g.M, y2: g.headerH - 1, color: t.rule }));
  if (opts.back) out.push(rect({ x: 0, y: 0, w: statusRight - STATUS_W, h: g.headerH, on_tap: opts.back, feedback: "invert" }));
  return out;
}

export interface Cell {
  id?: string;
  icon?: string;
  label?: string;
  on_tap?: Action;
  /** Greyed out (nowhere to go). */
  dim?: boolean;
  /** Non-interactive text (the page counter). */
  plain?: boolean;
  /** Draws a small chevron after the label. */
  menu?: boolean;
}

/** Bottom bar: one or more rows of equal-width cells drawn as flat buttons with hairline separators. */
export function toolbar(g: Geo, t: Theme, rows: Cell[][]): Widget[] {
  const out: Widget[] = [];
  const top = g.footerTop;
  out.push(line({ x1: g.M, y1: top, x2: g.W - g.M, y2: top, color: t.faint }));
  rows.forEach((row, r) => {
    const y = top + r * BAR_ROW;
    if (r) out.push(line({ x1: g.M, y1: y, x2: g.W - g.M, y2: y, color: t.faint }));
    const n = row.length;
    const w = Math.floor(g.contentW / n);
    row.forEach((c, i) => {
      const x = g.M + i * w;
      if (i) out.push(line({ x1: x, y1: y + 1, x2: x, y2: y + BAR_ROW - 1, color: t.faint }));
      if (c.plain) {
        out.push(text({ x, y, w, h: BAR_ROW, text: c.label ?? "", size: "sm", align: "center", valign: "middle", color: t.dim }));
        return;
      }
      const color = c.dim ? t.dim : t.ink;
      out.push(
        button({
          id: c.id,
          x,
          y,
          w,
          h: BAR_ROW,
          label: c.label ?? "",
          icon: c.icon,
          size: "sm",
          fill: null,
          stroke: null,
          radius: 0,
          color,
          disabled: c.dim ? ALWAYS : undefined,
          on_tap: c.on_tap,
          feedback: c.on_tap ? "invert" : "none",
        }),
      );
      if (c.menu && c.label) {
        const tw = measure(c.label, "sm", "bold", profile);
        out.push(icon({ x: x + Math.floor(w / 2 + tw / 2) - 2, y: y + 6, name: "chevron-down", size: "sm", color, on_tap: c.on_tap }));
      }
    });
  });
  return out;
}

/** Joins facts with dots, dropping whole facts from the end until the line fits. */
export function fitFacts(segs: string[], w: number, size: TextSize = "xs"): string {
  const parts = segs.filter((s) => s.length > 0);
  while (parts.length > 1 && measure(parts.join(" · "), size, "regular", profile) > w) parts.pop();
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Paged documents

/** 0 body · 1 byline · 2 heading · 3 facts · 4 paragraph gap · 5 comment gap */
export type Style = 0 | 1 | 2 | 3 | 4 | 5;

export interface RLine {
  text: string;
  indent: number;
  style: Style;
  /** Comment index for bylines, else -1. */
  cidx: number;
  h: number;
}

export interface DocStyle {
  body: TextSize;
  bodyLH: number;
  headingLH: number;
  bylineLH: number;
  factsLH: number;
}

export function docStyle(body: TextSize): DocStyle {
  return { body, bodyLH: lineHeight(body, profile), headingLH: lineHeight("md", profile), bylineLH: lineHeight("xs", profile) + 4, factsLH: lineHeight("xs", profile) };
}

/** Wraps `text` at `w` (minus a 2 px guard) and appends one line per output line; blank lines become paragraph gaps. */
export function pushWrapped(doc: RLine[], txt: string, w: number, indent: number, style: 0 | 2, ds: DocStyle): void {
  const size: TextSize = style === 2 ? "md" : ds.body;
  const weight = style === 2 ? "bold" : "regular";
  const lh = style === 2 ? ds.headingLH : ds.bodyLH;
  let lastBlank = true;
  for (const ln of wrap(txt, { w: Math.max(20, w - indent - 2), lines: Number.MAX_SAFE_INTEGER, size, weight, profile })) {
    if (ln.trim() === "") {
      if (!lastBlank) doc.push({ text: "", indent, style: 4, cidx: -1, h: Math.floor(ds.bodyLH / 3) });
      lastBlank = true;
      continue;
    }
    lastBlank = false;
    doc.push({ text: ln, indent, style, cidx: -1, h: lh });
  }
}

export function gap(doc: RLine[], style: 4 | 5, ds: DocStyle, indent = 0): void {
  doc.push({ text: "", indent, style, cidx: -1, h: style === 4 ? Math.floor(ds.bodyLH / 3) : COMMENT_GAP });
}

/**
 * Splits lines into slots of at most `contentH` pixels (a line never straddles a slot boundary;
 * a slot always takes at least one line). Returns slot start indexes with a trailing `lines.length`.
 */
export function layoutDoc(lines: RLine[], contentH: number): number[] {
  const starts = [0];
  let y = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i]!.h;
    if (y + h > contentH && i > starts[starts.length - 1]!) {
      starts.push(i);
      y = 0;
    }
    y += h;
  }
  starts.push(lines.length);
  return starts;
}

export function pageCount(starts: number[], cols: number): number {
  const slots = Math.max(1, starts.length - 1);
  return Math.max(1, Math.ceil(slots / cols));
}

export interface RenderOpts {
  ds: DocStyle;
  /** Action for a byline tap (folding); absent on articles. */
  fold?: (cidx: number) => Action;
}

/** Widgets for one page: `cols` consecutive slots laid out side by side. */
export function renderDocPage(lines: RLine[], starts: number[], page: number, g: Geo, t: Theme, opts: RenderOpts): Widget[] {
  const out: Widget[] = [];
  for (let c = 0; c < g.cols; c++) {
    const slot = page * g.cols + c;
    if (slot + 1 >= starts.length) break;
    renderSlot(lines, starts[slot]!, starts[slot + 1]!, colX(g, c), g, t, opts, out);
  }
  return out;
}

function renderSlot(lines: RLine[], from: number, to: number, x0: number, g: Geo, t: Theme, opts: RenderOpts, out: Widget[]): void {
  let y = g.contentTop;
  // coalesced run of body/heading/facts lines
  let run: { style: Style; indent: number; y: number; texts: string[]; bytes: number; lh: number } | null = null;
  let bar: { indent: number; y: number } | null = null;

  const flushRun = () => {
    if (!run) return;
    const n = run.texts.length;
    const size: Value<TextSize> = run.style === 2 ? "md" : run.style === 3 ? "xs" : opts.ds.body;
    out.push(
      text({
        x: x0 + run.indent,
        y: run.y,
        w: g.colW - run.indent,
        h: n * run.lh,
        text: run.texts.join("\n"),
        size,
        weight: run.style === 2 ? "bold" : undefined,
        color: run.style === 3 ? t.dim : t.ink,
        lines: n > 1 ? n : undefined,
      }),
    );
    run = null;
  };
  const flushBar = () => {
    if (!bar) return;
    if (y > bar.y) out.push(rect({ x: x0 + bar.indent - 12, y: bar.y, w: 2, h: y - bar.y, fill: t.faint }));
    bar = null;
  };

  for (let i = from; i < to; i++) {
    const l = lines[i]!;
    const drawsBar = l.indent > 0 && (l.style === 0 || l.style === 1);
    if (!drawsBar || (bar && bar.indent !== l.indent)) flushBar();
    if (drawsBar && !bar) bar = { indent: l.indent, y };

    if (l.style === 0 || l.style === 2 || l.style === 3) {
      const bytes = utf8Length(l.text) + 1;
      if (run && (run.style !== l.style || run.indent !== l.indent || run.texts.length >= MAX_LINES || run.bytes + bytes > TEXT_BYTES)) flushRun();
      if (!run) run = { style: l.style, indent: l.indent, y, texts: [], bytes: 0, lh: l.h };
      run.texts.push(l.text);
      run.bytes += bytes;
    } else {
      flushRun();
      if (l.style === 1) {
        const lift = Math.min(12, y - g.contentTop);
        out.push(
          text({
            x: x0 + l.indent,
            y: y - lift,
            w: g.colW - l.indent,
            h: l.h + lift,
            text: l.text,
            size: "xs",
            color: t.dim,
            valign: "bottom",
            on_tap: opts.fold && l.cidx >= 0 ? opts.fold(l.cidx) : undefined,
            feedback: opts.fold && l.cidx >= 0 ? "invert" : undefined,
          }),
        );
      }
    }
    y += l.h;
  }
  flushRun();
  flushBar();
}

/** Title rows for the story list: up to three bold `md` lines, the last ellipsised. */
export function titleLines(title: string, w: number): string[] {
  const lines = wrap(title, { w: Math.max(20, w - 2), lines: 3, size: "md", weight: "bold", profile });
  return lines.length ? lines : [""];
}
