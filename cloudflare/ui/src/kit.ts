// The kit: one object per request that knows the device profile, the theme and the tokens, and
// turns components into spec widgets laid out for that device. Components live in ./components
// and are bound here so `ui.navBar(...)` reads naturally.
import {
  resolveProfile, parseScreen, toneTable, collapsedTones, roles,
  type Profile, type ProfileTokens, type ToneName, type RoleName, type Orientation, type ProfileId,
} from "./profile.js";
import { measure, wrap, truncate, lineHeight, hasFontTables } from "./text.js";
import { validateScreen, type Problem } from "./validate.js";
import { etag as sdkEtag, canonicalJson } from "@quireos/sdk";
import type {
  Action, Box, Frame, Piece, Screen, ScreenKeys, Widget, TextWidget, RectWidget, LineWidget, IconWidget,
  TextSize, Weight, Value, Color, Condition, IconSize, Align, VAlign, DataSource, Scalar,
} from "./types.js";
import type { IconName } from "./icons.js";
import * as chrome from "./components/chrome.js";
import * as content from "./components/content.js";
import * as controls from "./components/controls.js";
import * as system from "./components/system.js";

export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";

export interface KitOptions {
  /** Profile id (`t5pro`, `panel75`, …). Overrides `screen`. */
  profile?: ProfileId | string;
  /** Logical orientation; defaults to the profile's, or to the X-Screen shape. */
  orientation?: Orientation;
  /** The raw `X-Screen` header, e.g. `540x960x16@235`. */
  screen?: string | null;
  theme?: Theme;
  density?: Density;
}

export interface TextOptions {
  x: number; y: number; w: number;
  text: Value<string>;
  role?: RoleName;
  size?: TextSize; weight?: Value<Weight>; tone?: ToneName; color?: Value<Color>;
  align?: Align; valign?: VAlign; lines?: number; h?: number;
  id?: string; when?: Condition; on_tap?: Action;
}
export interface RectOptions {
  x: number; y: number; w: number; h: number;
  fill?: ToneName | Value<Color | null> | null; stroke?: ToneName | Value<Color | null> | null; stroke_w?: number; radius?: number;
  id?: string; when?: Condition; on_tap?: Action; on_hold?: Action; feedback?: "invert" | "none";
}
export type StackItem = ((box: Box) => Piece | Widget[] | null | undefined) | null | undefined | false;

export interface PageOptions {
  id: string;
  nav?: chrome.NavBarOptions;
  toolbar?: chrome.ToolbarOptions;
  body?: (frame: Frame) => Piece | Widget[];
  /** Drawn last, over the chrome: dialogs, sheets. */
  overlay?: Piece | Widget[];
  refresh?: Screen["refresh"]; ttl?: number; url?: string;
  data?: DataSource[]; vars?: Record<string, Value<Scalar>>;
  keys?: ScreenKeys;
}

export class Kit {
  readonly p: Profile;
  readonly t: ProfileTokens;
  readonly theme: Theme;
  readonly density: Density;
  /** The pixel unit: 4 on high-dpi panels, 2 on low. */
  readonly u: number;
  readonly W: number;
  readonly H: number;
  readonly margin: number;
  /** True when the firmware has no font tables for this profile and widths are scaled estimates. */
  readonly approximate: boolean;
  /** Set by `page()` when the body ran past the content frame. An e-paper screen cannot scroll, so this is a bug in the screen, not a hint. */
  overflow: { by: number; frame: Frame } | null = null;
  private seq = 0;

  constructor(opts: KitOptions = {}) {
    this.p = resolveProfile({ profile: opts.profile, orientation: opts.orientation, screen: parseScreen(opts.screen) });
    this.t = this.p.t;
    this.theme = opts.theme ?? "light";
    this.density = opts.density ?? "comfortable";
    this.u = this.t.u;
    this.W = this.p.w;
    this.H = this.p.h;
    this.margin = this.t.space.page;
    this.approximate = !hasFontTables(this.p.id);
  }

