// Text measurement and wrapping: the SDK's conformance-pinned implementation (SPEC §6.4) over the
// firmware's glyph tables. Profiles the firmware has no tables for yet get the reference tables
// scaled by line height, which the kit reports as approximate.
import { measure as sdkMeasure, wrap as sdkWrap, lineHeight as sdkLineHeight, profileNames, t5pro, profile as sdkProfile } from "@quireos/sdk";
import type { FontProfile, TextSize, Weight } from "./types.js";
import tokens from "./generated/tokens.js";

const cache = new Map<string, FontProfile>();

function scaledFace(face: { default_advance: number; advance: Record<string, number> }, ratio: number) {
  const advance: Record<string, number> = {};
  for (const [ch, adv] of Object.entries(face.advance)) advance[ch] = Math.max(1, Math.round(adv * ratio));
  return { default_advance: Math.max(1, Math.round(face.default_advance * ratio)), advance };
}

/** The SDK font profile for a design profile id: the firmware's when it exists, else t5pro scaled to the tokens' line heights. */
export function fontProfile(id: string): FontProfile {
  const hit = cache.get(id);
  if (hit) return hit;
  let p: FontProfile;
  if (profileNames.includes(id)) p = sdkProfile(id);
  else {
    const t = (tokens.profiles as Record<string, { type: Record<string, { line: number; ascent: number }>; icon: { sm: number; md: number; lg: number }; dpi: number; native: readonly number[]; default_orientation: string; greys: number }>)[id];
    if (!t) p = t5pro;
    else {
      const sizes: FontProfile["sizes"] = {};
      for (const [size, ref] of Object.entries(t5pro.sizes)) {
        if (!ref) continue;
        const target = t.type[size]?.line ?? ref.line_height;
        const ratio = target / ref.line_height;
        sizes[size as TextSize] = { line_height: target, ascent: t.type[size]?.ascent ?? Math.round(ref.ascent * ratio), regular: scaledFace(ref.regular, ratio), ...(ref.bold ? { bold: scaledFace(ref.bold, ratio) } : {}) };
      }
      p = { dpi: t.dpi, native: [t.native[0] ?? 0, t.native[1] ?? 0], default_orientation: t.default_orientation as FontProfile["default_orientation"], greys: t.greys, sizes, icons: { ...t.icon } };
    }
  }
  cache.set(id, p);
  return p;
}

export function hasFontTables(id: string): boolean { return profileNames.includes(id); }
export function lineHeight(id: string, size: TextSize): number { return sdkLineHeight(size, fontProfile(id)); }
export function measure(id: string, size: TextSize, weight: Weight, text: string): number { return sdkMeasure(text, size, weight, fontProfile(id)); }
/** Wraps into lines no wider than `maxW`; with `maxLines` > 0 the last line is truncated with `…`. */
export function wrap(id: string, size: TextSize, weight: Weight, text: string, maxW: number, maxLines = 0): string[] {
  return sdkWrap(text, { w: maxW, lines: maxLines > 0 ? maxLines : Number.MAX_SAFE_INTEGER, size, weight, profile: fontProfile(id) });
}
export function truncate(id: string, size: TextSize, weight: Weight, text: string, maxW: number): string {
  return wrap(id, size, weight, text.replace(/\n/g, " "), maxW, 1)[0] ?? "";
}
