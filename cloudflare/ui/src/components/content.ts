// Content components: headings, list rows, sections, cards, tiles, stats, text blocks, meta
// lines, pills, badges, progress, charts, tables, images, empty states, status glyphs.
//
// Two rules run through all of them. A row's title is set in the regular weight and its supporting
// text in the secondary tone, so a list reads as one column of text rather than a wall of bold.
// Every block's height is a multiple of the rhythm (2u), so a column of mixed components keeps a
// visible beat.
import type { Kit } from "../kit.js";
import type { Action, Box, Condition, Frame, Piece, Value, Widget, TextSize, ButtonWidget, GridChild, Weight } from "../types.js";
import type { ToneName, RoleName } from "../profile.js";
import { Icons, batteryIconFor, wifiIconFor, type IconName } from "../icons.js";
import { toggle } from "./controls.js";
import { batteryStepped, wifiStepped } from "./chrome.js";

const DIGITS = /^[0-9 :.\-°%]+$/;

// ------------------------------------------------------------------------------ heading ---
export interface HeadingOptions { text: string; role?: RoleName; lines?: number; align?: "left" | "center" | "right"; tone?: ToneName; id?: string }
export function heading(k: Kit, box: Box, o: HeadingOptions): Piece {
  const role = o.role ?? "title";
  const r = k.role(role);
  const max = o.lines ?? 3;
  const n = Math.min(max, Math.max(1, k.wrap(o.text, r.size as TextSize, r.weight as Weight, box.w, max).length));
  return { widgets: [k.text({ x: box.x, y: box.y, w: box.w, text: o.text, role, lines: n, align: o.align, tone: o.tone, id: o.id })], h: k.lh(r.size as TextSize) * n };
}

