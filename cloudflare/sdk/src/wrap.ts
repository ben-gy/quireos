/**
 * §6.4 text measurement and greedy word wrapping. The device implements the same algorithm with
 * the same advance tables (`spec/fonts.json`), so a server can paginate text exactly.
 */
import type { FontFace, Profile, TextSize, Weight } from "./types.js";

export const ELLIPSIS = "…";

export interface WrapOptions {
  /** Available width in logical pixels. */
  w: number;
  /** Maximum number of lines (1–8 on the device; any positive integer here). */
  lines: number;
  size?: TextSize;
  weight?: Weight;
  profile: Profile;
}

function face(profile: Profile, size: TextSize, weight: Weight): FontFace {
  const s = profile.sizes[size] ?? profile.sizes.md;
  if (!s) throw new Error(`profile has no size '${size}'`);
  return (weight === "bold" ? s.bold : undefined) ?? s.regular;
}

/** Advance of a single glyph (code point). */
export function advance(ch: string, f: FontFace): number {
  return f.advance[ch] ?? f.default_advance;
}

/** Width of `text` in logical pixels: the sum of glyph advances, no kerning. */
export function measure(text: string, size: TextSize, weight: Weight, profile: Profile): number {
  const f = face(profile, size, weight);
  let w = 0;
  for (const ch of text) w += advance(ch, f);
  return w;
}

/** Line height for a size, from the profile. */
export function lineHeight(size: TextSize, profile: Profile): number {
  const s = profile.sizes[size] ?? profile.sizes.md;
  if (!s) throw new Error(`profile has no size '${size}'`);
  return s.line_height;
}

/**
 * Wraps `text` into at most `lines` lines of width ≤ `w`:
 * paragraphs split on `\n`; words split on single spaces (consecutive spaces yield empty words,
 * so spacing round-trips); a word wider than `w` starts a fresh line and is broken at the last
 * fitting character; when the text needs more than `lines` lines, the output is truncated and the
 * last line gets `…` fitted within `w` by dropping trailing characters.
 */
export function wrap(text: string, opts: WrapOptions): string[] {
  const size = opts.size ?? "md";
  const weight = opts.weight ?? "regular";
  const f = face(opts.profile, size, weight);
  const width = (s: string) => {
    let n = 0;
    for (const ch of s) n += advance(ch, f);
    return n;
  };
  const w = Math.max(0, opts.w);
  const maxLines = Math.max(1, Math.floor(opts.lines));

  const out: string[] = [];
  let overflow = false;
  outer: for (const paragraph of text.split("\n")) {
    let line: string | null = null;
    for (const word of paragraph.split(" ")) {
      const cand: string = line === null ? word : `${line} ${word}`;
      if (width(cand) <= w) {
        line = cand;
        continue;
      }
      if (line !== null) {
        out.push(line);
        line = null;
        if (out.length > maxLines) {
          overflow = true;
          break outer;
        }
      }
      // word alone on a fresh line
      let rest = word;
      while (width(rest) > w) {
        const chars = Array.from(rest);
        let k = 1;
        while (k < chars.length && width(chars.slice(0, k + 1).join("")) <= w) k++;
        out.push(chars.slice(0, k).join(""));
        rest = chars.slice(k).join("");
        if (out.length > maxLines) {
          overflow = true;
          break outer;
        }
      }
      line = rest === "" && rest !== word ? null : rest;
    }
    if (line !== null) out.push(line);
    if (out.length > maxLines) {
      overflow = true;
      break;
    }
  }

  if (out.length > maxLines || overflow) {
    out.length = maxLines;
    let last = Array.from(out[maxLines - 1] ?? "");
    while (last.length > 0 && width(last.join("") + ELLIPSIS) > w) last.pop();
    out[maxLines - 1] = last.join("") + ELLIPSIS;
  }
  return out;
}

/** Number of lines `text` needs at width `w` (no truncation). */
export function countLines(text: string, opts: Omit<WrapOptions, "lines">): number {
  return wrap(text, { ...opts, lines: Number.MAX_SAFE_INTEGER }).length;
}
