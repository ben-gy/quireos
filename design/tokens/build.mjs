#!/usr/bin/env node
// Derives design/tokens/tokens.json and design/tokens/TOKENS.md from design/profiles.json.
//
// The rule: a device CLASS fixes sizes in millimetres; a PROFILE's dpi and viewing distance turn
// them into pixels. Space is counted in units (u), where u is 4 px on high-dpi panels (>= 180 dpi)
// and 2 px below, so one unit is always about 0.4-0.5 mm. Everything is rounded to even pixels
// (the framebuffer packs two pixels per byte). t5pro is the reference profile: its derived line
// heights must equal the ones compiled into the firmware (spec/fonts.json), and the script fails
// if they drift.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const profiles = JSON.parse(readFileSync(resolve(here, "../profiles.json"), "utf8"));
const specFonts = existsSync(resolve(REPO, "spec/fonts.json"))
  ? JSON.parse(readFileSync(resolve(REPO, "spec/fonts.json"), "utf8"))
  : null;

// ------------------------------------------------------------------ class tables (mm) ---
// Handheld values are the t5pro pixels the Hacker News reader settled on, expressed in mm at 235 dpi
// (1 px = 0.1081 mm). Other classes shift them with the physical reality of their panels.
const TYPE_MM = {
  // spec size token -> line height in mm. Derived from SPEC §10 (t5pro px / 9.252 px per mm).
  xs: 2.59, sm: 3.13, md: 3.89, lg: 4.76, xl: 6.05, "2xl": 7.78, "3xl": 10.38, digits: 16.2,
};
const CLASS = {
  handheld: {
    space: { page: 6, gutter: 4, inset: 4, inset_compact: 3, gap: 2, group: 6, section: 12 },
    // An icon matches the text it sits beside: `sm` the cap height of sm/xs text, `md` the md line
    // box (nav bars, toolbars, tiles), `lg` a single focal glyph. Bigger than this and a 24-unit
    // glyph's strokes scale into slabs.
    icon: { sm: 2.59, md: 3.89, lg: 6.92 },
    touch: { min: 6.9, recommended: 9.0, row: 6.0 },
    chrome: { status: 4.76, nav: 6.05, toolbar: 6.05, rail: 8.65, corner: 5.19, toast: 6.05 },
    type_scale: 1.0,
    layout: { max_measure: 90, min_column: 60 },
  },
  large: {
    space: { page: 8, gutter: 6, inset: 4, inset_compact: 3, gap: 2, group: 6, section: 12 },
    icon: { sm: 2.59, md: 3.89, lg: 6.92 },
    touch: { min: 6.9, recommended: 9.0, row: 6.0 },
    chrome: { status: 4.76, nav: 6.05, toolbar: 6.05, rail: 8.65, corner: 5.19, toast: 6.05 },
    type_scale: 1.0,
    layout: { max_measure: 90, min_column: 60 },
  },
  panel: {
    space: { page: 6, gutter: 4, inset: 4, inset_compact: 3, gap: 2, group: 6, section: 12 },
    icon: { sm: 2.59, md: 3.89, lg: 6.92 },
    touch: { min: 6.9, recommended: 9.0, row: 6.0 },
    chrome: { status: 4.76, nav: 6.05, toolbar: 6.05, rail: 8.65, corner: 5.19, toast: 6.05 },
    type_scale: 1.0,
    layout: { max_measure: 110, min_column: 70 },
  },
  badge: {
    space: { page: 2, gutter: 2, inset: 2, inset_compact: 1, gap: 1, group: 2, section: 4 },
    icon: { sm: 2.59, md: 3.89, lg: 5.5 },
    touch: { min: 6.9, recommended: 9.0, row: 6.0 },
    chrome: { status: 3.5, nav: 4.0, toolbar: 4.0, rail: 6.0, corner: 3.89, toast: 4.0 },
    type_scale: 1.1,
    layout: { max_measure: 70, min_column: 40 },
  },
};
const SPACE_STEPS = [1, 2, 3, 4, 6, 8, 12, 16];
// Vertical rhythm: row and block heights are multiples of `rhythm` (2u), so a column of mixed
// components keeps a visible beat instead of drifting by odd line heights.
const RHYTHM = 2;

