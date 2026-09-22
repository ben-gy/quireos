// Controls: buttons, toggles, choice rows, stepper, chips, slider, action sheet, dialog, keypad.
//
// One filled thing per screen. A control's resting state is a hairline outline or nothing at all;
// ink fills mean on, selected or primary, and that is the whole vocabulary. Strokes are 1 px: a
// 2 px outline around every control turns a page into a form.
import type { Kit } from "../kit.js";
import type { Action, Box, Condition, Piece, Value, Widget, ButtonWidget, GridChild, Weight } from "../types.js";
import { Icons, type IconName } from "../icons.js";
import { listRow, heading } from "./content.js";

// ------------------------------------------------------------------------------- button ---
export type ButtonKind = "primary" | "secondary" | "tertiary";
export type ButtonSize = "sm" | "md" | "lg";
export interface ButtonSpec {
  label: Value<string>; sub?: Value<string>; icon?: IconName | string;
  kind?: ButtonKind; size?: ButtonSize;
  on_tap?: Action; on_hold?: Action; disabled?: boolean; id?: string; when?: Condition;
}
export interface ButtonOptions extends ButtonSpec { x: number; y: number; w?: number }
export function buttonHeight(k: Kit, size: ButtonSize = "md"): number {
  return size === "sm" ? k.t.touch_target.row : size === "lg" ? k.t.touch_target.recommended : k.t.touch_target.min;
}
export function buttonWidth(k: Kit, o: ButtonSpec): number {
  const label = typeof o.label === "string" ? o.label : "Button";
  const iconW = o.icon ? k.iconSize("md") + k.t.space[2] : 0;
  return k.snapUp(k.measure(label, o.size === "lg" ? "md" : "sm", "bold") + iconW + 2 * k.t.space[6]);
}
/**
 * The `button` widget draws its `icon` ABOVE its label, which is the tile shape. A button with an
 * icon beside its label is therefore composed: a tappable rounded rect with the glyph and the
 * label laid on top. Tap feedback inverts the rect, which covers both, so it still reads as one
 * control.
 */
export function button(k: Kit, o: ButtonOptions): Piece {
  const kind = o.kind ?? "secondary", h = buttonHeight(k, o.size), w = o.w ?? buttonWidth(k, o);
  const ink = k.tone("ink"), paper = k.tone("paper"), tert = k.tone("tertiary");
  const size = o.size === "lg" ? "md" : "sm";
  const fill = o.disabled ? paper : kind === "primary" ? ink : kind === "secondary" ? paper : null;
  const stroke = o.disabled ? (kind === "tertiary" ? null : tert) : kind === "primary" ? ink : kind === "secondary" ? ink : null;
  const color = o.disabled ? tert : kind === "primary" ? paper : ink;

  if (o.icon && o.sub === undefined) {
    const px = k.iconSize("md"), gap = k.t.space[2];
    const label = typeof o.label === "string" ? o.label : "";
    const tw = k.measure(label, size, "bold");
    const x0 = o.x + k.centre(w, px + gap + tw);
    const out: Widget[] = [k.rect({
      x: o.x, y: o.y, w, h, fill, stroke, stroke_w: 1, radius: k.t.radius.md, id: o.id, when: o.when,
      on_tap: o.disabled ? undefined : o.on_tap, on_hold: o.disabled ? undefined : o.on_hold,
      feedback: o.disabled ? "none" : "invert",
    })];
    out.push(k.icon({ x: x0, y: o.y + k.centre(h, px), name: o.icon, color, when: o.when }));
    out.push(k.text({ x: x0 + px + gap, y: o.y, w: tw, h, text: o.label, size, weight: "bold", valign: "middle", color, when: o.when }));
    return { widgets: out, h, w };
  }

  const b: ButtonWidget = { type: "button", x: o.x, y: o.y, w, h, label: o.label, size, radius: k.t.radius.md, stroke_w: 1, fill, stroke, color };
  if (o.disabled) b.feedback = "none";
  if (o.sub !== undefined) b.sub = o.sub;
  if (o.icon) b.icon = o.icon;
  if (o.id) b.id = o.id;
  if (o.when) b.when = o.when;
  if (!o.disabled) { if (o.on_tap) b.on_tap = o.on_tap; if (o.on_hold) b.on_hold = o.on_hold; }
  return { widgets: [b], h, w };
}
export interface ButtonRowOptions { buttons: ButtonSpec[]; align?: "fill" | "left" | "right" | "center"; size?: ButtonSize; gap?: number }
/** Buttons side by side. `fill` (default) shares the width; otherwise each is as wide as its label. */
export function buttonRow(k: Kit, box: Box, o: ButtonRowOptions): Piece {
  const gap = o.gap ?? k.t.space.gutter, n = o.buttons.length, align = o.align ?? "fill";
  const size = o.size;
  const h = buttonHeight(k, size ?? o.buttons[0]?.size);
  const out: Widget[] = [];
  if (align === "fill") {
    const cols = k.columns(box, n, gap);
    o.buttons.forEach((b, i) => out.push(...button(k, { ...b, size: size ?? b.size, x: cols[i]!.x, y: box.y, w: cols[i]!.w }).widgets));
    return { widgets: out, h };
  }
  const widths = o.buttons.map((b) => buttonWidth(k, { ...b, size: size ?? b.size }));
  const total = widths.reduce((s, w) => s + w, 0) + gap * (n - 1);
  let x = align === "right" ? box.x + box.w - total : align === "center" ? box.x + k.centre(box.w, total) : box.x;
  o.buttons.forEach((b, i) => { out.push(...button(k, { ...b, size: size ?? b.size, x, y: box.y, w: widths[i]! }).widgets); x += widths[i]! + gap; });
  return { widgets: out, h };
}

