/** Thin typed builders for §6 screens and widgets. Only `type` (and `spec_version`) are filled in; device defaults stay implicit so documents remain small. */
import { prune } from "./actions.js";
import { SPEC_VERSION } from "./types.js";
import type {
  ButtonWidget,
  DataSource,
  GridChild,
  GridWidget,
  IconWidget,
  ImageWidget,
  LineWidget,
  RectWidget,
  Screen,
  TextWidget,
  Widget,
} from "./types.js";

type NoType<T> = Omit<T, "type">;

/** `screen({ id: "home", widgets: [...] })` adds `spec_version: 1`. */
export function screen(doc: Omit<Screen, "spec_version"> & { spec_version?: 1 }): Screen {
  return prune({ spec_version: SPEC_VERSION, ...doc }) as Screen;
}

export function text(props: NoType<TextWidget>): TextWidget {
  return prune({ type: "text", ...props }) as TextWidget;
}
export function rect(props: NoType<RectWidget>): RectWidget {
  return prune({ type: "rect", ...props }) as RectWidget;
}
export function line(props: NoType<LineWidget>): LineWidget {
  return prune({ type: "line", ...props }) as LineWidget;
}
export function icon(props: NoType<IconWidget>): IconWidget {
  return prune({ type: "icon", ...props }) as IconWidget;
}
export function image(props: NoType<ImageWidget>): ImageWidget {
  return prune({ type: "image", ...props }) as ImageWidget;
}
export function button(props: NoType<ButtonWidget>): ButtonWidget {
  return prune({ type: "button", ...props }) as ButtonWidget;
}
export function grid(props: NoType<GridWidget>): GridWidget {
  return prune({ type: "grid", ...props }) as GridWidget;
}
export function data(props: DataSource): DataSource {
  return prune(props);
}

/** Places a widget in a grid cell (`cell` index or `[col, row]`). */
export function cell(at: number | [number, number], widget: Exclude<Widget, GridWidget>): GridChild {
  return { ...(widget as object), cell: at } as GridChild;
}

/** Counts widgets including grid children (the §6 limit of 96 applies to this number). */
export function countWidgets(widgets: Widget[]): number {
  let n = 0;
  for (const w of widgets) {
    n++;
    if (w.type === "grid" && Array.isArray(w.children)) n += w.children.length;
  }
  return n;
}