// ----------------------------------------------------------------------------- list row ---
export interface Trailing {
  value?: Value<string>;
  chevron?: boolean;
  check?: boolean | Condition;
  icon?: IconName | string;
  toggle?: boolean | Condition;
  badge?: number | string;
  pill?: { text: string; filled?: boolean };
}
export interface ListRowOptions {
  title: string;
  subtitle?: string;
  meta?: string;
  leading?: IconName | string;
  /** Custom leading widgets given the slot's centre. */
  leadingWidgets?: (cx: number, cy: number) => Widget[];
  trailing?: Trailing;
  on_tap?: Action; on_hold?: Action;
  /** Seen before: tertiary tone, and regular weight where unread rows are bold. */
  read?: boolean;
  disabled?: boolean;
  /** Bold the title. Default false: a list reads as text, and bold is for the one row that matters. */
  bold?: boolean | Value<Weight>;
  titleLines?: number;
  id?: string; when?: Condition;
}
export function listRow(k: Kit, box: Box, o: ListRowOptions): Piece {
  const inset = k.rowInset, gap = k.t.space[2], tight = k.t.space[1];
  const sm = k.iconSize("sm"), md = k.iconSize("md");
  const muted = !!o.read || !!o.disabled;
  const out: Widget[] = [];

  // --- horizontal budget: leading, then the trailing furniture, then what is left for text
  let x = box.x;
  const leadingW = (o.leading || o.leadingWidgets) ? md + k.t.space[3] : 0;
  x += leadingW;
  const t = o.trailing ?? {};
  let trailingW = 0, valueW = 0, toggleW = 0, badgeW = 0, pillW = 0;
  const glyph = t.chevron || t.icon || t.check;
  if (glyph) trailingW += sm;
  if (t.toggle !== undefined) { toggleW = 2 * k.t.space[8]; trailingW += (trailingW ? gap : 0) + toggleW; }
  if (t.badge !== undefined) { badgeW = Math.max(k.lh("xs"), k.snapUp(k.measure(String(t.badge), "xs", "bold") + k.t.space[2])); trailingW += (trailingW ? gap : 0) + badgeW; }
  if (t.pill) { pillW = k.snapUp(k.measure(t.pill.text, "sm") + 2 * k.t.space[3]); trailingW += (trailingW ? gap : 0) + pillW; }
  if (t.value !== undefined) {
    const room = box.w - leadingW - trailingW - (trailingW ? gap : 0);
    valueW = k.snapUp(typeof t.value === "string" ? Math.min(k.measure(t.value, "md"), Math.floor(room * 0.6)) : Math.floor(room / 3));
    trailingW += (trailingW ? gap : 0) + valueW;
  }
  const textW = Math.max(k.u, box.w - leadingW - trailingW - (trailingW ? k.t.space[4] : 0));

  // --- vertical: title, then any supporting lines, centred in a row on the rhythm
  const titleWeight: Value<Weight> = o.bold === true ? "bold" : o.bold === false || o.bold === undefined ? "regular" : o.bold;
  const measureWeight: Weight = titleWeight === "bold" ? "bold" : "regular";
  const titleLines = Math.min(3, Math.max(1, k.wrap(o.title, "md", measureWeight, textW, o.titleLines ?? 1).length));
  let textH = k.lh("md") * titleLines;
  if (o.subtitle) textH += tight + k.lh("sm");
  if (o.meta) textH += tight + k.lh("xs");
  let h = k.snapRow(2 * inset + textH);
  if (o.on_tap || o.on_hold) h = Math.max(h, k.t.touch_target.row);
  const top = box.y + k.centre(h, textH);
  // Trailing furniture lines up with the TITLE, not with the row: a control floating beside the
  // gap under a two-line title is the thing that makes a list look untended.
  const cy = top + k.lh("md") / 2;

  if ((o.on_tap || o.on_hold) && !o.disabled) {
    const full = box.x <= k.margin && box.x + box.w >= k.right;
    out.push(k.target({ x: full ? 0 : box.x, y: box.y, w: full ? k.W : box.w, h, on_tap: o.on_tap, on_hold: o.on_hold, id: o.id, when: o.when }));
  }
  if (o.leading) out.push(k.icon({ x: box.x, y: k.snap(cy - md / 2), name: o.leading, tone: muted ? "tertiary" : "ink", when: o.when }));
  if (o.leadingWidgets) out.push(...o.leadingWidgets(box.x + md / 2, cy));

  let y = top;
  out.push(k.text({ x, y, w: textW, text: o.title, role: "row", weight: titleWeight, tone: muted ? "tertiary" : "ink", lines: titleLines, when: o.when }));
  y += k.lh("md") * titleLines;
  if (o.subtitle) { y += tight; out.push(k.text({ x, y, w: textW, text: o.subtitle, size: "sm", tone: "secondary", when: o.when })); y += k.lh("sm"); }
  if (o.meta) { y += tight; out.push(k.text({ x, y, w: textW, text: o.meta, role: "meta", when: o.when })); }

  // --- trailing, right to left
  let rx = box.x + box.w;
  if (t.chevron) { rx -= sm; out.push(k.icon({ x: rx, y: k.snap(cy - sm / 2), name: Icons.forward, size: "sm", tone: "tertiary", when: o.when })); rx -= gap; }
  else if (t.icon) { rx -= sm; out.push(k.icon({ x: rx, y: k.snap(cy - sm / 2), name: t.icon, size: "sm", tone: muted ? "tertiary" : "ink", when: o.when })); rx -= gap; }
  else if (t.check) { rx -= sm; out.push(k.icon({ x: rx, y: k.snap(cy - sm / 2), name: Icons.check, size: "sm", when: typeof t.check === "string" ? t.check : o.when })); rx -= gap; }
  if (t.toggle !== undefined) {
    rx -= toggleW;
    out.push(...toggle(k, { x: rx, y: k.snap(cy - k.t.space[8] / 2), on: t.toggle, when: o.when }).widgets);
    rx -= gap;
  }
  if (t.badge !== undefined) {
    rx -= badgeW;
    const bh = k.lh("xs");
    out.push(k.rect({ x: rx, y: k.snap(cy - bh / 2), w: badgeW, h: bh, fill: "ink", radius: Math.floor(bh / 2) }));
    out.push(k.text({ x: rx, y: k.snap(cy - bh / 2), w: badgeW, h: bh, text: String(t.badge), size: "xs", weight: "bold", align: "center", valign: "middle", color: k.tone("paper") }));
    rx -= gap;
  }
  if (t.pill) {
    rx -= pillW;
    const ph = k.t.space[8];
    out.push(k.rect({ x: rx, y: k.snap(cy - ph / 2), w: pillW, h: ph, fill: t.pill.filled ? "ink" : undefined, stroke: t.pill.filled ? "ink" : "tertiary", stroke_w: 1, radius: Math.floor(ph / 2) }));
    out.push(k.text({ x: rx, y: k.snap(cy - ph / 2), w: pillW, h: ph, text: t.pill.text, role: "label", align: "center", valign: "middle", color: t.pill.filled ? k.tone("paper") : k.tone("ink") }));
    rx -= gap;
  }
  if (t.value !== undefined) {
    rx -= valueW;
    out.push(k.text({ x: rx, y: k.snap(cy - k.lh("md") / 2), w: valueW, h: k.lh("md"), text: t.value, tone: "secondary", align: "right", valign: "middle", when: o.when }));
  }
  return { widgets: out, h };
}