// -------------------------------------------------------------------------- icon button ---
export interface IconButtonOptions { x: number; y: number; icon: IconName | string; on_tap?: Action; on_hold?: Action; disabled?: boolean; framed?: boolean; id?: string; when?: Condition }
export function iconButton(k: Kit, o: IconButtonOptions): Piece {
  const cell = k.t.touch_target.row, px = k.iconSize("md");
  const out: Widget[] = [];
  if (o.framed) out.push(k.rect({ x: o.x, y: o.y, w: cell, h: cell, stroke: o.disabled ? "tertiary" : "ink", stroke_w: 1, radius: k.t.radius.md, on_tap: o.disabled ? undefined : o.on_tap, on_hold: o.disabled ? undefined : o.on_hold, id: o.id, when: o.when, feedback: o.disabled ? "none" : "invert" }));
  else if (!o.disabled && (o.on_tap || o.on_hold)) out.push(k.target({ x: o.x, y: o.y, w: cell, h: cell, on_tap: o.on_tap, on_hold: o.on_hold, id: o.id, when: o.when }));
  if (!(o.disabled && k.collapsed("tertiary"))) out.push(k.icon({ x: o.x + k.centre(cell, px), y: o.y + k.centre(cell, px), name: o.icon, tone: o.disabled ? "tertiary" : "ink", when: o.when }));
  return { widgets: out, h: cell, w: cell };
}

// ------------------------------------------------------------------------------- toggle ---
export interface ToggleOptions { x: number; y: number; on: boolean | Condition; on_tap?: Action; id?: string; when?: Condition }
/**
 * A two-state pill: an ink track with a paper knob at the right when on, an outlined track with an
 * outlined knob at the left when off. Off is drawn as an outline rather than a filled dot, so a
 * column of switches reads as one row of quiet shapes with the on ones standing out.
 *
 * Each knob is drawn only in its own state, which needs the opposite of the on-condition; where the
 * condition cannot be inverted (a bare truthiness test) the knobs fall back to painting over each
 * other, which is correct but heavier.
 */