  // ----------------------------------------------------------------------------- basics ---
  id(prefix = "w"): string { return `${prefix}${++this.seq}`; }
  snap(v: number): number { return Math.round(v / this.u) * this.u; }
  snapUp(v: number): number { return Math.ceil(v / this.u) * this.u; }
  /** Rounds a block's height up to the vertical rhythm (2u), so a column of mixed components keeps one beat. */
  snapRow(v: number): number { const r = this.t.space.rhythm; return Math.ceil(v / r) * r; }
  tone(name: ToneName): number { return toneTable(this.p.depth, this.theme)[name]; }
  /**
   * The opposite of a condition, by flipping its comparison. The spec has no `!`, so a widget that
   * must appear only when a condition is false needs this. Returns null for a bare truthiness test,
   * which cannot be inverted.
   */
  not(c: Condition): Condition | null {
    const m = /^(.*?)\s*(==|!=|<=|>=|<|>)\s*(.*)$/.exec(c);
    if (!m) return null;
    const flip: Record<string, string> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", ">": "<=", "<=": ">" };
    return `${m[1]!.trim()} ${flip[m[2]!]} ${m[3]!.trim()}`;
  }
  /** True when this tone equals ink or paper on the device's panel and carries no meaning. */
  collapsed(name: ToneName): boolean { return collapsedTones(this.p.depth).includes(name); }
  lh(size: TextSize): number { return lineHeight(this.p.id, size); }
  role(name: RoleName) { return roles[name]; }
  measure(text: string, size: TextSize, weight: Weight = "regular"): number { return measure(this.p.id, size, weight, text); }
  wrap(text: string, size: TextSize, weight: Weight, maxW: number, maxLines = 0): string[] { return wrap(this.p.id, size, weight, text, maxW, maxLines); }
  truncate(text: string, size: TextSize, weight: Weight, maxW: number): string { return truncate(this.p.id, size, weight, text, maxW); }
  get rowInset(): number { return this.density === "compact" ? this.t.space.inset_compact : this.t.space.inset; }
  /** Content width, snapped down to the unit; the remainder goes to the right margin so right-aligned edges stay on the grid. */
  get contentW(): number { return Math.floor((this.W - 2 * this.margin) / this.u) * this.u; }
  /** The content region's right edge. */
  get right(): number { return this.margin + this.contentW; }
  /** Icon size that fits the chrome: `md`, or `sm` on badges whose bars are shorter than a medium icon. */
  get chromeIcon(): IconSize { return this.t.chrome.nav >= this.t.icon.md + 2 * this.u ? "md" : "sm"; }
  /** The OS corner: fixed on every screen, apps keep it clear. */
  cornerRect(): Frame {
    const c = this.t.chrome.corner;
    return { x: this.right - c, y: Math.max(0, this.snap((this.t.chrome.nav - c) / 2)), w: c, h: c };
  }
  private ink(v: ToneName | Value<Color | null> | null | undefined): Value<Color | null> | null | undefined {
    if (v === null || v === undefined) return v;
    return typeof v === "string" && v in toneTable(this.p.depth, this.theme) ? this.tone(v as ToneName) : (v as Value<Color | null>);
  }