// ------------------------------------------------------------------- section / divider ---
export interface SectionHeaderOptions { text: string; tone?: ToneName; trailing?: string }
/** A quiet label over a group of rows: small, bold, secondary, with air above it from the stack. */
export function sectionHeader(k: Kit, box: Box, o: SectionHeaderOptions): Piece {
  const h = k.snapRow(k.lh("xs") + k.t.space[2]);
  const out: Widget[] = [k.text({ x: box.x, y: box.y, w: box.w, h, text: o.text, role: "section", tone: o.tone, valign: "bottom" })];
  if (o.trailing) out.push(k.text({ x: box.x, y: box.y, w: box.w, h, text: o.trailing, role: "meta", align: "right", valign: "bottom" }));
  return { widgets: out, h, keepWithNext: true };
}
export interface DividerOptions { inset?: number; tone?: ToneName }
export function divider(k: Kit, box: Box, o: DividerOptions = {}): Piece {
  const h = k.t.space[2], inset = o.inset ?? 0;
  return { widgets: [k.hline(box.x + inset, box.y + h / 2, box.w - inset, o.tone ?? "hairline")], h };
}

// --------------------------------------------------------------------------------- card ---
export interface CardOptions { title?: string; body: (inner: Box) => Piece | Widget[]; pad?: number; on_tap?: Action; id?: string }
export function card(k: Kit, box: Box, o: CardOptions): Piece {
  const pad = o.pad ?? k.t.space.inset;
  const inner: Box = { x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad };
  const items = k.stack(inner, [
    o.title ? (b) => heading(k, b, { text: o.title!, role: "headline", lines: 2 }) : null,
    (b) => o.body(b),
  ]);
  const h = k.snapRow(items.h + 2 * pad);
  const frame = k.rect({ x: box.x, y: box.y, w: box.w, h, stroke: "hairline", stroke_w: 1, radius: k.t.radius.md, on_tap: o.on_tap, id: o.id, feedback: o.on_tap ? "invert" : undefined });
  return { widgets: [frame, ...items.widgets], h };
}

// --------------------------------------------------------------------------------- tile ---
export interface TileSpec {
  label: string; sub?: Value<string>; icon?: IconName | string;
  /** `true`, or a condition, for the ON state (filled). */
  on?: boolean | Condition;
  on_tap?: Action; on_hold?: Action; id?: string; when?: Condition;
}
export interface TileOptions extends TileSpec { x: number; y: number; w: number; h: number }
function tileWidget(k: Kit, o: TileSpec, x: number, y: number, w: number, h: number): ButtonWidget {
  const ink = k.tone("ink"), paper = k.tone("paper");
  const b: ButtonWidget = {
    type: "button", x, y, w, h, label: o.label,
    fill: o.on === true ? ink : typeof o.on === "string" ? { if: o.on, then: ink, else: paper } : paper,
    stroke: o.on === true ? ink : k.tone("hairline"), stroke_w: 1, radius: k.t.radius.md,
  };
  if (o.sub !== undefined) b.sub = o.sub;
  if (o.icon) b.icon = o.icon;
  if (o.id) b.id = o.id;
  if (o.when) b.when = o.when;
  if (o.on_tap) b.on_tap = o.on_tap;
  if (o.on_hold) b.on_hold = o.on_hold;
  if (typeof o.on === "string") b.stroke = { if: o.on, then: ink, else: k.tone("hairline") };
  return b;
}
export function tile(k: Kit, o: TileOptions): Piece {
  return { widgets: [tileWidget(k, o, o.x, o.y, o.w, o.h)], h: o.h, w: o.w };
}
export interface TileGridOptions { tiles: TileSpec[]; cols?: number; rows?: number; gap?: number; cellH?: number; id?: string }
/** A `grid` of tiles filling the frame: cell width from the columns, cell height from the rows or the frame. */
export function tileGrid(k: Kit, frame: Frame, o: TileGridOptions): Piece {
  const gap = o.gap ?? k.t.space.gutter;
  const cols = o.cols ?? Math.max(1, Math.min(k.columnCount(frame.w) + 1, 4));
  const rows = o.rows ?? Math.max(1, Math.ceil(o.tiles.length / cols));
  const cellW = Math.floor((frame.w - gap * (cols - 1)) / cols / k.u) * k.u;
  const minH = k.t.touch_target.recommended;
  const cellH = o.cellH ?? Math.max(minH, Math.floor((frame.h - gap * (rows - 1)) / rows / k.u) * k.u);
  const x = frame.x + k.centre(frame.w, cellW * cols + gap * (cols - 1));
  const children: GridChild[] = o.tiles.slice(0, cols * rows).map((t, i) => ({ ...tileWidget(k, t, 0, 0, cellW, cellH), cell: i }));
  return { widgets: [{ type: "grid", x, y: frame.y, cols, rows, cell_w: cellW, cell_h: cellH, gap, children, ...(o.id ? { id: o.id } : {}) }], h: rows * cellH + gap * (rows - 1) };
}