// Semantic ink levels per grey depth. 0 = black, 15 = white. On 1-bit panels several tones collapse
// to ink or paper, so components must add a non-colour cue (see GUIDELINES.md, Tone).
const TONE = {
  16: { paper: 15, ink: 0, secondary: 6, tertiary: 10, hairline: 12, rule: 8, fill_selected: 0, fill_subtle: 13, fill_disabled: 13, fill_paper: 15 },
  4:  { paper: 15, ink: 0, secondary: 5, tertiary: 10, hairline: 10, rule: 5, fill_selected: 0, fill_subtle: 15, fill_disabled: 15, fill_paper: 15 },
  2:  { paper: 15, ink: 0, secondary: 0, tertiary: 0, hairline: 0, rule: 0, fill_selected: 0, fill_subtle: 15, fill_disabled: 15, fill_paper: 15 },
};
// Which tones are "meaningless" at a depth (equal to paper or ink), so the kit adds another cue.
const TONE_COLLAPSED = {
  16: [],
  4: ["fill_subtle", "fill_disabled", "rule"],
  2: ["secondary", "tertiary", "hairline", "fill_subtle", "fill_disabled"],
};
const ROLES = {
  display:   { size: "digits", fallback: "3xl", weight: "bold", tone: "ink" },
  title:     { size: "xl", weight: "bold", tone: "ink" },
  headline:  { size: "lg", weight: "bold", tone: "ink" },
  row:       { size: "md", weight: "regular", tone: "ink" },
  body:      { size: "md", weight: "regular", tone: "ink" },
  callout:   { size: "lg", weight: "regular", tone: "ink" },
  label:     { size: "sm", weight: "regular", tone: "ink" },
  section:   { size: "xs", weight: "bold", tone: "secondary" },
  caption:   { size: "xs", weight: "regular", tone: "secondary" },
  meta:      { size: "xs", weight: "regular", tone: "secondary" },
  nav_title: { size: "md", weight: "bold", tone: "ink" },
};
const READING = { S: "sm", M: "md", L: "lg" };

// ------------------------------------------------------------------------------ maths ---
const toUnit = (v, u, min) => Math.max(min, u * Math.round(v / u));
const mmToPx = (mm, dpi, distance, u, min = u) => toUnit((mm * dpi) / 25.4 * distance, u, min);
// touch targets never round below their millimetres; chrome may be up to half a pixel under
// (its millimetres were themselves derived from t5pro pixels)
const mmToPxUp = (mm, dpi, distance, u, slack = 0) => Math.max(u, u * Math.ceil(((mm * dpi) / 25.4 * distance - slack) / u - 1e-9));
const lineHeight = (mm, dpi, distance, scale) => Math.max(12, Math.round((mm * dpi) / 25.4 * distance * scale));

