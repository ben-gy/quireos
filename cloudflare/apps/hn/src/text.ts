/**
 * Text utilities ported from the native reader (hn-t5/src/text.cpp): HTML fragments → plain
 * text, folding of code points the device fonts lack, relative times and domains.
 */

/** Code points the t5pro fonts carry beyond printable ASCII (spec/fonts.json): Latin-1 plus a few marks. */
const EXTRA_GLYPHS = new Set<number>([0x2013, 0x2014, 0x2022, 0x2026, 0x20ac, 0x2191, 0x2193]);

function hasGlyph(cp: number): boolean {
  if (cp >= 0x20 && cp < 0x7f) return true;
  if (cp >= 0xa1 && cp <= 0xff) return true;
  return EXTRA_GLYPHS.has(cp);
}

const PUNCT: Record<number, string> = {
  0xa0: " ",
  0x2002: " ",
  0x2003: " ",
  0x2009: " ",
  0x200a: " ",
  0x202f: " ",
  0x3000: " ",
  0x2018: "'",
  0x2019: "'",
  0x201a: "'",
  0x201b: "'",
  0x2032: "'",
  0x201c: '"',
  0x201d: '"',
  0x201e: '"',
  0x201f: '"',
  0x2033: '"',
  0x2010: "-",
  0x2011: "-",
  0x2012: "-",
  0x2015: "-",
  0x2212: "-",
  0x2027: "-",
  0x2190: "<-",
  0x2192: "->",
  0x2264: "<=",
  0x2265: ">=",
  0x2260: "!=",
  0x2122: "(TM)",
  0x2713: "v",
  0x2714: "v",
  0x2717: "x",
  0x2718: "x",
};

// Latin Extended-A (U+0100–U+017F): fold onto the base letter, one entry per code point.
const EXT_A =
  "AaAaAa" + // Ā–ą
  "CcCcCcCc" + // Ć–č
  "DdDd" + // Ď–đ
  "EeEeEeEeEe" + // Ē–ě
  "GgGgGgGg" + // Ĝ–ģ
  "HhHh" + // Ĥ–ħ
  "IiIiIiIiIi" + // Ĩ–ı
  "Ii" + // Ĳ ĳ
  "Jj" + // Ĵ ĵ
  "Kkk" + // Ķ ķ ĸ
  "LlLlLlLlLl" + // Ĺ–ł
  "NnNnNnnNn" + // Ń–ŋ
  "OoOoOo" + // Ō–ő
  "Oo" + // Œ œ
  "RrRrRr" + // Ŕ–ř
  "SsSsSsSs" + // Ś–š
  "TtTtTt" + // Ţ–ŧ
  "UuUuUuUuUuUu" + // Ũ–ų
  "Ww" + // Ŵ ŵ
  "YyY" + // Ŷ ŷ Ÿ
  "ZzZzZz" + // Ź–ž
  "s"; // ſ

/** Replaces code points the device cannot draw. Unknown symbols become `?`; invisible marks vanish. */
export function foldGlyphs(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n") {
      out += ch;
      continue;
    }
    if (ch === "\t") {
      out += "    ";
      continue;
    }
    if (ch === "\r") continue;
    if (hasGlyph(cp)) {
      out += ch;
      continue;
    }
    const p = PUNCT[cp];
    if (p !== undefined) {
      out += p;
      continue;
    }
    if (cp >= 0x100 && cp <= 0x17f) {
      out += EXT_A[cp - 0x100] ?? "?";
      continue;
    }
    // combining marks, zero-width joiners/spaces, variation selectors, other controls
    if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f) || cp < 0x20) continue;
    out += "?";
  }
  return out;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "(TM)",
  laquo: "«",
  raquo: "»",
  deg: "°",
  euro: "€",
  pound: "£",
  times: "×",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  ntilde: "ñ",
};

/** Decodes `&amp;`, `&#NNN;`, `&#xHH;` and the common named entities. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    const v = NAMED[e] ?? NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Collapses runs of blank lines to one and trims the ends. */
export function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * HN comment bodies are small HTML fragments (`<p>`, `<i>`, `<a href>`, `<pre><code>`).
 * Paragraphs become blank lines, `<br>` a newline; everything else is dropped.
 */
export function htmlToText(html: string): string {
  let out = "";
  let i = 0;
  const n = html.length;
  let inPre = false;
  while (i < n) {
    const c = html[i]!;
    if (c !== "<") {
      out += c;
      i++;
      continue;
    }
    const close = html.indexOf(">", i + 1);
    if (close < 0) break;
    const tag = html.slice(i + 1, close).trim().toLowerCase();
    const name = /^\/?([a-z0-9]+)/.exec(tag)?.[1] ?? "";
    const closing = tag.startsWith("/");
    if (name === "p" && !closing) out += "\n\n";
    else if (name === "br") out += "\n";
    else if (name === "li" && !closing) out += "\n- ";
    else if (name === "pre") {
      inPre = !closing;
      out += "\n";
    } else if (!closing && (name === "div" || /^h[1-6]$/.test(name) || name === "blockquote" || name === "ul" || name === "ol" || name === "tr" || name === "hr")) out += "\n";
    i = close + 1;
  }
  void inPre;
  // outside <pre>, HTML whitespace is insignificant: fold newlines that came from the source
  out = decodeEntities(out);
  out = foldGlyphs(out);
  out = out.replace(/[ ]{2,}/g, " ");
  return tidy(out);
}

/** `5m`, `3h`, `2d`, `4mo` like the native reader. Empty when the time is unknown. */
export function timeAgo(t: number, now = Math.floor(Date.now() / 1000)): string {
  if (!t || now < 1_600_000_000) return "";
  let d = now - t;
  if (d < 0) d = 0;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  return `${Math.floor(d / (86400 * 30))}mo`;
}

/** Host of a URL without `www.` or a port. */
export function domainOf(url: string): string {
  if (!url) return "";
  let s = url.indexOf("://");
  s = s < 0 ? 0 : s + 3;
  const e = url.indexOf("/", s);
  let h = e < 0 ? url.slice(s) : url.slice(s, e);
  if (h.startsWith("www.")) h = h.slice(4);
  const q = h.indexOf(":");
  if (q > 0) h = h.slice(0, q);
  return h.toLowerCase();
}

const enc = new TextEncoder();
export function utf8Len(s: string): number {
  return enc.encode(s).byteLength;
}

/** Cuts a string to at most `max` UTF-8 bytes (on a code point boundary) and appends a marker. */
export function clampBytes(s: string, max: number, marker = " [...]"): string {
  if (utf8Len(s) <= max) return s;
  let out = "";
  let bytes = 0;
  const budget = max - utf8Len(marker);
  for (const ch of s) {
    const b = utf8Len(ch);
    if (bytes + b > budget) break;
    out += ch;
    bytes += b;
  }
  return out + marker;
}