// --------------------------------------------------------------------------------- stat ---
export interface StatOptions {
  value: string; unit?: string; label?: string; icon?: IconName | string;
  /** Force the digits face (for templated values that are numbers). */
  numeric?: boolean;
  size?: "display" | "3xl" | "2xl" | "xl" | "lg";
  align?: "left" | "center" | "right";
  id?: string;
}
export function stat(k: Kit, box: Box, o: StatOptions): Piece {
  const isDigits = o.numeric ?? (DIGITS.test(o.value) && !o.value.includes("{{"));
  const size: TextSize = !o.size || o.size === "display" ? (isDigits ? "digits" : "3xl") : o.size;
  const unitSize: TextSize = size === "digits" || size === "3xl" ? "lg" : size === "2xl" ? "md" : "sm";
  const lh = k.lh(size), gap = k.t.space[1], md = k.iconSize("md");
  const valueW = k.snapUp(o.value.includes("{{") ? Math.min(box.w, k.measure("0".repeat(5), size, "bold")) : k.measure(o.value, size, "bold"));
  const unitW = o.unit ? k.snapUp(k.measure(o.unit, unitSize)) : 0;
  const iconW = o.icon ? md + k.t.space[2] : 0;
  const total = iconW + valueW + (o.unit ? gap + unitW : 0);
  const x0 = box.x + (o.align === "center" ? k.centre(box.w, total) : o.align === "right" ? box.w - total : 0);
  const out: Widget[] = [];
  let x = x0;
  if (o.icon) { out.push(k.icon({ x, y: box.y + k.centre(lh, md), name: o.icon })); x += iconW; }
  out.push(k.text({ x, y: box.y, w: valueW, h: lh, text: o.value, size, weight: "bold", valign: "bottom", id: o.id }));
  x += valueW;
  if (o.unit) out.push(k.text({ x: x + gap, y: box.y, w: unitW, h: lh, text: o.unit, size: unitSize, tone: "secondary", valign: "bottom" }));
  let h = lh;
  if (o.label) {
    h += k.t.space[1];
    out.push(k.text({ x: x0, y: box.y + h, w: Math.max(total, box.w - (x0 - box.x)), text: o.label, role: "caption", align: o.align === "center" ? "center" : "left" }));
    h += k.lh("xs");
  }
  return { widgets: out, h: k.snapRow(h) };
}

// ---------------------------------------------------------------------------- key–value ---
export interface KeyValueOptions { key: string; value: Value<string>; on_tap?: Action; id?: string; when?: Condition }
export function keyValue(k: Kit, box: Box, o: KeyValueOptions): Piece {
  if (o.on_tap) return listRow(k, box, { title: o.key, trailing: { value: o.value }, on_tap: o.on_tap, id: o.id, when: o.when });
  const h = k.snapRow(k.lh("md") + k.t.space[2]);
  const keyW = k.snapUp(k.measure(o.key, "md")) + k.t.space[4];
  const vw = k.snapUp(typeof o.value === "string" ? Math.min(k.measure(o.value, "md"), Math.max(Math.floor(box.w / 2), box.w - keyW)) : Math.floor(box.w / 3));
  return { widgets: [
    k.text({ x: box.x, y: box.y, w: box.w - vw - k.t.space[4], h, text: o.key, valign: "middle", when: o.when }),
    k.text({ x: box.x + box.w - vw, y: box.y, w: vw, h, text: o.value, tone: "secondary", align: "right", valign: "middle", when: o.when, id: o.id }),
  ], h };
}

