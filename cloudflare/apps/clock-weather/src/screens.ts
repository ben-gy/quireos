/**
 * One screen. The clock and date are `device.time` templates (re-evaluated on the device every
 * minute, no network); the weather is baked in by the Worker and refreshed with the screen
 * (`ttl: 600`). Portrait stacks clock over weather; landscape puts them side by side.
 */
import { bind, button, f, grid, icon, line, refresh, screen, t5pro, text } from "@quireos/sdk";
import type { GridChild, Screen, Widget } from "@quireos/sdk";
import { condition, weekday } from "./weather.js";
import type { Place, Weather } from "./weather.js";

export interface HomeInput {
  place: Place;
  weather?: Weather;
  error?: string;
  screen: { w: number; h: number };
}

const M = 24;
const DIM = 7;

function deg(v: number): string {
  return `${Math.round(v)}°`;
}

function windUnit(w: Weather): string {
  return w.units === "imperial" ? "mph" : "km/h";
}

/** Clock block: place, date, big digits. Returns widgets and the y it ends at. */
function clock(x: number, y: number, w: number, place: Place, compact: boolean): { widgets: Widget[]; bottom: number } {
  const widgets: Widget[] = [
    text({ x, y, w: w - (compact ? 0 : 80), text: place.name, size: "lg", weight: "bold" }),
    text({ x, y: y + 52, w, text: bind("device.time", f.time("EEEE d MMMM")), size: "md", color: DIM }),
    text({ x, y: y + 100, w, h: 150, text: bind("device.time", f.time("HH:mm")), size: "digits", align: compact ? "left" : "center" }),
  ];
  return { widgets, bottom: y + 100 + 150 };
}

function current(x: number, y: number, w: number, wx: Weather): Widget[] {
  const c = condition(wx.code, wx.isDay);
  const facts = `H ${deg(wx.days[0]?.hi ?? wx.temp)}  L ${deg(wx.days[0]?.lo ?? wx.temp)}  ·  Feels ${deg(wx.feels)}`;
  const facts2 = `Wind ${Math.round(wx.wind)} ${windUnit(wx)}  ·  Humidity ${Math.round(wx.humidity)}%`;
  return [
    icon({ x, y: y + 4, name: c.big, size: "lg" }),
    text({ x: x + 116, y: y - 4, w: w - 116, h: 72, text: deg(wx.temp), size: "2xl", weight: "bold" }),
    text({ x: x + 116, y: y + 70, w: w - 116, text: c.desc, size: "md" }),
    text({ x: x + 116, y: y + 110, w: w - 116, text: facts, size: "sm", color: DIM }),
    text({ x: x + 116, y: y + 142, w: w - 116, text: facts2, size: "sm", color: DIM }),
  ];
}

/** Three-day outlook as a grid: weekday, icon, hi/lo per cell. */
function forecast(x: number, y: number, w: number, wx: Weather): Widget[] {
  const days = wx.days.slice(1, 4);
  if (days.length === 0) return [];
  const gap = 12;
  const cellW = Math.floor((w - gap * (days.length - 1)) / days.length);
  const cellH = 150;
  const children: GridChild[] = [];
  days.forEach((d, i) => {
    const c = condition(d.code, true);
    // grid children are cell-relative and may omit x/y/w/h, so they are plain objects
    children.push({ type: "text", cell: i, y: 0, w: cellW, text: weekday(d.date), size: "sm", weight: "bold", align: "center" });
    // w/h are required: a grid child that omits them fills the cell, and an icon centres in its box.
    // The pixel size of `md` comes from the device profile, so read it rather than assuming one.
    const ip = t5pro.icons.md;
    children.push({ type: "icon", cell: i, x: Math.floor((cellW - ip) / 2), y: 40, w: ip, h: ip, name: c.icon, size: "md" });
    children.push({ type: "text", cell: i, y: 100, w: cellW, text: `${deg(d.hi)} / ${deg(d.lo)}`, size: "sm", align: "center", color: DIM });
  });
  return [grid({ x, y, cols: days.length, rows: 1, cell_w: cellW, cell_h: cellH, gap, children })];
}

function unavailable(x: number, y: number, w: number, error: string | undefined): Widget[] {
  return [
    icon({ x, y: y + 4, name: "cloud-off-outline", size: "lg", color: DIM }),
    text({ x: x + 116, y, w: w - 116, lines: 2, text: "Weather unavailable", size: "lg", weight: "bold" }),
    text({ x: x + 116, y: y + 96, w: w - 116, lines: 3, text: error ?? "Open-Meteo did not answer.", size: "sm", color: DIM }),
  ];
}

export function homeScreen(input: HomeInput): Screen {
  const { w: W, h: H } = input.screen;
  const landscape = W > H;
  const wx = input.weather;
  const widgets: Widget[] = [];
  const vars: Record<string, string> = {};
  if (wx) vars.updated = String(wx.fetched);

  if (!landscape) {
    const cw = W - 2 * M;
    const c = clock(M, 24, cw, input.place, false);
    widgets.push(...c.widgets);
    const ruleY = c.bottom + 20;
    widgets.push(line({ x1: M, y1: ruleY, x2: W - M, y2: ruleY }));
    const wy = ruleY + 24;
    if (wx) {
      widgets.push(...current(M, wy, cw, wx));
      widgets.push(...forecast(M, wy + 200, cw, wx));
    } else widgets.push(...unavailable(M, wy, cw, input.error));
    widgets.push(button({ id: "refresh", x: M, y: H - 24 - 88 - 40, w: cw, h: 88, label: "Refresh", icon: "refresh", size: "sm", on_tap: refresh() }));
  } else {
    const colW = Math.floor((W - 2 * M - 32) / 2);
    const c = clock(M, 20, colW, input.place, true);
    widgets.push(...c.widgets);
    const rx = M + colW + 32;
    widgets.push(line({ x1: rx - 16, y1: 20, x2: rx - 16, y2: H - 24 }));
    if (wx) {
      widgets.push(...current(rx, 24, colW, wx));
      widgets.push(...forecast(rx, 210, colW, wx));
    } else widgets.push(...unavailable(rx, 24, colW, input.error));
    widgets.push(button({ id: "refresh", x: M, y: H - 24 - 80 - 30, w: colW, h: 80, label: "Refresh", icon: "refresh", size: "sm", on_tap: refresh() }));
  }
  const footer = wx ? `Open-Meteo · updated ${bind("vars.updated", f.time("HH:mm"))}${input.error ? " (stale)" : ""}` : "Open-Meteo";
  widgets.push(text({ x: M, y: H - 24 - 24, w: W - 2 * M, text: footer, size: "xs", color: DIM, align: landscape ? "left" : "center" }));

  return screen({ id: "home", url: "/screens/home.json", ttl: 600, refresh: "partial", vars: Object.keys(vars).length ? vars : undefined, keys: { short: refresh() }, widgets });
}