export function toggle(k: Kit, o: ToggleOptions): Piece {
  const h = k.t.space[8], w = 2 * h, inset = k.u, knob = h - 2 * inset, r = Math.floor(knob / 2);
  const ink = k.tone("ink"), paper = k.tone("paper");
  const cond = typeof o.on === "string" ? o.on : null;
  const off = cond ? k.not(cond) : null;
  const both = (a?: Condition | null): Condition | undefined => (o.when && a ? undefined : (a ?? o.when) ?? undefined);
  const fill = o.on === true ? ink : o.on === false ? paper : { if: o.on as Condition, then: ink, else: paper };
  const out: Widget[] = [
    k.rect({ x: o.x, y: o.y, w, h, fill, stroke: "ink", stroke_w: 1, radius: Math.floor(h / 2), on_tap: o.on_tap, id: o.id, when: o.when, feedback: o.on_tap ? "invert" : undefined }),
  ];
  const onKnob = k.rect({ x: o.x + w - inset - knob, y: o.y + inset, w: knob, h: knob, fill: paper, radius: r, when: both(cond) });
  const offKnob = k.rect({ x: o.x + inset, y: o.y + inset, w: knob, h: knob, fill: paper, stroke: "ink", stroke_w: 1, radius: r, when: both(off) });
  if (o.on === true) out.push(onKnob);
  else if (o.on === false) out.push(offKnob);
  else if (off) out.push(offKnob, onKnob);
  else out.push(k.rect({ x: o.x + inset, y: o.y + inset, w: knob, h: knob, fill: ink, radius: r, when: o.when }), onKnob);
  return { widgets: out, h, w };
}
export interface ToggleRowOptions { title: string; subtitle?: string; on: boolean | Condition; on_tap: Action; id?: string; when?: Condition; disabled?: boolean; value?: boolean }
export function toggleRow(k: Kit, box: Box, o: ToggleRowOptions): Piece {
  // The pill already says on or off; the word is for 1-bit panels and for people who want it.
  const value: Value<string> | undefined = o.value === false ? undefined
    : o.on === true ? "On" : o.on === false ? "Off" : { if: o.on, then: "On", else: "Off" };
  return listRow(k, box, { title: o.title, subtitle: o.subtitle, trailing: { value, toggle: o.on }, on_tap: o.on_tap, id: o.id, when: o.when, disabled: o.disabled });
}

// -------------------------------------------------------------------- checkbox / choice ---
export interface CheckboxRowOptions { title: string; subtitle?: string; checked: boolean | Condition; on_tap: Action; id?: string; when?: Condition; disabled?: boolean }
export function checkboxRow(k: Kit, box: Box, o: CheckboxRowOptions): Piece {
  const md = k.iconSize("md");
  return listRow(k, box, {
    title: o.title, subtitle: o.subtitle, on_tap: o.on_tap, id: o.id, when: o.when, disabled: o.disabled,
    leadingWidgets: (cx, cy) => {
      const x = k.snap(cx - md / 2), y = k.snap(cy - md / 2);
      if (o.checked === true) return [k.icon({ x, y, name: Icons.checkbox_on })];
      if (o.checked === false) return [k.icon({ x, y, name: Icons.checkbox_off, tone: "secondary" })];
      return [k.icon({ x, y, name: Icons.checkbox_off, tone: "secondary" }), k.icon({ x, y, name: Icons.checkbox_on, when: o.checked })];
    },
  });
}
export interface ChoiceOption { label: string; sub?: string; value: string; id?: string }
export interface ChoiceListOptions {
  options: ChoiceOption[];
  /** Selected value when known server-side. */
  selected?: string;
  /** A template path (e.g. `vars.feed`) whose value selects the row on the device. */
  selectedPath?: string;
  on_select: (value: string, option: ChoiceOption) => Action;
  gap?: number;
}
/** Radio-style rows: the current one is bold with a check mark at the right. */
export function choiceList(k: Kit, box: Box, o: ChoiceListOptions): Piece {
  return k.stack(box, o.options.map((opt) => (b: Box) => {
    const cond = o.selectedPath ? `${o.selectedPath} == ${opt.value}` : undefined;
    const isSel = o.selected !== undefined && o.selected === opt.value;
    const bold: boolean | Value<Weight> = cond ? { if: cond, then: "bold", else: "regular" } : isSel;
    return listRow(k, b, { title: opt.label, subtitle: opt.sub, bold, trailing: { check: cond ?? isSel }, on_tap: o.on_select(opt.value, opt), id: opt.id });
  }), o.gap ?? 0);
}