// ---------------------------------------------------------------------- text blocks ---
export interface ParagraphOptions { text: string; size?: "sm" | "md" | "lg"; weight?: Weight; tone?: ToneName; maxLines?: number; paraGap?: number }
/** Wraps text (blank lines separate paragraphs) into text widgets of at most eight lines each. */
export function paragraph(k: Kit, box: Box, o: ParagraphOptions): Piece {
  const size = o.size ?? "md", weight = o.weight ?? "regular", lh = k.lh(size), paraGap = o.paraGap ?? k.t.space[3];
  const out: Widget[] = [];
  let y = box.y, budget = o.maxLines ?? Infinity, first = true;
  for (const para of o.text.split(/\n[ \t]*\n/)) {
    if (budget <= 0) break;
    const lines = k.wrap(para.trim(), size, weight, box.w);
    const take = lines.slice(0, Math.min(lines.length, budget));
    if (take.length && take.length < lines.length) take[take.length - 1] = k.wrap(lines.slice(take.length - 1).join(" "), size, weight, box.w, 1)[0]!;
    budget -= take.length;
    if (!first) y += paraGap;
    first = false;
    for (let i = 0; i < take.length; i += 8) {
      const chunk = take.slice(i, i + 8);
      out.push(k.text({ x: box.x, y, w: box.w, text: chunk.join("\n"), size, weight, tone: o.tone, lines: chunk.length }));
      y += lh * chunk.length;
    }
  }
  return { widgets: out, h: y - box.y };
}
export interface PaginateOptions { text: string; size?: "sm" | "md" | "lg"; weight?: Weight; paraGap?: number }
/** Splits text into pages of whole lines for a box `w` × `h`; each page renders with `paragraph()`. */
export function paginate(k: Kit, w: number, h: number, o: PaginateOptions): string[] {
  const size = o.size ?? "md", weight = o.weight ?? "regular", lh = k.lh(size), paraGap = o.paraGap ?? k.t.space[3];
  const pages: string[] = [];
  let page: string[] = [], y = 0, pendingBreak = false;
  const flush = () => { if (page.length) pages.push(page.join("\n")); page = []; y = 0; pendingBreak = false; };
  for (const para of o.text.split(/\n[ \t]*\n/)) {
    const lines = k.wrap(para.trim(), size, weight, w);
    for (const l of lines) {
      const need = lh + (pendingBreak ? paraGap : 0);
      if (y + need > h && page.length) flush();
      if (pendingBreak && page.length) { page.push(""); y += paraGap; }
      pendingBreak = false;
      page.push(l);
      y += lh;
    }
    pendingBreak = true;
  }
  flush();
  k.pageCount = Math.max(k.pageCount, pages.length);
  return pages;
}
export interface TextLinesOptions { lines: string[]; size?: TextSize; weight?: Weight; tone?: ToneName }
/** Renders pre-wrapped lines (each already fits `box.w`) in chunks of eight. */
export function textLines(k: Kit, box: Box, o: TextLinesOptions): Piece {
  const size = o.size ?? "md", lh = k.lh(size);
  const out: Widget[] = [];
  let y = box.y;
  for (let i = 0; i < o.lines.length; i += 8) {
    const chunk = o.lines.slice(i, i + 8);
    out.push(k.text({ x: box.x, y, w: box.w, text: chunk.join("\n"), size, weight: o.weight, tone: o.tone, lines: chunk.length }));
    y += lh * chunk.length;
  }
  return { widgets: out, h: y - box.y };
}

// ---------------------------------------------------------------------------- meta line ---
export interface MetaLineOptions { facts: string[]; size?: "xs" | "sm"; tone?: ToneName; align?: "left" | "center" | "right" }
/** Facts joined by ` · `; whole facts are dropped from the end until the line fits. */
export function metaLine(k: Kit, box: Box, o: MetaLineOptions): Piece & { text: string } {
  const size = o.size ?? "xs";
  const facts = o.facts.filter((f) => f.length);
  let n = facts.length, text = facts.join(" · ");
  while (n > 1 && k.measure(text, size) > box.w) { n--; text = facts.slice(0, n).join(" · "); }
  return { widgets: [k.text({ x: box.x, y: box.y, w: box.w, text, size, tone: o.tone ?? "secondary", align: o.align })], h: k.lh(size), text };
}

