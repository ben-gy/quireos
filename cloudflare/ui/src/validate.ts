import { validateScreen as sdkValidate, canonicalJson, utf8Length } from "@quireos/sdk";
import type { Screen, ValidationError } from "./types.js";
import iconsJson from "./generated/icons.js";
import specIcons from "./generated/spec_icons.js";

/**
 * The names the firmware compiles. The library is wider than the firmware: an extended-tier icon is
 * a real name that draws nothing on a board that did not compile it, so the validator checks
 * against the compiled set and the library only tells us which of the two a mistake is.
 */
const COMPILED: readonly string[] = ((specIcons as unknown as { icons?: readonly string[] }).icons ?? iconsJson.icons.map((i) => i.name)) as readonly string[];
const LIBRARY: ReadonlySet<string> = new Set<string>(iconsJson.icons.map((i) => i.name as string));
const TIER: ReadonlyMap<string, string> = new Map<string, string>(iconsJson.icons.map((i) => [i.name as string, i.tier as string]));
export type Problem = ValidationError;

/**
 * An icon that the library marks core but this firmware has not compiled yet. That is the two
 * sides being out of step, not a mistake in the screen: the fix is to regenerate the firmware's
 * icon tables, so a build should report it and carry on rather than fail.
 */
export const PENDING_ICON = "not compiled into this firmware yet";
export const isPendingFirmwareIcon = (p: Problem): boolean => p.message.includes(PENDING_ICON);

/** The SDK's spec validator, with this library's icon names as the known set. Empty means valid. */
export function validateScreen(screen: Screen): Problem[] {
  const problems = sdkValidate(screen, { icons: COMPILED, bytes: utf8Length(canonicalJson(screen)) }).errors;
  for (const p of problems) {
    const m = /unknown icon '([^']+)'/.exec(p.message);
    if (!m) continue;
    const name = m[1]!;
    if (!LIBRARY.has(name)) continue;
    p.message = TIER.get(name) === "core"
      ? `icon '${name}' is core in the library but ${PENDING_ICON}; regenerate the firmware icon tables`
      : `icon '${name}' is in the library but not compiled into this firmware (extended tier); use a core icon or a PNG`;
  }
  if (screen.keys && "long" in screen.keys) problems.push({ path: "/keys/long", message: "a long press is always Home; use short or double" });
  return problems;
}
export function screenBytes(screen: Screen): number { return utf8Length(canonicalJson(screen)); }