  // ------------------------------------------------------------------------- primitives ---
  text(o: TextOptions): TextWidget {
    const r = o.role ? this.role(o.role) : undefined;
    const size = o.size ?? (r?.size as TextSize | undefined) ?? "md";
    const weight: Value<Weight> = o.weight ?? (r?.weight as Weight | undefined) ?? "regular";
    const tone = o.tone ?? (r?.tone as ToneName | undefined) ?? "ink";
    const color = o.color ?? this.tone(tone);
    const w: TextWidget = { type: "text", x: o.x, y: o.y, w: o.w, text: o.text };
    if (o.id) w.id = o.id;
    if (size !== "md") w.size = size;
    if (weight !== "regular") w.weight = weight;
    if (o.align && o.align !== "left") w.align = o.align;
    if (o.valign && o.valign !== "top") w.valign = o.valign;
    if (color !== 0) w.color = color;
    if (o.lines && o.lines > 1) w.lines = Math.min(8, o.lines);
    if (o.h !== undefined) w.h = o.h;
    if (o.when) w.when = o.when;
    if (o.on_tap) w.on_tap = o.on_tap;
    return w;
  }
  rect(o: RectOptions): RectWidget {
    const w: RectWidget = { type: "rect", x: o.x, y: o.y, w: o.w, h: o.h };
    if (o.id) w.id = o.id;
    const fill = this.ink(o.fill), stroke = this.ink(o.stroke);
    if (fill !== undefined && fill !== null) w.fill = fill;
    if (stroke !== undefined && stroke !== null) w.stroke = stroke;
    if (o.stroke_w !== undefined && o.stroke_w !== 2) w.stroke_w = o.stroke_w;
    if (o.radius) w.radius = Math.floor(o.radius);
    if (o.when) w.when = o.when;
    if (o.on_tap) w.on_tap = o.on_tap;
    if (o.on_hold) w.on_hold = o.on_hold;
    if (o.feedback) w.feedback = o.feedback;
    return w;
  }
  /** Vertical centre of a `h`-tall box for a `size`-tall thing, on the unit grid and never negative. */
  centre(boxH: number, itemH: number): number { return Math.max(0, this.snap((boxH - itemH) / 2)); }
  hline(x: number, y: number, w: number, tone: ToneName = "hairline", width = 1): LineWidget {
    const l: LineWidget = { type: "line", x1: x, y1: y, x2: x + w - 1, y2: y };
    const c = this.tone(tone); if (c !== 0) l.color = c;
    if (width !== 1) l.width = width;
    return l;
  }
  vline(x: number, y: number, h: number, tone: ToneName = "hairline", width = 1): LineWidget {
    const l: LineWidget = { type: "line", x1: x, y1: y, x2: x, y2: y + h - 1 };
    const c = this.tone(tone); if (c !== 0) l.color = c;
    if (width !== 1) l.width = width;
    return l;
  }
  icon(o: { x: number; y: number; name: IconName | string; size?: IconSize; tone?: ToneName; color?: Value<Color>; when?: Condition; id?: string; on_tap?: Action }): IconWidget {
    const w: IconWidget = { type: "icon", x: o.x, y: o.y, name: o.name };
    if (o.size && o.size !== "md") w.size = o.size;
    const color = o.color ?? this.tone(o.tone ?? "ink");
    if (color !== 0) w.color = color;
    if (o.when) w.when = o.when;
    if (o.id) w.id = o.id;
    if (o.on_tap) w.on_tap = o.on_tap;
    return w;
  }
  /** A transparent hit area (no fill, no stroke) with tap inversion. */
  target(o: { x: number; y: number; w: number; h: number; on_tap?: Action; on_hold?: Action; id?: string; when?: Condition; feedback?: "invert" | "none" }): RectWidget {
    return this.rect({ x: o.x, y: o.y, w: o.w, h: o.h, on_tap: o.on_tap, on_hold: o.on_hold, id: o.id, when: o.when, feedback: o.feedback ?? "invert" });
  }
  iconSize(size: IconSize): number { return this.t.icon[size]; }