// -------------------------------------------------------------------------- pill / badge ---
export interface PillOptions { x: number; y: number; text: string; filled?: boolean; icon?: IconName | string; on_tap?: Action; id?: string }
export function pill(k: Kit, o: PillOptions): Piece {
  const h = k.t.space[8], padX = k.t.space[3], sm = k.iconSize("sm");
  const iconW = o.icon ? sm + k.t.space[1] : 0;
  const w = k.snapUp(k.measure(o.text, "sm") + iconW + 2 * padX);
  const out: Widget[] = [
    k.rect({ x: o.x, y: o.y, w, h, fill: o.filled ? "ink" : undefined, stroke: o.filled ? "ink" : "tertiary", stroke_w: 1, radius: Math.floor(h / 2), on_tap: o.on_tap, id: o.id, feedback: o.on_tap ? "invert" : undefined }),
  ];
  if (o.icon) out.push(k.icon({ x: o.x + padX, y: o.y + k.centre(h, sm), name: o.icon, size: "sm", color: o.filled ? k.tone("paper") : k.tone("ink") }));
  out.push(k.text({ x: o.x + padX + iconW, y: o.y, w: w - 2 * padX - iconW, h, text: o.text, role: "label", align: "center", valign: "middle", color: o.filled ? k.tone("paper") : k.tone("ink") }));
  return { widgets: out, h, w };
}
export interface BadgeOptions { x: number; y: number; count: number | string }
export function badge(k: Kit, o: BadgeOptions): Piece {
  const h = k.lh("xs"), text = String(o.count);
  const w = Math.max(h, k.snapUp(k.measure(text, "xs", "bold") + k.t.space[2]));
  return { widgets: [
    k.rect({ x: o.x, y: o.y, w, h, fill: "ink", radius: Math.floor(h / 2) }),
    k.text({ x: o.x, y: o.y, w, h, text, size: "xs", weight: "bold", align: "center", valign: "middle", color: k.tone("paper") }),
  ], h, w };
}

// ------------------------------------------------------------------- progress / steps ---
export interface ProgressOptions { value: number; h?: number; label?: string; caption?: string }
export function progress(k: Kit, box: Box, o: ProgressOptions): Piece {
  const bar = o.h ?? k.t.space[2];
  const out: Widget[] = [];
  let y = box.y;
  if (o.label || o.caption) {
    const lh = k.lh("xs");
    if (o.label) out.push(k.text({ x: box.x, y, w: box.w, h: lh, text: o.label, role: "caption" }));
    if (o.caption) out.push(k.text({ x: box.x, y, w: box.w, h: lh, text: o.caption, role: "meta", align: "right" }));
    y += lh + k.t.space[2];
  }
  const v = Math.max(0, Math.min(1, o.value));
  out.push(k.rect({ x: box.x, y, w: box.w, h: bar, fill: "fill_subtle", stroke: "hairline", stroke_w: 1, radius: Math.floor(bar / 2) }));
  const fw = k.snap(box.w * v);
  if (fw > 0) out.push(k.rect({ x: box.x, y, w: fw, h: bar, fill: "ink", radius: Math.floor(bar / 2) }));
  return { widgets: out, h: k.snapRow(y + bar - box.y) };
}
export interface StepsOptions { count: number; current: number; align?: "left" | "center" }
export function steps(k: Kit, box: Box, o: StepsOptions): Piece {
  const d = k.t.space[2], gap = k.t.space[2];
  const total = o.count * d + (o.count - 1) * gap;
  const x0 = box.x + (o.align === "center" ? k.centre(box.w, total) : 0);
  const out: Widget[] = [];
  for (let i = 0; i < o.count; i++) {
    const x = x0 + i * (d + gap);
    out.push(i < o.current ? k.rect({ x, y: box.y, w: d, h: d, fill: "ink", radius: Math.floor(d / 2) })
                           : k.rect({ x, y: box.y, w: d, h: d, stroke: "tertiary", stroke_w: 1, radius: Math.floor(d / 2) }));
  }
  return { widgets: out, h: d };
}

