// Chrome: nav bar, toolbar, rail, pager cells, segmented control, launcher status bar, the OS
// corner and the toast band.
//
// Chrome is the part of a screen the person is not reading, so it is drawn as quietly as it can be
// and still be found: icons at the size of the text beside them, separators in the hairline tone
// rather than ink, no vertical dividers between cells (equal spacing already separates them), and
// no fills except to say "selected".
import type { Kit } from "../kit.js";
import type { Action, Box, Condition, Piece, ScreenKeys, Widget } from "../types.js";
import { Icons, type IconName, type IconRole } from "../icons.js";

export interface CellSpec {
  icon?: IconName | string;
  label?: string;
  on_tap?: Action; on_hold?: Action;
  /** Drawn at the tertiary tone and not hit-tested. On 1-bit panels the glyph is omitted instead. */
  disabled?: boolean;
  /** Non-interactive text, e.g. a page counter. */
  plain?: boolean;
  /** Adds a small chevron after the label: the cell opens a menu. */
  menu?: boolean;
  id?: string; when?: Condition;
  /** For button-only devices: which press runs this cell's action (SPEC §6 `keys`; a long press is always Home). */
  key?: "short" | "double";
}

function cellGlyph(k: Kit, c: CellSpec, x: number, y: number, w: number, h: number): Widget[] {
  const out: Widget[] = [];
  const tone = c.disabled ? "tertiary" : c.plain ? "secondary" : "ink";
  if (c.disabled && k.collapsed("tertiary")) return out;            // no way to show "off": omit
  if (c.icon) {
    const px = k.iconSize("md");
    out.push(k.icon({ x: x + k.centre(w, px), y: y + k.centre(h, px), name: c.icon, tone, when: c.when }));
  } else if (c.label !== undefined) {
    const chev = c.menu ? k.iconSize("sm") + k.t.space[1] : 0;
    const tw = k.snapUp(Math.min(w - 2 * k.t.space[2], k.measure(c.label, "sm") + chev));
    const tx = x + k.centre(w, tw);
    out.push(k.text({ x: tx, y, w: tw - chev, h, text: c.label, role: "label", tone, valign: "middle", when: c.when }));
    if (c.menu) out.push(k.icon({ x: tx + tw - k.iconSize("sm"), y: y + k.centre(h, k.iconSize("sm")), name: Icons.page_down, size: "sm", tone, when: c.when }));
  }
  return out;
}
function cellTarget(k: Kit, c: CellSpec, x: number, y: number, w: number, h: number): Widget[] {
  if (c.plain || c.disabled || !(c.on_tap || c.on_hold)) return [];
  return [k.target({ x, y, w, h, on_tap: c.on_tap, on_hold: c.on_hold, id: c.id, when: c.when })];
}
function collectKeys(cells: CellSpec[]): ScreenKeys | undefined {
  const keys: ScreenKeys = {};
  for (const c of cells) if (c.key && c.on_tap && !c.disabled) keys[c.key] = c.on_tap;
  return Object.keys(keys).length ? keys : undefined;
}

// ------------------------------------------------------------------------------ nav bar ---
export interface NavBarOptions {
  title: string;
  /** `true` emits a `back` action; an Action overrides it. */
  back?: boolean | Action;
  /** Up to two icon cells at the right, before the OS corner. */
  actions?: CellSpec[];
  /** Right-aligned meta text (a page count, `{{device.battery}}%`). */
  status?: string;
  /** Drop the separator under the bar (a screen whose content starts with its own rule). */
  bare?: boolean;
  id?: string;
}
export function navBar(k: Kit, o: NavBarOptions): Piece {
  const h = k.t.chrome.nav, cell = k.t.touch_target.row, m = k.margin, gap = k.t.space.gap;
  const px = k.iconSize("md");
  const out: Widget[] = [];
  let x = m;
  if (o.back) {
    const action: Action = o.back === true ? { type: "back" } : o.back;
    out.push(k.target({ x: 0, y: 0, w: m + cell, h, on_tap: action, id: o.id ? `${o.id}-back` : undefined }));
    // The chevron sits on the margin, so the title starts one step in from where it would alone.
    out.push(k.icon({ x, y: k.centre(h, px), name: Icons.back }));
    x += px + k.t.space[2];
  }
  const corner = k.cornerRect();
  let right = corner.x - gap;
  const actions = (o.actions ?? []).slice(0, 2);
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!;
    right -= cell;
    out.push(...cellTarget(k, a, right, k.centre(h, cell), cell, cell), ...cellGlyph(k, a, right, 0, cell, h));
  }
  if (o.status) {
    const sw = k.snapUp(Math.min(k.measure(o.status, "xs"), right - x - gap));
    right -= sw + (actions.length ? gap : 0);
    out.push(k.text({ x: right, y: 0, w: sw, h, text: o.status, role: "meta", align: "right", valign: "middle" }));
    right -= gap;
  }
  out.push(k.text({ x, y: 0, w: Math.max(k.u, right - x), h, text: o.title, role: "nav_title", valign: "middle", id: o.id }));
  if (!o.bare) out.push(k.hline(0, h - 1, k.W, "hairline"));
  return { widgets: out, h };
}

