/**
 * Exact TypeScript types for the QuireOS app specification, version 1 (spec/SPEC.md).
 *
 * Naming follows the JSON documents (snake_case) so a typed object serialises to a valid document
 * without translation. Dynamic values are typed with `Tpl<T>` (a literal or a `{{ }}` template
 * string) and `Cond<T>` (the `{ if, then, else }` conditional value).
 */

export const SPEC_VERSION = 1 as const;
export type SpecVersion = typeof SPEC_VERSION;

/** A JSON scalar. Objects and arrays render as the empty string in templates. */
export type Scalar = string | number | boolean | null;

/** A `T` literal, or a string that may contain `{{ expr }}` templates (§3). */
export type Tpl<T = string> = T | string;

/**
 * Conditional value (§3): `then`/`else` may be scalars, templates or another conditional.
 * Nesting depth is limited to 3. A missing `else` resolves to `null` (see spec/NOTES-sdk.md).
 */
export interface Cond<T = Scalar> {
  if: string;
  then: Value<T>;
  else?: Value<T>;
}

/** A property value that may be a literal, a template or a conditional. */
export type Value<T = Scalar> = Tpl<T> | Cond<T>;

/** Ink 0 (black) … 15 (white). */
export type Color = number;

/** A condition string (§3 `cond`), e.g. `"vars.pool == on"` or `"device.online"`. */
export type Condition = string;

/** Absolute (`https://…`, `http://…`) or origin-relative (`/path`) URL, possibly templated. */
export type Url = string;

/** `MAJOR.MINOR.PATCH`. */
export type Version = string;

// ---------------------------------------------------------------------------------------------
// §4 Store index

export interface StoreIndex {
  spec_version: SpecVersion;
  store: { name: string; updated: string };
  apps: StoreApp[];
}

export type AppKind = "hosted" | "external";
export type Visibility = "public" | "unlisted" | "private";

export interface StoreApp {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  version: Version;
  manifest: string;
  min_os: Version;
  screens?: string[];
  categories?: string[];
  author?: string;
  kind?: AppKind;
  visibility?: Visibility;
  installs?: number;
}

/** Optional `store.json` shipped in a bundle: listing metadata the store may merge into its index. */
export interface StoreMeta {
  spec_version?: SpecVersion;
  tagline?: string;
  description?: string;
  categories?: string[];
  screenshots?: string[];
  changelog?: { version: Version; notes: string }[];
}

// ---------------------------------------------------------------------------------------------
// §5 Manifest and settings

export type Orientation = "portrait" | "landscape";

export interface Manifest {
  spec_version: SpecVersion;
  id: string;
  name: string;
  version: Version;
  min_os: Version;
  icon: string;
  orientation?: Orientation;
  screens?: string[];
  entry: Url;
  event?: Url;
  hosts?: string[];
  settings?: Setting[];
}

export type SettingType = "string" | "secret" | "url" | "number" | "bool" | "select" | "list";

interface SettingBase {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
}

export interface StringSetting extends SettingBase {
  type: "string";
  default?: string;
}
export interface SecretSetting extends SettingBase {
  type: "secret";
}
export interface UrlSetting extends SettingBase {
  type: "url";
  default?: string;
}
export interface NumberSetting extends SettingBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}
export interface BoolSetting extends SettingBase {
  type: "bool";
  default?: boolean;
}
export interface SelectOption {
  value: string | number;
  label: string;
}
export interface SelectSetting extends SettingBase {
  type: "select";
  options: SelectOption[];
  default?: string | number;
}
export type ScalarSetting =
  | StringSetting
  | SecretSetting
  | UrlSetting
  | NumberSetting
  | BoolSetting
  | SelectSetting;

export interface ListSetting extends SettingBase {
  type: "list";
  item: ScalarSetting[];
  min?: number;
  max?: number;
  default?: Record<string, Scalar>[];
}

export type Setting = ScalarSetting | ListSetting;

// ---------------------------------------------------------------------------------------------
// §6 Screen document

export type RefreshMode = "auto" | "partial" | "full";

export interface Screen {
  spec_version: SpecVersion;
  id: string;
  url?: Url;
  ttl?: number;
  refresh?: RefreshMode;
  data?: DataSource[];
  vars?: Record<string, Value>;
  /** Hardware-key bindings for this screen (§6). Long press is always Home and cannot be bound. */
  keys?: ScreenKeys;
  widgets: Widget[];
}

export interface ScreenKeys {
  short?: Action;
  double?: Action;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A request body: an object (JSON, templates in string values) or a string sent as-is. */
export type Body = Record<string, unknown> | unknown[] | string;

export interface DataSource {
  id: string;
  url: Tpl;
  method?: "GET" | "POST";
  headers?: Record<string, Tpl>;
  body?: Body;
  body_raw?: boolean;
  ttl?: number;
  required?: boolean;
}

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "digits";
export type Weight = "regular" | "bold";
export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type IconSize = "sm" | "md" | "lg";
export type Feedback = "invert" | "none";

export type WidgetType = "text" | "rect" | "line" | "icon" | "image" | "button" | "grid";

/** §6.1 fields shared by every widget. Geometry is static (never templated). */
export interface WidgetBase {
  type: WidgetType;
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  when?: Condition;
  /** Truthy: drawn dimmed, not hit-tested, `feedback` ignored (§6.1). */
  disabled?: Condition;
  on_tap?: Action;
  on_hold?: Action;
  feedback?: Value<Feedback>;
  /** Grid children only: cell index (row-major) or `[col, row]`. */
  cell?: number | [number, number];
}

export interface TextWidget extends WidgetBase {
  type: "text";
  x: number;
  y: number;
  w: number;
  text: Value<string>;
  size?: Value<TextSize>;
  weight?: Value<Weight>;
  align?: Value<Align>;
  valign?: Value<VAlign>;
  color?: Value<Color>;
  lines?: number;
}

export interface RectWidget extends WidgetBase {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Value<Color | null>;
  stroke?: Value<Color | null>;
  stroke_w?: number;
  radius?: number;
}

export interface LineWidget extends WidgetBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: Value<Color>;
  width?: number;
}

