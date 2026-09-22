// OS-owned screens and parts, defined here so the launcher, store and built-in screens share the
// system's look, and so the gallery can show them. Apps do not draw these.
import type { Kit } from "../kit.js";
import type { Action, Box, Frame, Piece, Screen, Widget, GridChild } from "../types.js";
import { Icons, type IconName } from "../icons.js";
import { listRow, heading, paragraph } from "./content.js";
import { buttonRow } from "./controls.js";

// ----------------------------------------------------------------------------- launcher ---
export interface LauncherApp { name: string; icon: IconName | string | { src: string }; on_tap: Action; update?: boolean; id?: string }
export interface LauncherOptions { apps: LauncherApp[]; cols?: number }
/**
 * The launcher's grid. An app is a glyph inside a rounded square, not a glyph blown up to fill the
 * cell: a 24-unit icon scaled past about 3× turns its strokes into slabs.
 */
export function launcherGrid(k: Kit, frame: Frame, o: LauncherOptions): Piece {
  const md = k.iconSize("md"), sm = k.iconSize("sm"), gap = k.t.space.gutter;
  const badgeSize = k.t.touch_target.recommended;                 // the app's rounded square
  const cols = o.cols ?? Math.max(2, Math.floor((frame.w + gap) / (badgeSize + gap)));
  const cellW = Math.floor((frame.w - gap * (cols - 1)) / cols / k.u) * k.u;
  const tile = Math.min(badgeSize, cellW);
  const labelLines = o.apps.some((a) => k.measure(a.name, "sm") > cellW) ? 2 : 1;
  const cellH = k.snapRow(tile + k.t.space[2] + k.lh("sm") * labelLines);
  const rows = Math.max(1, Math.ceil(o.apps.length / cols));
  const x = frame.x + k.centre(frame.w, cellW * cols + gap * (cols - 1));
  const tx = k.centre(cellW, tile);
  const children: GridChild[] = [];
  o.apps.forEach((a, i) => {
    // Every child carries explicit w/h: a grid child that omits them fills its cell (SPEC §6.2),
    // which would centre each glyph in the whole cell and float the update mark into the middle.
    children.push({ ...k.target({ x: tx, y: 0, w: tile, h: tile, on_tap: a.on_tap, id: a.id }), cell: i });
    children.push({ ...k.rect({ x: tx, y: 0, w: tile, h: tile, stroke: "hairline", stroke_w: 1, radius: k.t.radius.lg }), cell: i });
    if (typeof a.icon === "object") children.push({ type: "image", x: tx + k.centre(tile, md), y: k.centre(tile, md), w: md, h: md, src: a.icon.src, ttl: 0, cell: i });
    else children.push({ ...k.icon({ x: tx + k.centre(tile, md), y: k.centre(tile, md), name: a.icon }), w: md, h: md, cell: i });
    children.push({ ...k.text({ x: 0, y: tile + k.t.space[2], w: cellW, text: a.name, size: "sm", align: "center", lines: labelLines }), h: k.lh("sm") * labelLines, cell: i });
    if (a.update) children.push({ ...k.icon({ x: tx + tile - k.snap(sm / 2), y: -k.snap(sm / 2), name: Icons.update_available, size: "sm" }), w: sm, h: sm, cell: i });
  });
  return { widgets: [{ type: "grid", x, y: frame.y, cols, rows, cell_w: cellW, cell_h: cellH, gap, children }], h: rows * cellH + gap * (rows - 1) };
}

// -------------------------------------------------------------------------------- store ---
export interface StoreRowOptions { name: string; tagline: string; icon: IconName | string; installed?: boolean; update?: boolean; on_tap: Action; id?: string }
export function storeRow(k: Kit, box: Box, o: StoreRowOptions): Piece {
  const pill = o.update ? { text: "Update", filled: true } : o.installed ? { text: "Installed" } : undefined;
  return listRow(k, box, { title: o.name, subtitle: o.tagline, leading: o.icon, trailing: { pill, chevron: !pill }, on_tap: o.on_tap, id: o.id });
}