function derive(id, p) {
  const c = CLASS[p.class];
  if (!c) throw new Error(`${id}: unknown class ${p.class}`);
  const u = p.dpi >= 180 ? 4 : 2;
  const px = (mm, min) => mmToPx(mm, p.dpi, p.distance, u, min);
  const space = {};
  for (const s of SPACE_STEPS) space[String(s)] = s * u;
  for (const [k, n] of Object.entries(c.space)) space[k] = n * u;
  space.rhythm = RHYTHM * u;

  const type = {};
  for (const [k, mm] of Object.entries(TYPE_MM)) type[k] = { line: lineHeight(mm, p.dpi, p.distance, c.type_scale) };
  const ref = specFonts?.profiles?.[id]?.sizes;
  if (ref) {
    for (const k of Object.keys(type)) {
      if (ref[k] && ref[k].line_height !== type[k].line)
        throw new Error(`${id}: derived ${k} line height ${type[k].line} != spec/fonts.json ${ref[k].line_height}`);
      if (ref[k]) Object.assign(type[k], { ascent: ref[k].ascent, descent: ref[k].descent });
    }
  } else {
    // Approximate ascent/descent from Roboto's metrics (ascent ~= 0.80 of the line box the
    // firmware converter produces). Replaced by real values once gen_fonts.py runs per profile.
    for (const k of Object.keys(type)) {
      type[k].ascent = Math.round(type[k].line * 0.8);
      type[k].descent = type[k].line - type[k].ascent;
      type[k].approximate = true;
    }
  }

  const icon = {};
  for (const [k, mm] of Object.entries(c.icon)) icon[k] = px(mm, 16);
  // icons and chrome must share the unit so glyphs centre on the grid
  const touch = {};
  // Touch targets and chrome land on the rhythm too, so a bar or a row never knocks a column off its beat.
  for (const [k, mm] of Object.entries(c.touch)) touch[k] = mmToPxUp(mm, p.dpi, p.distance, u * RHYTHM);
  const chrome = {};
  for (const [k, mm] of Object.entries(c.chrome)) chrome[k] = mmToPxUp(mm, p.dpi, p.distance, u * RHYTHM, 0.5);
  const stroke = u === 4 ? { hairline: 1, rule: 1, frame: 2, heavy: 4 } : { hairline: 1, rule: 1, frame: 2, heavy: 3 };
  const radius = u === 4 ? { sm: 4, md: 8, lg: 16 } : { sm: 2, md: 4, lg: 8 };
  const depth = p.greys >= 16 ? 16 : p.greys >= 4 ? 4 : 2;
  const light = TONE[depth];
  const dark = Object.fromEntries(Object.entries(light).map(([k, v]) => [k, 15 - v]));
  const logical = p.default_orientation === "portrait"
    ? { portrait: [Math.min(...p.native), Math.max(...p.native)], landscape: [Math.max(...p.native), Math.min(...p.native)] }
    : { landscape: [Math.max(...p.native), Math.min(...p.native)], portrait: [Math.min(...p.native), Math.max(...p.native)] };
  const layout = {
    max_measure: px(c.layout.max_measure),
    min_column: px(c.layout.min_column),
  };
  return {
    name: p.name, examples: p.examples, class: p.class, reference: !!p.reference,
    native: p.native, logical, default_orientation: p.default_orientation,
    dpi: p.dpi, greys: p.greys, depth, touch: p.touch, buttons: p.buttons, distance: p.distance,
    partial_update: p.partial_update,
    px_per_mm: +((p.dpi / 25.4) * p.distance).toFixed(3),
    u, space, type, roles: ROLES, reading: READING, icon, touch_target: touch, chrome, stroke, radius,
    tone: { light, dark, collapsed: TONE_COLLAPSED[depth] }, layout,
  };
}

const out = {
  $comment: "GENERATED by design/tokens/build.mjs from design/profiles.json. Do not edit; edit the class tables in build.mjs or profiles.json and rerun.",
  spec_version: 1,
  rules: {
    unit: "u = 4 px when dpi >= 180, else 2 px (about 0.4-0.5 mm). Space tokens are multiples of u.",
    physical: "Type, icons, touch targets and chrome are millimetres per device class, converted with px = round_to_unit(mm * dpi / 25.4 * distance).",
    reference: "t5pro line heights must equal spec/fonts.json; build.mjs fails otherwise.",
    tone: "Ink levels 0 (black) to 15 (white). `collapsed` lists tones that equal paper or ink at this depth; components add a non-colour cue for those.",
  },
  tone_tables: Object.fromEntries(Object.entries(TONE).map(([d, light]) => [d, {
    light, dark: Object.fromEntries(Object.entries(light).map(([k, v]) => [k, 15 - v])), collapsed: TONE_COLLAPSED[d],
  }])),
  roles: ROLES,
  profiles: {},
};
for (const [id, p] of Object.entries(profiles.profiles)) out.profiles[id] = derive(id, p);
writeFileSync(resolve(here, "tokens.json"), JSON.stringify(out, null, 2) + "\n");