export interface IconWidget extends WidgetBase {
  type: "icon";
  x: number;
  y: number;
  name: Value<string>;
  size?: Value<IconSize>;
  color?: Value<Color>;
}

export interface ImageWidget extends WidgetBase {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  src: Tpl;
  ttl?: number;
}

export interface ButtonWidget extends WidgetBase {
  type: "button";
  x: number;
  y: number;
  w: number;
  h: number;
  label: Value<string>;
  sub?: Value<string>;
  icon?: Value<string>;
  size?: Value<TextSize>;
  lines?: number;
  fill?: Value<Color | null>;
  stroke?: Value<Color | null>;
  stroke_w?: number;
  radius?: number;
  color?: Value<Color>;
}

/** Any widget type except `grid`; inside a grid `x, y, w, h` are optional and cell-relative. */
export type GridChild = (
  | Omit<TextWidget, "x" | "y" | "w">
  | Omit<RectWidget, "x" | "y" | "w" | "h">
  | LineWidget
  | Omit<IconWidget, "x" | "y">
  | Omit<ImageWidget, "x" | "y" | "w" | "h">
  | Omit<ButtonWidget, "x" | "y" | "w" | "h">
) & {
  cell: number | [number, number];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export interface GridWidget extends WidgetBase {
  type: "grid";
  x: number;
  y: number;
  cols: number;
  rows: number;
  cell_w: number;
  cell_h: number;
  gap: number;
  children: GridChild[];
}

export type Widget =
  | TextWidget
  | RectWidget
  | LineWidget
  | IconWidget
  | ImageWidget
  | ButtonWidget
  | GridWidget;

// ---------------------------------------------------------------------------------------------
// §7 Actions

export type ActionType = "navigate" | "submit" | "http" | "set" | "refresh" | "back" | "home";
export type Then = "none" | "refresh" | "back" | "home" | "navigate";

export interface NavigateAction {
  type: "navigate";
  url: Tpl;
  replace?: boolean;
}

export interface SubmitAction {
  type: "submit";
  event: string;
  args?: Record<string, Value>;
  set?: Record<string, Value>;
  then?: Then;
  /** Target when `then` is `navigate`. */
  then_url?: Tpl;
  after?: number;
}

export interface HttpAction {
  type: "http";
  method?: HttpMethod;
  url: Tpl;
  headers?: Record<string, Tpl>;
  body?: Body;
  body_raw?: boolean;
  set?: Record<string, Value>;
  then?: Then;
  /** Target when `then` is `navigate`. */
  then_url?: Tpl;
  after?: number;
}

export interface SetAction {
  type: "set";
  vars: Record<string, Value>;
  then?: Then;
  /** Target when `then` is `navigate`. */
  then_url?: Tpl;
  after?: number;
}

export interface RefreshAction {
  type: "refresh";
}
export interface BackAction {
  type: "back";
}
export interface HomeAction {
  type: "home";
}

export type Action =
  | NavigateAction
  | SubmitAction
  | HttpAction
  | SetAction
  | RefreshAction
  | BackAction
  | HomeAction;

// ---------------------------------------------------------------------------------------------
// §8 Protocol

/** §8.3 body POSTed to the manifest `event` URL. */
export interface SubmitEvent {
  spec_version: SpecVersion;
  event: string;
  screen: string;
  /** The tapped widget's `id`, or `#<index>` when it has none. */
  widget: string;
  args?: Record<string, string>;
  vars?: Record<string, string>;
  x?: number;
  y?: number;
  ts?: number;
}

/** §8.2 error body. */
export interface ErrorBody {
  spec_version: SpecVersion;
  error: { code: string; message: string };
}

/**
 * §2 request headers, parsed. Note that the template variable `device.rssi` (see `DeviceVars`)
 * is `-100` when the device is offline; the headers below carry no signal information.
 */
export interface DeviceContext {
  /** `X-Device-Id`; empty when absent (e.g. a browser). */
  id: string;
  osVersion: string;
  specVersion: number;
  /** `X-Screen`: logical width × height × grey levels @ dpi. */
  screen: { w: number; h: number; greys: number; dpi: number };
  tz: string;
  locale: string;
  installId?: string;
  appId?: string;
  appVersion?: string;
  /** `X-App-Settings`, URL-decoded and parsed. Never contains secrets. */
  settings: Record<string, unknown>;
  userAgent: string;
  /** `If-None-Match`, verbatim, when present. */
  ifNoneMatch?: string;
  /** True when the request carried QuireOS device headers. */
  isDevice: boolean;
}

// ---------------------------------------------------------------------------------------------
// §10 Device profiles (spec/fonts.json)

export interface FontFace {
  default_advance: number;
  advance: Record<string, number>;
}

export interface FontSize {
  line_height: number;
  ascent: number;
  regular: FontFace;
  bold?: FontFace;
}

export interface Profile {
  dpi: number;
  native: [number, number];
  default_orientation: Orientation;
  greys: number;
  sizes: Partial<Record<TextSize, FontSize>>;
  icons: Record<IconSize, number>;
}

export interface ProfilesDocument {
  spec_version: number;
  profiles: Record<string, Profile>;
}

/** Result shape of every validator. `path` is a JSON pointer (`/widgets/3/text`). */
export interface ValidationError {
  path: string;
  message: string;
}
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}