// ------------------------------------------------------------------ full-screen notices ---
/**
 * One thing said in the middle of the screen. The ornament degrades with the panel: a glyph and air
 * where there is room, then the glyph goes, then the supporting lines, so the same notice fits a
 * 13-inch tablet and a 2.9-inch badge.
 */
function notice(k: Kit, id: string, icon: IconName, title: string, lines: string[], buttons: { label: string; on_tap: Action; kind?: "primary" | "secondary" }[], extra?: (b: Box) => Piece | Widget[]): Screen {
  const lg = k.iconSize("lg");
  const glyph: StackItemLike = (b) => ({ widgets: [k.icon({ x: b.x + k.centre(b.w, lg), y: b.y, name: icon, size: "lg" })], h: lg });
  const head = (role: "title" | "headline" | "row") => (b: Box) => heading(k, b, { text: title, role, lines: 2, align: "center" });
  const body = lines.map((t) => (b: Box) => heading(k, b, { text: t, role: "body", lines: 4, align: "center", tone: "secondary" }));
  const small = lines.slice(0, 1).map((t) => (b: Box) => heading(k, b, { text: t, role: "caption", lines: 3, align: "center" }));
  const acts = buttons.length
    ? (b: Box) => buttonRow(k, b, { buttons: buttons.map((x) => ({ label: x.label, on_tap: x.on_tap, kind: x.kind ?? "secondary" })), size: "md", align: buttons.length > 1 ? "fill" : "center" })
    : null;
  const actsSmall = buttons.length
    ? (b: Box) => buttonRow(k, b, { buttons: buttons.map((x) => ({ label: x.label, on_tap: x.on_tap, kind: x.kind ?? "secondary" })), size: "sm", align: buttons.length > 1 ? "fill" : "center" })
    : null;
  return k.page({
    id,
    body: (f) => k.fit(f, [
      [k.spacer(k.t.space.section), glyph, k.spacer(k.t.space[4]), head("headline"), ...body, extra ?? null, k.spacer(k.t.space.group), acts],
      [k.spacer(k.t.space.group), glyph, k.spacer(k.t.space[2]), head("headline"), ...body, extra ?? null, k.spacer(k.t.space[4]), acts],
      [head("headline"), ...body, extra ?? null, k.spacer(k.t.space[4]), acts],
      [head("row"), ...small, extra ?? null, actsSmall],
      [head("row"), ...small],
    ], k.t.space[3]),
  });
}
type StackItemLike = (b: Box) => Piece;

export interface ErrorScreenOptions { title?: string; message: string; retry?: Action; home?: Action; id?: string }
/** The built-in error screen for a failed open or navigate (SPEC §8.2). */
export function errorScreen(k: Kit, o: ErrorScreenOptions): Screen {
  const buttons = [
    ...(o.home ? [{ label: "Home", on_tap: o.home, kind: "secondary" as const }] : []),
    ...(o.retry ? [{ label: "Retry", on_tap: o.retry, kind: "primary" as const }] : []),
  ];
  return notice(k, o.id ?? "error", Icons.error, o.title ?? "Something went wrong", [o.message], buttons);
}