// ------------------------------------------------------------------------------ stepper ---
export interface StepperOptions { label: string; value: Value<string>; on_dec: Action; on_inc: Action; min?: boolean; max?: boolean; id?: string }
export function stepper(k: Kit, box: Box, o: StepperOptions): Piece {
  const cell = k.t.touch_target.row, gap = k.t.space[2];
  const valueW = k.snapUp(Math.max(k.measure("00", "md", "bold"), typeof o.value === "string" ? k.measure(o.value, "md", "bold") : 0) + gap);
  const h = k.snapRow(cell);
  const out: Widget[] = [];
  let x = box.x + box.w - cell;
  out.push(...iconButton(k, { x, y: box.y + k.centre(h, cell), icon: Icons.add, on_tap: o.on_inc, disabled: o.max, framed: true, id: o.id ? `${o.id}-inc` : undefined }).widgets);
  x -= gap + valueW;
  out.push(k.text({ x, y: box.y, w: valueW, h, text: o.value, weight: "bold", align: "center", valign: "middle", id: o.id }));
  x -= gap + cell;
  out.push(...iconButton(k, { x, y: box.y + k.centre(h, cell), icon: Icons.remove, on_tap: o.on_dec, disabled: o.min, framed: true, id: o.id ? `${o.id}-dec` : undefined }).widgets);
  out.push(k.text({ x: box.x, y: box.y, w: Math.max(k.u, x - gap - box.x), h, text: o.label, valign: "middle" }));
  return { widgets: out, h };
}

// -------------------------------------------------------------------------------- chips ---
export interface ChipSpec { label: string; selected?: boolean | Condition; on_tap?: Action; icon?: IconName | string; id?: string; when?: Condition }
export interface ChipsOptions { chips: ChipSpec[]; gap?: number }
/** Choice chips, wrapping into rows. Selected chips fill. */
export function chips(k: Kit, box: Box, o: ChipsOptions): Piece {
  const h = k.t.touch_target.row, padX = k.t.space[4], gap = o.gap ?? k.t.space[2], sm = k.iconSize("sm");
  const ink = k.tone("ink"), paper = k.tone("paper"), hair = k.tone("hairline");
  const out: Widget[] = [];
  let x = box.x, y = box.y;
  for (const c of o.chips) {
    const iconW = c.icon ? sm + k.t.space[1] : 0;
    const w = k.snapUp(k.measure(c.label, "sm") + iconW + 2 * padX);
    if (x + w > box.x + box.w && x > box.x) { x = box.x; y += h + gap; }
    const sel = c.selected;
    const fill = sel === true ? ink : typeof sel === "string" ? { if: sel, then: ink, else: paper } : paper;
    const stroke = sel === true ? ink : typeof sel === "string" ? { if: sel, then: ink, else: hair } : hair;
    const color = sel === true ? paper : typeof sel === "string" ? { if: sel, then: paper, else: ink } : ink;
    out.push(k.rect({ x, y, w, h, fill, stroke, stroke_w: 1, radius: Math.floor(h / 2), on_tap: c.on_tap, id: c.id, when: c.when, feedback: c.on_tap ? "invert" : undefined }));
    if (c.icon) out.push(k.icon({ x: x + padX, y: y + k.centre(h, sm), name: c.icon, size: "sm", color, when: c.when }));
    out.push(k.text({ x: x + padX + iconW, y, w: w - 2 * padX - iconW, h, text: c.label, role: "label", align: "center", valign: "middle", color, when: c.when }));
    x += w + gap;
  }
  return { widgets: out, h: y + h - box.y };
}