// ------------------------------------------------------------------------------- charts ---
export interface BarChartOptions { values: number[]; max?: number; h?: number; labels?: string[]; outline?: boolean }
export function barChart(k: Kit, box: Box, o: BarChartOptions): Piece {
  const n = o.values.length, gap = k.t.space[2], chartH = o.h ?? 4 * k.t.space[8];
  const max = o.max ?? Math.max(1, ...o.values);
  const barW = Math.max(k.u, Math.floor((box.w - gap * (n - 1)) / n / k.u) * k.u);
  const x0 = box.x + k.centre(box.w, barW * n + gap * (n - 1));
  const out: Widget[] = [];
  o.values.forEach((v, i) => {
    const bh = Math.max(0, k.snap((Math.max(0, v) / max) * (chartH - k.u)));
    if (bh > 0) out.push(k.rect({ x: x0 + i * (barW + gap), y: box.y + chartH - bh, w: barW, h: bh, ...(o.outline ? { stroke: "ink", stroke_w: 1 } : { fill: "ink" }) }));
  });
  out.push(k.hline(box.x, box.y + chartH, box.w, "hairline"));
  let h = chartH + 1;
  if (o.labels) {
    h += k.t.space[1];
    o.labels.forEach((l, i) => out.push(k.text({ x: x0 + i * (barW + gap), y: box.y + h, w: barW, text: l, role: "meta", align: "center" })));
    h += k.lh("xs");
  }
  return { widgets: out, h: k.snapRow(h) };
}
export interface SparklineOptions { values: number[]; h?: number; width?: number; max?: number; min?: number }
export function sparkline(k: Kit, box: Box, o: SparklineOptions): Piece {
  const h = o.h ?? 2 * k.t.space[8];
  let vals = o.values;
  if (vals.length > 40) { const step = vals.length / 40; vals = Array.from({ length: 40 }, (_, i) => o.values[Math.floor(i * step)]!); }
  const min = o.min ?? Math.min(...vals), max = o.max ?? Math.max(...vals), span = max - min || 1;
  const out: Widget[] = [];
  const pts = vals.map((v, i) => ({ x: box.x + Math.round((i / Math.max(1, vals.length - 1)) * (box.w - 1)), y: box.y + h - 1 - Math.round(((v - min) / span) * (h - 1)) }));
  const width = o.width ?? Math.max(1, Math.floor(k.t.stroke.frame / 2) + 1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    out.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, width, ...(k.tone("ink") ? { color: k.tone("ink") } : {}) });
  }
  return { widgets: out, h: k.snapRow(h) };
}

// -------------------------------------------------------------------------------- table ---
export interface TableColumn { title: string; w?: number; align?: "left" | "right" }
export interface TableOptions { columns: TableColumn[]; rows: (string | number)[][]; header?: boolean; compact?: boolean }
export function table(k: Kit, box: Box, o: TableOptions): Piece {
  const gap = k.t.space[4];
  // A column is as wide as its widest cell. The leftover goes to the first column, which is the
  // one holding names; numbers that do not fit are the fastest way to make a table look broken.
  const natural = o.columns.map((c, i) => {
    if (c.w) return c.w;
    let m = k.measure(c.title, "xs", "bold");
    for (const row of o.rows) m = Math.max(m, k.measure(String(row[i] ?? ""), "md"));
    return k.snapUp(m);
  });
  const slack = box.w - gap * (o.columns.length - 1) - natural.reduce((s, w) => s + w, 0);
  const widths = natural.slice();
  const first = o.columns.findIndex((c) => !c.w);
  if (first >= 0) widths[first] = Math.max(k.u, widths[first]! + slack);
  const xs: number[] = []; let x = box.x;
  widths.forEach((w) => { xs.push(x); x += w + gap; });
  const out: Widget[] = [];
  let y = box.y;
  if (o.header !== false) {
    const hh = k.lh("xs") + k.t.space[2];
    o.columns.forEach((c, i) => out.push(k.text({ x: xs[i]!, y, w: widths[i]!, h: hh, text: c.title, role: "section", align: c.align, valign: "bottom" })));
    y += hh;
    out.push(k.hline(box.x, y, box.w, "hairline")); y += 1 + k.t.space[1];
  }
  const rowH = k.lh("md") + (o.compact ? k.t.space[1] : k.t.space[2]);
  o.rows.forEach((row, r) => {
    if (r) out.push(k.hline(box.x, y, box.w, "hairline"));
    row.forEach((cell, i) => out.push(k.text({ x: xs[i]!, y, w: widths[i]!, h: rowH, text: String(cell), align: o.columns[i]?.align, tone: i && o.columns[i]?.align === "right" ? "secondary" : "ink", valign: "middle" })));
    y += rowH;
  });
  return { widgets: out, h: k.snapRow(y - box.y) };
}

