/**
 * Device profiles (§10): line heights, glyph advances and icon sizes per board.
 * `fonts.generated.ts` is produced from `spec/fonts.json` by `npm run sync-profiles`
 * (falling back to the sample fixture until that file is published).
 */
import fonts, { FONTS_SOURCE } from "./profiles/fonts.generated.js";
import type { FontFace, Profile, ProfilesDocument } from "./types.js";

export { FONTS_SOURCE };

/** The bundled `spec/fonts.json` document. */
export const profilesDocument: ProfilesDocument = fonts as unknown as ProfilesDocument;

/** Extracts one profile from a `spec/fonts.json`-shaped document, checking the shape it relies on. */
export function loadProfile(json: unknown, name: string): Profile {
  if (!json || typeof json !== "object") throw new Error("profiles: expected an object");
  const doc = json as Partial<ProfilesDocument>;
  const p = doc.profiles?.[name];
  if (!p) throw new Error(`profiles: no profile named '${name}'`);
  if (!p.sizes || typeof p.sizes !== "object") throw new Error(`profiles: '${name}' has no sizes`);
  for (const [size, s] of Object.entries(p.sizes)) {
    if (!s || typeof s.line_height !== "number" || !s.regular || typeof s.regular.default_advance !== "number") {
      throw new Error(`profiles: '${name}' size '${size}' is malformed`);
    }
  }
  if (!p.icons || typeof p.icons !== "object") throw new Error(`profiles: '${name}' has no icons`);
  return p;
}

/** Names of the bundled profiles. */
export const profileNames: string[] = Object.keys(profilesDocument.profiles ?? {});

/** The reference profile (LilyGo T5 E-Paper S3 Pro). */
export const t5pro: Profile = loadProfile(profilesDocument, "t5pro");

/** Returns a bundled profile by name, or `t5pro` when the name is unknown. */
export function profile(name: string): Profile {
  return profilesDocument.profiles?.[name] ?? t5pro;
}

/**
 * Derives a profile whose text metrics are scaled by `lineHeightRatio` (line heights, ascents
 * and glyph advances, rounded to whole pixels); icon sizes and panel data are unchanged.
 */
export function scaleProfile(base: Profile, lineHeightRatio: number): Profile {
  const r = (n: number) => Math.round(n * lineHeightRatio);
  const face = (f: FontFace): FontFace => ({ default_advance: r(f.default_advance), advance: Object.fromEntries(Object.entries(f.advance).map(([k, v]) => [k, r(v)])) });
  const sizes: Profile["sizes"] = {};
  for (const [name, s] of Object.entries(base.sizes)) {
    if (!s) continue;
    sizes[name as keyof Profile["sizes"]] = { ...s, line_height: r(s.line_height), ascent: r(s.ascent), regular: face(s.regular), ...(s.bold ? { bold: face(s.bold) } : {}) };
  }
  return { ...base, sizes };
}