  // ------------------------------------------------------------------------------ layout ---
  /** Lays items out top to bottom in `box`, `gap` apart (default space.gap), snapping each top to the unit. Boxes that would run into the OS corner are narrowed to clear it. */
  stack(box: Box, items: StackItem[], gap: number = this.t.space.gap): Piece {
    const out: Widget[] = [];
    const corner = this.cornerRect();
    let y = box.y;
    let first = true;
    for (const item of items) {
      if (!item) continue;
      if (!first) y += gap;
      y = this.snapUp(y);
      let b: Box = { x: box.x, y, w: box.w };
      if (y < corner.y + corner.h && box.x + box.w > corner.x - this.t.space.gap) {
        b = { x: box.x, y, w: Math.max(this.u, corner.x - this.t.space.gap - box.x) };
      }
      const r = item(b);
      if (!r) continue;
      const piece = Array.isArray(r) ? { widgets: r, h: 0 } : r;
      if (piece.widgets.length === 0 && piece.h === 0) continue;
      out.push(...piece.widgets);
      y += piece.h;
      first = false;
    }
    return { widgets: out, h: y - box.y };
  }
  /** Splits a box into `n` equal columns `gap` apart (default space.gutter); the remainder goes to the outer edges. */
  columns(box: Box, n: number, gap: number = this.t.space.gutter): Box[] {
    const cw = Math.floor((box.w - gap * (n - 1)) / n / this.u) * this.u;
    const total = cw * n + gap * (n - 1);
    const x0 = box.x + this.snap((box.w - total) / 2);
    return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y: box.y, w: cw }));
  }
  /** Column count for a content width, from the class's minimum column. */
  columnCount(w: number): number {
    const gap = this.t.space.gutter;
    return Math.max(1, Math.floor((w + gap) / (this.t.layout.min_column + gap)));
  }
  spacer(h: number): StackItem { return () => ({ widgets: [], h }); }

  /**
   * Lays out only the items that fit on `page`, and says how many pages the whole list takes.
   * An e-paper screen cannot scroll, so a list longer than its frame is paged, never clipped: the
   * server decides where the breaks fall, exactly as it does for text.
   */
  paged(frame: Frame, items: StackItem[], o: { page?: number; gap?: number } = {}): Piece & { pages: number; page: number } {
    const gap = o.gap ?? this.t.space.gap;
    const probe: Box = { x: frame.x, y: 0, w: frame.w };
    const measured = items.map((it) => {
      if (!it) return null;
      const r = it(probe);
      if (!r) return null;
      if (Array.isArray(r)) return { h: 0, keep: false };
      return { h: r.h, keep: !!r.keepWithNext };
    });
    // Greedy break: an item that does not fit starts the next page. One item per page at worst.
    // A section header that would be left alone at the foot of a page introduces nothing, so the
    // break moves back to take it along — unless the pair is itself taller than a page.
    const starts: number[] = [0];
    let used = 0;
    measured.forEach((m, i) => {
      if (m === null) return;
      const need = m.h + (used > 0 ? gap : 0);
      if (used === 0 || used + need <= frame.h) { used += need; return; }
      const pageStart = starts[starts.length - 1]!;
      let prev = i - 1;
      while (prev > pageStart && measured[prev] === null) prev--;
      const p = measured[prev];
      if (prev > pageStart && p?.keep && p.h + gap + m.h <= frame.h) { starts.push(prev); used = p.h + gap + m.h; }
      else { starts.push(i); used = m.h; }
    });
    const pages = starts.length;
    const page = Math.min(Math.max(1, Math.round(o.page ?? 1)), pages);
    this.pageCount = Math.max(this.pageCount, pages);
    const from = starts[page - 1]!, to = page < pages ? starts[page]! : items.length;
    const piece = this.stack(frame, items.slice(from, to), gap);
    return { ...piece, pages, page };
  }
  /**
   * How many pages this screen takes: the largest count reported by `paged()` or `paginate()` while
   * building it. A caller that generates every page of a screen reads this after building page one.
   */
  pageCount = 1;

  /**
   * Lays out the first variant that fits the frame, most ornate first. A screen that must say one
   * thing — an error, a setup step, a code — says it on a 13-inch tablet with an icon and air, and
   * on a 2.9-inch badge with neither, rather than running off the panel.
   */
  fit(frame: Frame, variants: StackItem[][], gap: number = this.t.space.gap): Piece {
    const probe: Box = { x: frame.x, y: 0, w: frame.w };
    for (const items of variants) {
      let total = 0, n = 0;
      for (const it of items) {
        if (!it) continue;
        const r = it(probe);
        if (!r) continue;
        total += (Array.isArray(r) ? 0 : r.h) + (n > 0 ? gap : 0);
        n++;
      }
      if (total <= frame.h) return this.stack(frame, items, gap);
    }
    return this.stack(frame, variants[variants.length - 1] ?? [], gap);
  }
  /** A stack item that lays a fixed piece (already positioned) into the flow, consuming `h`. */
  fixed(piece: Piece): StackItem { return () => piece; }

  /** The content frame left after chrome. */
  frame(o: { nav?: boolean; toolbarRows?: number; rail?: boolean } = {}): Frame {
    const nav = o.nav ? this.t.chrome.nav : 0;
    const rail = o.rail ? this.t.chrome.rail : 0;
    const toolbar = !o.rail && o.toolbarRows ? o.toolbarRows * this.t.chrome.toolbar : 0;
    const gap = this.t.space.gap;
    const x = rail + this.margin;
    const y = nav ? nav + gap : this.margin;
    const bottom = toolbar ? this.H - toolbar - gap : this.H - this.margin;
    return { x, y, w: this.right - x, h: bottom - y };
  }

  /** Assembles a screen: chrome, body in the frame, overlays last. */
  page(o: PageOptions): Screen {
    const widgets: Widget[] = [];
    const keys: ScreenKeys = { ...(o.keys ?? {}) };
    const useRail = !!o.toolbar && this.p.orientation === "landscape" && this.p.class !== "badge" && o.toolbar.placement !== "bottom";
    const rows = o.toolbar?.rows.length ?? 0;
    const f = this.frame({ nav: !!o.nav, toolbarRows: useRail ? 0 : rows, rail: useRail });
    this.overflow = null;
    if (o.body) {
      const r = o.body(f);
      const body = Array.isArray(r) ? r : r.widgets;
      widgets.push(...body);
      if (!Array.isArray(r) && r.keys) Object.assign(keys, r.keys);
      // Nothing scrolls on e-paper: a body taller than its frame is content the person can never see.
      let bottom = f.y + (Array.isArray(r) ? 0 : r.h);
      for (const w of body) {
        if (w.type === "line") { bottom = Math.max(bottom, w.y1, w.y2); continue; }
        if (w.type === "grid") { bottom = Math.max(bottom, w.y + w.rows * w.cell_h + (w.rows - 1) * w.gap); continue; }
        bottom = Math.max(bottom, (w.y ?? 0) + (w.h ?? 0));
      }
      const by = Math.round(bottom - (f.y + f.h));
      if (by > 0) this.overflow = { by, frame: f };
    }
    if (o.nav) widgets.push(...chrome.navBar(this, o.nav).widgets);
    if (o.toolbar) {
      const piece = useRail ? chrome.rail(this, { cells: o.toolbar.rows.flat(), top: o.nav ? this.t.chrome.nav : 0 }) : chrome.toolbar(this, o.toolbar);
      widgets.push(...piece.widgets);
      if (piece.keys) Object.assign(keys, piece.keys);
    }
    if (o.overlay) widgets.push(...(Array.isArray(o.overlay) ? o.overlay : o.overlay.widgets));
    const screen: Screen = { spec_version: 1, id: o.id, widgets };
    if (o.url) screen.url = o.url;
    if (o.ttl !== undefined) screen.ttl = o.ttl;
    if (o.refresh && o.refresh !== "auto") screen.refresh = o.refresh;
    void 0;
    if (o.data?.length) screen.data = o.data;
    if (o.vars && Object.keys(o.vars).length) screen.vars = o.vars;
    if (Object.keys(keys).length) screen.keys = keys;
    return screen;
  }
  validate(screen: Screen): Problem[] {
    const out = validateScreen(screen);
    if (this.overflow) out.push({ path: "/widgets", message: `content runs ${this.overflow.by} px past the ${this.overflow.frame.h} px frame; an e-paper screen cannot scroll` });
    return out;
  }
  /** Strong ETag over the canonical JSON (SDK). */
  etag(screen: Screen): Promise<string> { return sdkEtag(canonicalJson(screen)); }

  // -------------------------------------------------------------------------- components ---
  navBar = (o: chrome.NavBarOptions) => chrome.navBar(this, o);
  toolbar = (o: chrome.ToolbarOptions) => chrome.toolbar(this, o);
  rail = (o: chrome.RailOptions) => chrome.rail(this, o);
  pagerRow = (o: chrome.PagerOptions) => chrome.pagerRow(this, o);
  segmented = (box: Box, o: chrome.SegmentedOptions) => chrome.segmented(this, box, o);
  statusBar = (o: chrome.StatusBarOptions) => chrome.statusBar(this, o);
  systemCorner = (o: chrome.SystemCornerOptions) => chrome.systemCorner(this, o);
  toast = (o: chrome.ToastOptions) => chrome.toast(this, o);

  heading = (box: Box, o: content.HeadingOptions) => content.heading(this, box, o);
  listRow = (box: Box, o: content.ListRowOptions) => content.listRow(this, box, o);
  sectionHeader = (box: Box, o: content.SectionHeaderOptions) => content.sectionHeader(this, box, o);
  divider = (box: Box, o?: content.DividerOptions) => content.divider(this, box, o);
  card = (box: Box, o: content.CardOptions) => content.card(this, box, o);
  tile = (o: content.TileOptions) => content.tile(this, o);
  tileGrid = (frame: Frame, o: content.TileGridOptions) => content.tileGrid(this, frame, o);
  stat = (box: Box, o: content.StatOptions) => content.stat(this, box, o);
  keyValue = (box: Box, o: content.KeyValueOptions) => content.keyValue(this, box, o);
  paragraph = (box: Box, o: content.ParagraphOptions) => content.paragraph(this, box, o);
  paginate = (w: number, h: number, o: content.PaginateOptions) => content.paginate(this, w, h, o);
  textLines = (box: Box, o: content.TextLinesOptions) => content.textLines(this, box, o);
  metaLine = (box: Box, o: content.MetaLineOptions) => content.metaLine(this, box, o);
  pill = (o: content.PillOptions) => content.pill(this, o);
  badge = (o: content.BadgeOptions) => content.badge(this, o);
  progress = (box: Box, o: content.ProgressOptions) => content.progress(this, box, o);
  steps = (box: Box, o: content.StepsOptions) => content.steps(this, box, o);
  barChart = (box: Box, o: content.BarChartOptions) => content.barChart(this, box, o);
  sparkline = (box: Box, o: content.SparklineOptions) => content.sparkline(this, box, o);
  table = (box: Box, o: content.TableOptions) => content.table(this, box, o);
  imageBlock = (box: Box, o: content.ImageOptions) => content.imageBlock(this, box, o);
  emptyState = (box: Box, o: content.EmptyStateOptions) => content.emptyState(this, box, o);
  batteryGlyph = (o: content.BatteryGlyphOptions) => content.batteryGlyph(this, o);
  wifiGlyph = (o: content.WifiGlyphOptions) => content.wifiGlyph(this, o);

  button = (o: controls.ButtonOptions) => controls.button(this, o);
  buttonRow = (box: Box, o: controls.ButtonRowOptions) => controls.buttonRow(this, box, o);
  iconButton = (o: controls.IconButtonOptions) => controls.iconButton(this, o);
  toggle = (o: controls.ToggleOptions) => controls.toggle(this, o);
  toggleRow = (box: Box, o: controls.ToggleRowOptions) => controls.toggleRow(this, box, o);
  checkboxRow = (box: Box, o: controls.CheckboxRowOptions) => controls.checkboxRow(this, box, o);
  choiceList = (box: Box, o: controls.ChoiceListOptions) => controls.choiceList(this, box, o);
  stepper = (box: Box, o: controls.StepperOptions) => controls.stepper(this, box, o);
  chips = (box: Box, o: controls.ChipsOptions) => controls.chips(this, box, o);
  slider = (box: Box, o: controls.SliderOptions) => controls.slider(this, box, o);
  linkRow = (box: Box, o: controls.LinkRowOptions) => controls.linkRow(this, box, o);
  actionSheet = (o: controls.ActionSheetOptions) => controls.actionSheet(this, o);
  dialog = (o: controls.DialogOptions) => controls.dialog(this, o);
  keypad = (box: Box, o: controls.KeypadOptions) => controls.keypad(this, box, o);

  launcherGrid = (frame: Frame, o: system.LauncherOptions) => system.launcherGrid(this, frame, o);
  storeRow = (box: Box, o: system.StoreRowOptions) => system.storeRow(this, box, o);
  errorScreen = (o: system.ErrorScreenOptions) => system.errorScreen(this, o);
  setupScreen = (o: system.SetupScreenOptions) => system.setupScreen(this, o);
  needsSetupScreen = (o: system.NeedsSetupOptions) => system.needsSetupScreen(this, o);
  updateOsScreen = (o: system.UpdateOsOptions) => system.updateOsScreen(this, o);
  pairingScreen = (o: system.PairingOptions) => system.pairingScreen(this, o);
}

export function createKit(opts: KitOptions = {}): Kit { return new Kit(opts); }

/** Builds a kit from a request's `X-Screen` header (any object with `headers.get`). */
export function kitFromRequest(req: { headers: { get(name: string): string | null } }, opts: Omit<KitOptions, "screen"> = {}): Kit {
  return new Kit({ ...opts, screen: req.headers.get("X-Screen") ?? req.headers.get("x-screen") });
}