// ------------------------------------------------------------------------------ toolbar ---
export interface ToolbarOptions {
  /** One or two rows of cells; each row's cells share its width equally. */
  rows: CellSpec[][];
  /** `auto` becomes a left rail on landscape screens; `bottom` never does. */
  placement?: "auto" | "bottom";
}
export function toolbar(k: Kit, o: ToolbarOptions): Piece {
  const rowH = k.t.chrome.toolbar, n = o.rows.length, top = k.H - n * rowH;
  const out: Widget[] = [k.hline(0, top, k.W, "hairline")];
  o.rows.forEach((row, r) => {
    const y = top + r * rowH;
    if (r) out.push(k.hline(k.margin, y, k.contentW, "hairline"));
    const cw = Math.floor(k.contentW / row.length / k.u) * k.u;
    const x0 = k.margin + k.centre(k.contentW, cw * row.length);
    row.forEach((c, i) => {
      const x = x0 + i * cw;
      out.push(...cellTarget(k, c, x, y, cw, rowH), ...cellGlyph(k, c, x, y, cw, rowH));
    });
  });
  return { widgets: out, h: n * rowH, keys: collectKeys(o.rows.flat()) };
}

// --------------------------------------------------------------------------------- rail ---
export interface RailOptions { cells: CellSpec[]; top?: number }
export function rail(k: Kit, o: RailOptions): Piece {
  const w = k.t.chrome.rail, cellH = k.t.chrome.toolbar, top = o.top ?? 0;
  const out: Widget[] = [k.vline(w - 1, top, k.H - top, "hairline")];
  o.cells.forEach((c, i) => {
    const y = top + i * cellH;
    out.push(...cellTarget(k, c, 0, y, w - 1, cellH), ...cellGlyph(k, c, 0, y, w - 1, cellH));
  });
  return { widgets: out, h: k.H - top, w, keys: collectKeys(o.cells) };
}

// -------------------------------------------------------------------------------- pager ---
export interface PagerOptions { page: number; pages: number; prev: Action; next: Action; label?: string }
/** The `▲ · n / m · ▼` toolbar row. Arrows dim where there is nowhere to go. */
export function pagerRow(k: Kit, o: PagerOptions): CellSpec[] {
  void k;
  return [
    { icon: Icons.page_up, on_tap: o.prev, disabled: o.page <= 1, key: "double" },
    { label: o.label ?? `${o.page} / ${o.pages}`, plain: true },
    { icon: Icons.page_down, on_tap: o.next, disabled: o.page >= o.pages, key: "short" },
  ];
}

