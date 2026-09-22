/**
 * The home screen: a grid of switch tiles bound to Home Assistant data sources. Everything the
 * device needs (URL, token, entity ids) comes from settings templates, so the Worker never sees
 * the token and the same document works for every install with the same entity list.
 */
import { button, cond, data, grid, http, line, refresh, screen, text } from "@quireos/sdk";
import type { ButtonWidget, DataSource, GridChild, Screen, Widget } from "@quireos/sdk";

export interface Entity {
  id: string;
  label: string;
}

export const MAX_ENTITIES = 8;
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

/** Reads `settings.entities` from `X-App-Settings`: valid rows only, at most eight. */
export function parseEntities(settings: Record<string, unknown>): Entity[] {
  const raw = settings.entities;
  if (!Array.isArray(raw)) return [];
  const out: Entity[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: unknown }).id ?? "").trim();
    const label = String((row as { label?: unknown }).label ?? "").trim();
    if (!ENTITY_RE.test(id)) continue;
    out.push({ id, label: label || id.split(".")[1]!.replace(/_/g, " ") });
    if (out.length >= MAX_ENTITIES) break;
  }
  return out;
}

const AUTH = { Authorization: "Bearer {{settings.ha_token}}" };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };

function domainOf(id: string): string {
  return id.split(".")[0]!;
}

interface Layout {
  W: number;
  H: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gap: number;
  gridY: number;
}

function layout(w: number, h: number): Layout {
  const M = 24;
  if (w > h) {
    const cols = 4;
    const gap = 16;
    const cellW = Math.floor((w - 2 * M - gap * (cols - 1)) / cols);
    return { W: w, H: h, cols, rows: 2, cellW, cellH: 176, gap, gridY: 104 };
  }
  const cols = 2;
  const gap = 16;
  const cellW = Math.floor((w - 2 * M - gap) / cols);
  return { W: w, H: h, cols, rows: 4, cellW, cellH: 168, gap, gridY: 116 };
}

function chrome(l: Layout, subtitle: string): Widget[] {
  const M = 24;
  return [
    text({ x: M, y: l.W > l.H ? 12 : 16, w: l.W - 2 * M - 80, text: "Lights", size: "xl", weight: "bold" }),
    text({ x: M, y: l.W > l.H ? 66 : 72, w: l.W - 2 * M - 80, text: subtitle, size: "xs", color: 7 }),
    line({ x1: M, y1: l.gridY - 12, x2: l.W - M, y2: l.gridY - 12, color: 0 }),
  ];
}

/** Explains how to fill settings when `X-App-Settings` has no entities. */
export function setupScreen(w: number, h: number): Screen {
  const l = layout(w, h);
  const M = 24;
  const cw = l.W - 2 * M;
  return screen({
    id: "home",
    url: "/screens/home.json",
    ttl: 0,
    widgets: [
      ...chrome(l, "Needs setup"),
      text({ x: M, y: l.gridY + 8, w: cw, lines: 2, text: "No switches yet", size: "lg", weight: "bold" }),
      text({
        x: M,
        y: l.gridY + 70,
        w: cw,
        lines: 8,
        size: "md",
        text: "Open the device's settings page on your LAN (the address is on the device's Settings screen), choose HA Lights and fill in:\n\n1. Home Assistant URL, e.g. http://homeassistant.local:8123\n2. A long-lived access token (HA > Profile > Security)\n3. Up to eight switches: entity id (switch.pool_lights) and a tile label",
      }),
      text({ x: M, y: l.gridY + 70 + 8 * 36 + 16, w: cw, lines: 3, size: "sm", color: 7, text: "The token stays on the device and is only sent to your Home Assistant. This screen refreshes itself once the settings are saved." }),
      button({ id: "reload", x: M, y: l.H - 24 - 72, w: cw, h: 72, label: "Reload", icon: "refresh", on_tap: refresh() }),
    ],
  });
}