// ------------------------------------------------------------------------------ TOKENS.md ---
const ids = Object.keys(out.profiles);
const row = (label, f) => `| ${label} | ${ids.map((id) => f(out.profiles[id])).join(" | ")} |`;
const head = `| token | ${ids.join(" | ")} |\n|---|${ids.map(() => "---").join("|")}|`;
const md = [];
md.push("# Design tokens by profile", "",
  "GENERATED by `design/tokens/build.mjs` from `design/profiles.json`. Pixel values per device profile; the rules that produce them are in [GUIDELINES.md](../GUIDELINES.md).", "",
  "## Profiles", "", head,
  row("name", (p) => p.name),
  row("class", (p) => p.class),
  row("native px", (p) => p.native.join("×")),
  row("portrait / landscape", (p) => `${p.logical.portrait.join("×")} / ${p.logical.landscape.join("×")}`),
  row("dpi", (p) => p.dpi),
  row("greys", (p) => p.greys),
  row("input", (p) => `${p.touch ? "touch" : "no touch"}, ${p.buttons} button${p.buttons === 1 ? "" : "s"}`),
  row("viewing distance factor", (p) => p.distance),
  row("px per mm (after distance)", (p) => p.px_per_mm),
  row("unit u", (p) => p.u),
  "", "## Space (px)", "", head,
  ...SPACE_STEPS.map((s) => row(`space.${s}`, (p) => p.space[String(s)])),
  ...["page", "gutter", "inset", "inset_compact", "gap", "rhythm", "group", "section"].map((k) => row(`space.${k}`, (p) => p.space[k])),
  "", "## Type line heights (px)", "", head,
  ...Object.keys(TYPE_MM).map((k) => row(`type.${k}`, (p) => `${p.type[k].line}${p.type[k].approximate ? "*" : ""}`)),
  "", (Object.values(out.profiles).some((p) => Object.values(p.type).some((t) => t.approximate))
        ? "`*` ascent/descent approximated: the firmware has no font tables for that profile yet.\n"
        : "Every profile's line heights are cross-checked against `spec/fonts.json`; the build fails on any drift.\n"),
  "## Type roles", "", "| role | size | weight | tone |", "|---|---|---|---|",
  ...Object.entries(ROLES).map(([k, r]) => `| ${k} | ${r.size}${r.fallback ? ` (falls back to ${r.fallback})` : ""} | ${r.weight} | ${r.tone} |`),
  "", "## Icons (px)", "", head,
  ...["sm", "md", "lg"].map((k) => row(`icon.${k}`, (p) => p.icon[k])),
  "", "## Touch targets (px)", "", head,
  ...["min", "recommended", "row"].map((k) => row(`touch.${k}`, (p) => p.touch_target[k])),
  "", "## Chrome (px)", "", head,
  ...["status", "nav", "toolbar", "rail", "corner", "toast"].map((k) => row(`chrome.${k}`, (p) => p.chrome[k])),
  "", "## Stroke and radius (px)", "", head,
  ...["hairline", "rule", "frame", "heavy"].map((k) => row(`stroke.${k}`, (p) => p.stroke[k])),
  ...["sm", "md", "lg"].map((k) => row(`radius.${k}`, (p) => p.radius[k])),
  "", "## Layout (px)", "", head,
  row("layout.max_measure", (p) => p.layout.max_measure),
  row("layout.min_column", (p) => p.layout.min_column),
  "", "## Tone (ink level 0-15, light theme; dark theme is 15 minus each value)", "", head,
  ...Object.keys(TONE[16]).map((k) => row(`tone.${k}`, (p) => p.tone.light[k])),
  row("collapsed at this depth", (p) => p.tone.collapsed.join(", ") || "none"),
  "");
writeFileSync(resolve(here, "TOKENS.md"), md.join("\n"));
console.log(`tokens: ${ids.length} profiles -> tokens.json, TOKENS.md`);