// ------------------------------------------------------------------------------- slider ---
export interface SliderOptions { steps: number; value: number; on_set: (step: number) => Action; label?: string; caption?: string; id?: string }
/** A discrete slider: `steps` tappable segments, filled up to `value`. There is no dragging on e-paper. */
export function slider(k: Kit, box: Box, o: SliderOptions): Piece {
  const gap = k.u, cell = k.t.touch_target.row, bar = k.t.space[2];
  const out: Widget[] = [];
  let y = box.y;
  if (o.label || o.caption) {
    const lh = k.lh("xs");
    if (o.label) out.push(k.text({ x: box.x, y, w: box.w, h: lh, text: o.label, role: "caption" }));
    if (o.caption) out.push(k.text({ x: box.x, y, w: box.w, h: lh, text: o.caption, role: "meta", align: "right" }));
    y += lh + k.t.space[1];
  }
  const segW = Math.max(k.u, Math.floor((box.w - gap * (o.steps - 1)) / o.steps / k.u) * k.u);
  const x0 = box.x + k.centre(box.w, segW * o.steps + gap * (o.steps - 1));
  for (let i = 0; i < o.steps; i++) {
    const x = x0 + i * (segW + gap);
    out.push(k.target({ x, y, w: segW, h: cell, on_tap: o.on_set(i + 1), id: o.id ? `${o.id}-${i + 1}` : undefined }));
    const by = y + k.centre(cell, bar);
    out.push(i < o.value ? k.rect({ x, y: by, w: segW, h: bar, fill: "ink" })
                         : k.rect({ x, y: by, w: segW, h: bar, fill: "fill_subtle", stroke: "hairline", stroke_w: 1 }));
  }
  return { widgets: out, h: k.snapRow(y + cell - box.y) };
}

// ----------------------------------------------------------------------------- link row ---
export interface LinkRowOptions { title: string; subtitle?: string; meta?: string; leading?: IconName | string; value?: Value<string>; on_tap: Action; id?: string; when?: Condition; read?: boolean }
export function linkRow(k: Kit, box: Box, o: LinkRowOptions): Piece {
  return listRow(k, box, { title: o.title, subtitle: o.subtitle, meta: o.meta, leading: o.leading, trailing: { value: o.value, chevron: true }, on_tap: o.on_tap, id: o.id, when: o.when, read: o.read });
}

// --------------------------------------------------------------------------- action sheet ---
export interface ActionSheetOptions { title?: string; items: { label: string; icon?: IconName | string; on_tap: Action; destructive?: boolean; id?: string }[]; cancel?: Action }
/** A sheet of actions rising from the bottom edge; an overlay (pass to `page({ overlay })`). */
export function actionSheet(k: Kit, o: ActionSheetOptions): Piece {
  const rowH = k.t.touch_target.min, m = k.margin, md = k.iconSize("md"), gap = k.t.space[2];
  const titleH = o.title ? k.lh("xs") + k.t.space[3] : 0;
  const h = k.snapRow(k.t.space[4] + titleH + o.items.length * rowH + (o.cancel ? gap + rowH : 0) + k.t.space[4]);
  const y0 = k.H - h;
  const out: Widget[] = [k.rect({ x: 0, y: y0, w: k.W, h, fill: "paper" }), k.hline(0, y0, k.W, "ink")];
  let y = y0 + k.t.space[4];
  if (o.title) { out.push(k.text({ x: m, y, w: k.contentW, text: o.title, role: "section", align: "center" })); y += titleH; }
  for (const it of o.items) {
    out.push(k.target({ x: 0, y, w: k.W, h: rowH, on_tap: it.on_tap, id: it.id }));
    if (it.icon) out.push(k.icon({ x: m, y: y + k.centre(rowH, md), name: it.icon }));
    out.push(k.text({ x: m + (it.icon ? md + k.t.space[4] : 0), y, w: k.contentW, h: rowH, text: it.label, valign: "middle", weight: it.destructive ? "bold" : "regular" }));
    y += rowH;
  }
  if (o.cancel) {
    y += gap;
    out.push(k.hline(m, y - gap / 2, k.contentW, "hairline"));
    out.push(k.target({ x: 0, y, w: k.W, h: rowH, on_tap: o.cancel }));
    out.push(k.text({ x: m, y, w: k.contentW, h: rowH, text: "Cancel", role: "label", align: "center", valign: "middle", color: k.tone("secondary") }));
  }
  return { widgets: out, h };
}

