import { validateScreen as sdkValidate, canonicalJson, utf8Length, ICON_NAMES } from "@quireos/sdk";
import type { Screen, ValidationError } from "./types.js";

export type Problem = ValidationError;

/**
 * The SDK's spec validator, against the icon set this firmware compiles.
 *
 * An icon the firmware does not compile is an error, not a warning, even when the design library
 * marks it core and the tables are merely stale: the author of the screen usually cannot fix it,
 * but a screen that draws a blank where a glyph belongs is worse than a build that stops and says
 * which name to regenerate. The SDK distinguishes "not compiled" from "no such icon" in the
 * message, which is the part an author can act on.
 */
export function validateScreen(screen: Screen): Problem[] {
  const problems = sdkValidate(screen, { icons: ICON_NAMES, bytes: utf8Length(canonicalJson(screen)) }).errors;
  if (screen.keys && "long" in screen.keys) {
    problems.push({ path: "/keys/long", message: "a long press is always Home; use short or double" });
  }
  return problems;
}

export function screenBytes(screen: Screen): number {
  return utf8Length(canonicalJson(screen));
}