// ---------------------------------------------------------------------------- segmented ---
export interface SegmentedOptions {
  segments: { label: string; on_tap?: Action; id?: string; /** condition under which this segment is selected */ when?: Condition }[];
  /** Index of the selected segment when selection is known server-side. */
  selected?: number;
}
export function segmented(k: Kit, box: Box, o: SegmentedOptions): Piece {
  const h = k.t.touch_target.row, n = o.segments.length;
  const segW = Math.floor(box.w / n / k.u) * k.u, x0 = box.x + k.centre(box.w, segW * n);
  const ink = k.tone("ink"), paper = k.tone("paper");
  const out: Widget[] = [];
  o.segments.forEach((s, i) => {
    const x = x0 + i * segW;
    const sel = o.selected === i;
    const fill = sel ? ink : s.when ? { if: s.when, then: ink, else: paper } : paper;
    const color = sel ? paper : s.when ? { if: s.when, then: paper, else: ink } : ink;
    out.push(k.rect({ x, y: box.y, w: segW, h, fill, on_tap: s.on_tap, feedback: "invert", id: s.id }));
    out.push(k.text({ x: x + k.t.space[1], y: box.y, w: segW - 2 * k.t.space[1], h, text: s.label, role: "label", align: "center", valign: "middle", color }));
    if (i) out.push(k.vline(x, box.y, h, "hairline"));
  });
  out.push(k.rect({ x: x0, y: box.y, w: segW * n, h, stroke: "ink", stroke_w: 1, radius: k.t.radius.sm }));
  return { widgets: out, h };
}

// --------------------------------------------------------------------------- status bar ---
export interface StatusBarOptions { title?: string; time?: boolean }
/** The launcher's bar: title or clock at the left, Wi-Fi and battery at the right. OS-owned. */
export function statusBar(k: Kit, o: StatusBarOptions = {}): Piece {
  const h = k.t.chrome.status, m = k.margin, sm = k.iconSize("sm"), gap = k.t.space[2];
  const out: Widget[] = [];
  let right = k.right;
  const iy = k.centre(h, sm);
  right -= sm;
  out.push(...batteryStepped(k, right, iy, "device.battery"));
  right -= gap + sm;
  out.push(k.icon({ x: right, y: iy, name: Icons.energy, size: "sm", when: "device.charging" }));
  right -= gap + sm;
  out.push(...wifiStepped(k, right, iy, "device.rssi"));
  right -= gap;
  const left = o.title ?? (o.time !== false ? "{{device.time|time:'HH:mm'}}" : "");
  if (left) out.push(k.text({ x: m, y: 0, w: right - m, h, text: left, size: "sm", valign: "middle" }));
  return { widgets: out, h };
}
export function batteryStepped(k: Kit, x: number, y: number, path: string, size: "sm" | "md" = "sm"): Widget[] {
  const steps: [number, IconName][] = [[-1, Icons.battery_0], [5, Icons.battery_10], [20, Icons.battery_30], [40, Icons.battery_50], [60, Icons.battery_70], [80, Icons.battery_90], [95, Icons.battery_100]];
  return steps.map(([t, name]) => k.icon({ x, y, name, size, when: t < 0 ? `${path} >= 0` : `${path} >= ${t}` }));
}
export function wifiStepped(k: Kit, x: number, y: number, path: string, size: "sm" | "md" = "sm"): Widget[] {
  const steps: [number, IconName][] = [[-85, Icons.wifi_1], [-75, Icons.wifi_2], [-65, Icons.wifi_3], [-55, Icons.wifi_4]];
  return [k.icon({ x, y, name: Icons.wifi_0, size, when: "device.online" }),
    ...steps.map(([t, name]) => k.icon({ x, y, name, size, when: `${path} >= ${t}` })),
    k.icon({ x, y, name: Icons.offline, size, when: "device.online == false" })];
}

// ---------------------------------------------------------------------------- OS corner ---
export interface SystemCornerOptions { glyph: IconRole }
/** What the OS draws in its corner. For the gallery and OS screens only; apps never call this. */
export function systemCorner(k: Kit, o: SystemCornerOptions): Piece {
  const c = k.cornerRect(), size = c.w >= k.iconSize("md") ? "md" : "sm", px = k.iconSize(size);
  return { widgets: [k.icon({ x: c.x + k.centre(c.w, px), y: c.y + k.centre(c.h, px), name: Icons[o.glyph], size })], h: c.h };
}

// -------------------------------------------------------------------------------- toast ---
export interface ToastOptions { text: string }
/** The OS's transient message band at the bottom. Apps never draw one. */
export function toast(k: Kit, o: ToastOptions): Piece {
  const h = k.t.chrome.toast, y = k.H - h;
  return { widgets: [
    k.rect({ x: 0, y, w: k.W, h, fill: "ink" }),
    k.text({ x: k.margin, y, w: k.contentW, h, text: o.text, role: "label", align: "center", valign: "middle", color: k.tone("paper") }),
  ], h };
}
