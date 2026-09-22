import tokens from "./generated/tokens.js";
import { parseScreen as sdkParseScreen } from "@quireos/sdk";

export type Orientation = "portrait" | "landscape";
export type Depth = 16 | 4 | 2;
export type ProfileId = keyof typeof tokens.profiles;
/** Widens the generated `as const` literals to plain numbers/strings so arithmetic types stay sane. */
type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Widen<U>[] : T extends object ? { [K in keyof T]: Widen<T[K]> } : T;
export type ProfileTokens = Widen<(typeof tokens.profiles)["t5pro"]>;
export type ToneName = keyof (typeof tokens.tone_tables)["16"]["light"];
export type RoleName = keyof typeof tokens.roles;
export type SpaceName = keyof (typeof tokens.profiles)["t5pro"]["space"];

export interface Profile {
  id: ProfileId;
  name: string;
  class: string;
  /** Logical size after orientation. */
  w: number; h: number;
  orientation: Orientation;
  dpi: number;
  greys: number;
  depth: Depth;
  touch: boolean;
  buttons: number;
  t: ProfileTokens;
}

export interface ScreenHeader { w: number; h: number; greys: number; dpi: number }

/** Parses the `X-Screen` header (`540x960x16@235`) with the SDK; `null` when absent. */
export function parseScreen(header: string | null | undefined): ScreenHeader | null {
  if (!header || !/^\s*\d+x\d+/.test(header)) return null;
  return sdkParseScreen(header);
}

export const depthOf = (greys: number): Depth => (greys >= 16 ? 16 : greys >= 4 ? 4 : 2);

export interface ResolveOptions {
  profile?: ProfileId | string;
  orientation?: Orientation;
  screen?: ScreenHeader | null;
}

export const profileIds = Object.keys(tokens.profiles) as ProfileId[];

/** Picks the profile for a request: by id, or the nearest to the reported screen, else t5pro. */
export function resolveProfile(opts: ResolveOptions = {}): Profile {
  let id: ProfileId = "t5pro";
  const s = opts.screen ?? null;
  if (opts.profile && (opts.profile as ProfileId) in tokens.profiles) id = opts.profile as ProfileId;
  else if (s) {
    let best = Infinity;
    for (const pid of profileIds) {
      const p = tokens.profiles[pid];
      const [nw, nh] = p.native;
      const exact = (nw === s.w && nh === s.h) || (nw === s.h && nh === s.w);
      const areaErr = Math.abs(Math.log((s.w * s.h) / (nw * nh)));
      const dpiErr = Math.abs(Math.log(s.dpi / p.dpi));
      const score = (exact ? 0 : areaErr) + dpiErr;
      if (score < best) { best = score; id = pid; }
    }
  }
  const t = tokens.profiles[id] as unknown as ProfileTokens;
  let orientation: Orientation = opts.orientation ?? (t.default_orientation as Orientation);
  if (s && !opts.orientation) orientation = s.w < s.h ? "portrait" : "landscape";
  const [lw = 0, lh = 0] = orientation === "portrait" ? t.logical.portrait : t.logical.landscape;
  const w = s ? s.w : lw, h = s ? s.h : lh;
  const greys = s ? s.greys : t.greys;
  return {
    id, name: t.name, class: t.class, w, h, orientation,
    dpi: s ? s.dpi : t.dpi, greys, depth: depthOf(greys), touch: t.touch, buttons: t.buttons, t,
  };
}

export const toneTable = (depth: Depth, theme: "light" | "dark") => tokens.tone_tables[String(depth) as "16" | "4" | "2"][theme];
export const collapsedTones = (depth: Depth): readonly string[] => tokens.tone_tables[String(depth) as "16" | "4" | "2"].collapsed;
export const roles = tokens.roles;