export interface SetupScreenOptions { ssid: string; url: string; id?: string }
/** First boot with no Wi-Fi: how to join the setup hotspot. */
export function setupScreen(k: Kit, o: SetupScreenOptions): Screen {
  const step = (n: string, text: string, value?: string) => (b: Box) => {
    const numW = k.snapUp(k.measure("9.", "md", "bold")) + k.t.space[2];
    const inner: Box = { x: b.x + numW, y: b.y, w: b.w - numW };
    const body = k.stack(inner, [
      (x) => heading(k, x, { text, role: "body", lines: 2 }),
      value ? (x) => heading(k, x, { text: value, role: "callout", lines: 2 }) : null,
    ], k.t.space[1]);
    return { widgets: [k.text({ x: b.x, y: b.y, w: numW, text: n, weight: "bold" }), ...body.widgets], h: k.snapRow(body.h) };
  };
  return k.page({
    id: o.id ?? "setup",
    nav: { title: "Set up Wi-Fi", bare: true },
    body: (f) => k.fit(f, [
      [k.spacer(k.t.space[4]), step("1.", "On your phone, join the network", o.ssid), step("2.", "If no page opens by itself, go to", o.url),
       step("3.", "Choose your home network and enter its password"), k.spacer(k.t.space.group),
       (b) => heading(k, b, { text: "This screen changes on its own once the device is online.", role: "caption", lines: 2 })],
      [step("1.", "On your phone, join the network", o.ssid), step("2.", "If no page opens by itself, go to", o.url),
       step("3.", "Choose your home network and enter its password")],
      [(b) => heading(k, b, { text: "Join the Wi-Fi network", role: "body", lines: 1 }),
       (b) => heading(k, b, { text: o.ssid, role: "callout", lines: 1 }),
       (b) => heading(k, b, { text: o.url, role: "caption", lines: 1 })],
      [(b) => heading(k, b, { text: "Join", role: "caption", lines: 1 }), (b) => heading(k, b, { text: o.ssid, role: "row", lines: 1 })],
    ], k.t.space.group),
  });
}

export interface NeedsSetupOptions { app: string; url: string; home: Action; id?: string }
/** An app with required settings that are not filled in yet. */
export function needsSetupScreen(k: Kit, o: NeedsSetupOptions): Screen {
  return notice(k, o.id ?? "needs-setup", Icons.settings, `${o.app} needs setup`, ["Add its settings on this device's settings page:"], [{ label: "Home", on_tap: o.home }],
    (b) => heading(k, b, { text: o.url, role: "callout", lines: 2, align: "center" }));
}

export interface UpdateOsOptions { app: string; needs: string; has: string; url: string; home: Action; id?: string }
export function updateOsScreen(k: Kit, o: UpdateOsOptions): Screen {
  return notice(k, o.id ?? "update-os", Icons.update_available, "Update QuireOS", [`${o.app} needs spec version ${o.needs}. This device has ${o.has}.`, "Update from the settings page:"], [{ label: "Home", on_tap: o.home }],
    (b) => heading(k, b, { text: o.url, role: "callout", lines: 2, align: "center" }));
}

export interface PairingOptions { code: string; url: string; cancel: Action; id?: string }
/** The pairing code screen: a code readable across the room, and where to type it. */
export function pairingScreen(k: Kit, o: PairingOptions): Screen {
  const spaced = o.code.length > 4 ? `${o.code.slice(0, Math.ceil(o.code.length / 2))} ${o.code.slice(Math.ceil(o.code.length / 2))}` : o.code;
  return k.page({
    id: o.id ?? "pair",
    nav: { title: "Pair with your account", back: o.cancel },
    body: (f) => {
      const code = (size: "2xl" | "xl" | "lg") => (b: Box) => ({ widgets: [k.text({ x: b.x, y: b.y, w: b.w, text: spaced, size, weight: "bold", align: "center" })], h: k.lh(size) });
      const at = (b: Box) => heading(k, b, { text: "Enter this code at", role: "body", lines: 1, align: "center", tone: "secondary" });
      const url = (role: "callout" | "caption") => (b: Box) => heading(k, b, { text: o.url, role, lines: 2, align: "center" });
      return k.fit(f, [
        [k.spacer(k.t.space.section), at, url("callout"), k.spacer(k.t.space.group), code("2xl"), k.spacer(k.t.space.group),
         (b) => paragraph(k, b, { text: "The code expires in ten minutes. This screen updates by itself once the device is paired.", size: "sm", tone: "secondary" })],
        [k.spacer(k.t.space[4]), at, url("callout"), k.spacer(k.t.space[4]), code("2xl")],
        [at, url("caption"), code("xl")],
        [code("lg"), url("caption")],
      ], k.t.space[2]);
    },
  });
}