// -------------------------------------------------------------------------------- image ---
export interface ImageOptions { src: string; w?: number; h: number; caption?: string; ttl?: number; align?: "left" | "center"; id?: string; on_tap?: Action }
export function imageBlock(k: Kit, box: Box, o: ImageOptions): Piece {
  const w = o.w ?? box.w;
  const x = box.x + (o.align === "center" ? k.centre(box.w, w) : 0);
  const out: Widget[] = [{ type: "image", x, y: box.y, w, h: o.h, src: o.src, ...(o.ttl !== undefined ? { ttl: o.ttl } : {}), ...(o.id ? { id: o.id } : {}), ...(o.on_tap ? { on_tap: o.on_tap } : {}) }];
  let h = o.h;
  if (o.caption) { h += k.t.space[2]; out.push(k.text({ x: box.x, y: box.y + h, w: box.w, text: o.caption, role: "caption", align: o.align === "center" ? "center" : "left" })); h += k.lh("xs"); }
  return { widgets: out, h: k.snapRow(h) };
}

// -------------------------------------------------------------------------- empty state ---
export interface EmptyStateOptions { icon: IconName | string; title: string; hint?: string; action?: { label: string; on_tap: Action; id?: string } }
export function emptyState(k: Kit, box: Box, o: EmptyStateOptions): Piece {
  const lg = k.iconSize("lg");
  return k.stack(box, [
    k.spacer(k.t.space.group),
    (b) => ({ widgets: [k.icon({ x: b.x + k.centre(b.w, lg), y: b.y, name: o.icon, size: "lg", tone: "tertiary" })], h: lg }),
    k.spacer(k.t.space[4]),
    (b) => heading(k, b, { text: o.title, role: "headline", lines: 2, align: "center" }),
    o.hint ? (b) => heading(k, b, { text: o.hint!, role: "caption", lines: 3, align: "center" }) : null,
    o.action ? (b) => {
      const bw = k.snapUp(k.measure(o.action!.label, "sm") + 2 * k.t.space[6]);
      const h = k.t.touch_target.min;
      const btn: ButtonWidget = { type: "button", x: b.x + k.centre(b.w, bw), y: b.y + k.t.space[4], w: bw, h, label: o.action!.label, size: "sm", fill: k.tone("paper"), stroke: k.tone("ink"), stroke_w: 1, radius: k.t.radius.md, on_tap: o.action!.on_tap };
      if (o.action!.id) btn.id = o.action!.id;
      return { widgets: [btn], h: h + k.t.space[4] };
    } : null,
  ], k.t.space[2]);
}

// --------------------------------------------------------------------- status glyphs ---
export interface BatteryGlyphOptions { x: number; y: number; value: number | string; size?: "sm" | "md" }
/** A battery icon for a literal percentage, or the stepped set for a template path such as `device.battery`. */
export function batteryGlyph(k: Kit, o: BatteryGlyphOptions): Piece {
  const size = o.size ?? "sm", px = k.iconSize(size);
  if (typeof o.value === "number") return { widgets: [k.icon({ x: o.x, y: o.y, name: batteryIconFor(o.value), size })], h: px, w: px };
  return { widgets: batteryStepped(k, o.x, o.y, o.value, size), h: px, w: px };
}
export interface WifiGlyphOptions { x: number; y: number; rssi: number | string; online?: boolean; size?: "sm" | "md" }
export function wifiGlyph(k: Kit, o: WifiGlyphOptions): Piece {
  const size = o.size ?? "sm", px = k.iconSize(size);
  if (typeof o.rssi === "number") return { widgets: [k.icon({ x: o.x, y: o.y, name: wifiIconFor(o.rssi, o.online ?? true), size })], h: px, w: px };
  return { widgets: wifiStepped(k, o.x, o.y, o.rssi, size), h: px, w: px };
}