// ------------------------------------------------------------------------------- dialog ---
export interface DialogOptions { title: string; message?: string; primary: ButtonSpec; secondary?: ButtonSpec; id?: string }
/** A modal card centred on the screen; an overlay. */
export function dialog(k: Kit, o: DialogOptions): Piece {
  const pad = k.t.space[6], w = k.contentW, x = k.margin;
  const inner: Box = { x: x + pad, y: 0, w: w - 2 * pad };
  const body = k.stack(inner, [
    (b) => heading(k, b, { text: o.title, role: "headline", lines: 2 }),
    o.message ? (b) => heading(k, b, { text: o.message!, role: "body", lines: 6 }) : null,
    k.spacer(k.t.space[4]),
    (b) => buttonRow(k, b, { buttons: [...(o.secondary ? [{ kind: "secondary" as const, ...o.secondary }] : []), { kind: "primary" as const, ...o.primary }], size: "md" }),
  ], k.t.space[3]);
  const h = k.snapRow(body.h + 2 * pad);
  const y = k.snap((k.H - h) / 2);
  return { widgets: [
    k.rect({ x, y, w, h, fill: "paper", stroke: "ink", stroke_w: 1, radius: k.t.radius.lg, id: o.id }),
    ...body.widgets.map((wd) => shiftWidget(wd, 0, y + pad)),
  ], h };
}
function shiftWidget(w: Widget, dx: number, dy: number): Widget {
  if (w.type === "line") return { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy };
  return { ...w, x: (w.x ?? 0) + dx, y: (w.y ?? 0) + dy };
}

// ------------------------------------------------------------------------------- keypad ---
export interface KeypadOptions { on_key: (key: string) => Action; on_delete?: Action; on_ok?: Action; display?: Value<string>; id?: string; /** Available height; keys shrink to fit rather than running off the panel. */ h?: number }
/** A numeric keypad: the only text input on a device. */
export function keypad(k: Kit, box: Box, o: KeypadOptions): Piece {
  const gap = k.t.space[2], cols = 3, rows = 4;
  const cellW = Math.floor((box.w - gap * (cols - 1)) / cols / k.u) * k.u;
  const x = box.x + k.centre(box.w, cellW * cols + gap * (cols - 1));
  const out: Widget[] = [];
  let y = box.y;
  const displaySize = o.h && o.h < 10 * k.t.touch_target.row ? "lg" : "2xl";
  if (o.display !== undefined) {
    out.push(k.text({ x: box.x, y, w: box.w, text: o.display, size: displaySize, weight: "bold", align: "center", id: o.id }));
    y += k.lh(displaySize) + k.t.space[2];
    out.push(k.hline(box.x, y, box.w, "hairline"));
    y += k.t.space[4];
  }
  // Keys take the height that is left, never less than the minimum target.
  const room = o.h ? o.h - (y - box.y) : Infinity;
  const cellH = Math.max(k.t.touch_target.min, Math.min(k.t.touch_target.recommended, Math.floor((room - gap * (rows - 1)) / rows / k.u) * k.u));
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const mk = (label: string, i: number, extra: Partial<ButtonWidget> = {}): GridChild => ({
    type: "button", x: 0, y: 0, w: cellW, h: cellH, label, size: "md", fill: k.tone("paper"), stroke: k.tone("hairline"), stroke_w: 1, radius: k.t.radius.md, cell: i, ...extra,
  });
  const children: GridChild[] = keys.map((d, i) => mk(d, i, { on_tap: o.on_key(d) }));
  children.push(mk("", 9, { icon: Icons.backspace, stroke: null, ...(o.on_delete ? { on_tap: o.on_delete } : {}) }));
  children.push(mk("0", 10, { on_tap: o.on_key("0") }));
  children.push(mk("", 11, { icon: Icons.check, fill: k.tone("ink"), stroke: k.tone("ink"), color: k.tone("paper"), ...(o.on_ok ? { on_tap: o.on_ok } : {}) }));
  out.push({ type: "grid", x, y, cols, rows, cell_w: cellW, cell_h: cellH, gap, children });
  return { widgets: out, h: k.snapRow(y + rows * cellH + gap * (rows - 1) - box.y) };
}