export interface HomeOptions {
  entities: Entity[];
  singleRequest?: boolean;
  screen: { w: number; h: number };
}

/** The tile grid. `singleRequest` swaps eight GETs for one POST to `/api/template`. */
export function homeScreen(opts: HomeOptions): Screen {
  const ents = opts.entities.slice(0, MAX_ENTITIES);
  if (ents.length === 0) return setupScreen(opts.screen.w, opts.screen.h);
  const l = layout(opts.screen.w, opts.screen.h);
  const M = 24;

  const sources: DataSource[] = [];
  const vars: Record<string, string> = {};
  if (opts.singleRequest) {
    // HA renders the Jinja template and answers text/plain; the device parses it as JSON anyway.
    const body = `{${ents.map((e, i) => `"e${i}":"{{ states('${e.id}') }}"`).join(",")}}`;
    sources.push(data({ id: "st", url: "{{settings.ha_url}}/api/template", method: "POST", headers: JSON_AUTH, body: `{"template":${JSON.stringify(body)}}`, body_raw: true, ttl: 30 }));
    ents.forEach((_, i) => (vars[`e${i}`] = `{{st.e${i}}}`));
  } else {
    ents.forEach((e, i) => {
      sources.push(data({ id: `e${i}`, url: `{{settings.ha_url}}/api/states/${e.id}`, headers: AUTH, ttl: 30 }));
      vars[`e${i}`] = `{{e${i}.state}}`;
    });
  }

  // Grid children take the cell's geometry, so they are built as plain objects (the `button()`
  // builder insists on x/y/w/h).
  type Tile = Omit<ButtonWidget, "type" | "x" | "y" | "w" | "h">;
  const tile = (at: number, props: Tile): GridChild => ({ type: "button", cell: at, ...props }) as GridChild;

  const children: GridChild[] = ents.map((e, i) =>
    tile(i, {
      id: `t${i}`,
      label: e.label,
      lines: 2,
      sub: cond(`vars.e${i} == on`, "ON", cond(`vars.e${i} == off`, "OFF", "?")),
      fill: cond(`vars.e${i} == on`, 0, 15),
      on_tap: http(`{{settings.ha_url}}/api/services/${domainOf(e.id)}/toggle`, {
        method: "POST",
        headers: JSON_AUTH,
        body: { entity_id: e.id },
        set: { [`e${i}`]: cond(`vars.e${i} == on`, "off", "on") },
        then: "refresh",
        after: 1,
      }),
    }),
  );

  const allOff: Tile = {
    id: "all-off",
    label: "All off",
    icon: "power",
    sub: `${ents.length} ${ents.length === 1 ? "switch" : "switches"}`,
    on_tap: http("{{settings.ha_url}}/api/services/homeassistant/turn_off", {
      method: "POST",
      headers: JSON_AUTH,
      body: { entity_id: ents.map((e) => e.id) },
      set: Object.fromEntries(ents.map((_, i) => [`e${i}`, "off"])),
      then: "refresh",
      after: 1,
    }),
  };

  const widgets: Widget[] = [...chrome(l, "Updated {{device.time | time:'HH:mm'}} · {{settings.ha_url}}")];
  const cells = l.cols * l.rows;
  if (ents.length < cells) children.push(tile(ents.length, allOff));
  widgets.push(grid({ x: M, y: l.gridY, cols: l.cols, rows: l.rows, cell_w: l.cellW, cell_h: l.cellH, gap: l.gap, children }));
  if (ents.length >= cells) {
    const y = l.gridY + l.rows * l.cellH + (l.rows - 1) * l.gap + 16;
    widgets.push(button({ ...allOff, x: M, y, w: l.W - 2 * M, h: Math.min(72, l.H - y - 12) }));
  }

  return screen({ id: "home", url: "/screens/home.json", ttl: 300, refresh: "partial", data: sources, vars, widgets });
}
