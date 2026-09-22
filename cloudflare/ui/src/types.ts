// The kit uses the SDK's spec types directly (cloudflare/sdk/src/types.ts) and adds only its own
// layout vocabulary. `Cond<T>` is the `{ if, then, else }` object; `Condition` is the string.
export type {
  Scalar, Tpl, Cond, Value, Color, Condition, Url, Orientation,
  Screen as SpecScreen, RefreshMode, DataSource,
  TextSize, Weight, Align, VAlign, IconSize, Feedback, WidgetType, WidgetBase,
  TextWidget, RectWidget, LineWidget, IconWidget, ImageWidget, ButtonWidget, GridChild, GridWidget, Widget,
  Action, NavigateAction, SubmitAction, HttpAction, SetAction, RefreshAction, BackAction, HomeAction,
  Manifest, Setting, Profile as FontProfile, ValidationError,
} from "@quireos/sdk";
import type { Screen as SpecScreen, Action } from "@quireos/sdk";

/** SPEC §6 `keys`: actions for the function button on button-only devices. A long press is always Home, so only `short` and `double` exist; a screen that claims neither gets short = Home, double = full redraw. */
export interface ScreenKeys { short?: Action; double?: Action }
/** A spec screen with the `keys` map typed. */
export type Screen = SpecScreen & { keys?: ScreenKeys };

/** A laid-out fragment: widgets plus the height it consumed (and width, for inline pieces). */
export interface Piece {
  widgets: import("@quireos/sdk").Widget[];
  h: number;
  w?: number;
  keys?: ScreenKeys;
  /** This piece introduces what follows it (a section header), so a page break must not fall after it. */
  keepWithNext?: boolean;
}
/** A horizontal slot to lay a piece into. */
export interface Box { x: number; y: number; w: number }
export interface Frame extends Box { h: number }
