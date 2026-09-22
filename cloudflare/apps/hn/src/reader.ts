/**
 * Reader-mode extraction, a port of hn-t5/src/reader.cpp: drop page furniture (script, style,
 * nav, header, footer, aside, form…), prefer `<article>`/`<main>`, keep headings (`# `) and list
 * items (`- `), collapse whitespace, and say so when a page builds its body in JavaScript.
 */
import { decodeEntities, domainOf, foldGlyphs, tidy } from "./text.js";
import { cacheGet, cachePut } from "./cache.js";

export const MAX_ARTICLE_CHARS = 60_000;
export const MAX_HTML_BYTES = 1_500_000;
export const ARTICLE_TTL = 600;

const DROP = new Set(["script", "style", "noscript", "svg", "iframe", "form", "nav", "aside", "header", "footer", "template", "button", "select", "textarea", "canvas", "video", "audio", "head", "figure", "object", "embed", "map", "dialog"]);
const BLOCK = new Set(["p", "div", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote", "pre", "section", "article", "main", "tr", "td", "th", "dd", "dt", "dl", "figcaption", "table", "body"]);

interface Para {
  text: string;
  heading: boolean;
}

export interface Article {
  title: string;
  /** Paragraphs separated by blank lines; headings start with `# `. */
  body: string;
  truncated?: boolean;
}

/** Index just past the `>` that closes the tag starting at `i`, honouring quoted attributes. */
function endOfTag(h: string, i: number, to: number): number {
  let quote = "";
  for (let k = i; k < to; k++) {
    const c = h[k]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return k + 1;
  }
  return to;
}

function findClose(h: string, name: string, from: number, to: number): number {
  const lower = h;
  let k = from;
  for (;;) {
    k = lower.indexOf("</", k);
    if (k < 0 || k >= to) return to;
    if (lower.slice(k + 2, k + 2 + name.length).toLowerCase() === name) {
      const after = lower[k + 2 + name.length] ?? ">";
      if (after === ">" || /\s/.test(after)) return endOfTag(h, k, to);
    }
    k += 2;
  }
}

/** Locates `<name …>…</name>` honouring nesting; returns `[start of content, end)` or undefined. */
function findBlock(h: string, name: string): [number, number] | undefined {
  const re = new RegExp(`<${name}(?=[\\s>])`, "i");
  const m = re.exec(h);
  if (!m) return undefined;
  const open = endOfTag(h, m.index, h.length);
  const openRe = new RegExp(`<(/?)${name}(?=[\\s>/])`, "gi");
  openRe.lastIndex = open;
  let depth = 1;
  let t: RegExpExecArray | null;
  while ((t = openRe.exec(h))) {
    depth += t[1] === "/" ? -1 : 1;
    if (depth === 0) return [open, t.index];
  }
  return [open, h.length];
}

function extractTitle(h: string): string {
  const b = findBlock(h, "title");
  if (!b) return "";
  let t = h.slice(b[0], Math.min(b[1], b[0] + 400));
  const lt = t.indexOf("<");
  if (lt >= 0) t = t.slice(0, lt);
  return tidy(foldGlyphs(decodeEntities(t)).replace(/\s+/g, " "));
}

function walk(h: string, from: number, to: number, out: Para[]): void {
  let cur = "";
  let curHeading = false;
  let pendingBullet = false;
  let inPre = false;
  const flush = () => {
    if (cur.trim()) {
      let t = foldGlyphs(decodeEntities(cur));
      t = inPre ? tidy(t) : t.replace(/\s+/g, " ").trim();
      if (t) out.push({ text: pendingBullet ? `- ${t}` : t, heading: curHeading });
    }
    cur = "";
    curHeading = false;
    pendingBullet = false;
  };
  let i = from;
  while (i < to) {
    const c = h[i]!;
    if (c !== "<") {
      if (inPre) cur += c;
      else if (/\s/.test(c)) {
        if (cur && !cur.endsWith(" ")) cur += " ";
      } else if (cur.length < 6000) cur += c;
      i++;
      continue;
    }
    if (h.startsWith("<!--", i)) {
      const k = h.indexOf("-->", i + 4);
      i = k < 0 || k + 3 > to ? to : k + 3;
      continue;
    }
    const n1 = h[i + 1] ?? "";
    if (n1 === "!" || n1 === "?") {
      i = endOfTag(h, i, to);
      continue;
    }
    const closing = n1 === "/";
    let p = i + 1 + (closing ? 1 : 0);
    let name = "";
    while (p < to && /[a-z0-9]/i.test(h[p]!)) name += h[p++]!;
    if (!name) {
      i = endOfTag(h, i, to);
      continue;
    }
    name = name.toLowerCase();
    if (!closing && DROP.has(name)) {
      const after = endOfTag(h, i, to);
      if (h[after - 2] === "/") {
        i = after; // self-closing: nothing to skip
        continue;
      }
      flush();
      i = findClose(h, name, after, to);
      continue;
    }
    if (BLOCK.has(name)) {
      flush();
      if (!closing && /^h[1-6]$/.test(name)) curHeading = true;
      if (!closing && name === "li") pendingBullet = true;
      if (name === "pre") inPre = !closing;
    }
    i = endOfTag(h, i, to);
  }
  flush();
}

export interface ExtractResult {
  ok: true;
  article: Article;
}
export interface ExtractFailure {
  ok: false;
  reason: string;
}

/** Runs the extraction over HTML or plain text already fetched. */
export function extract(html: string, contentType: string, url: string): ExtractResult | ExtractFailure {
  const ct = contentType.toLowerCase();
  if (ct.includes("text/plain")) {
    const body = tidy(foldGlyphs(html)).slice(0, MAX_ARTICLE_CHARS);
    return body ? { ok: true, article: { title: domainOf(url) || url, body } } : { ok: false, reason: "The page is empty" };
  }
  if (ct && !ct.includes("html") && !ct.includes("xml")) return { ok: false, reason: `Not a readable page (${ct.split(";")[0]})` };

  const title = extractTitle(html);
  let range: [number, number] | undefined;
  const art = findBlock(html, "article");
  const main = findBlock(html, "main");
  if (art && art[1] - art[0] > 400) range = art;
  else if (main && main[1] - main[0] > 400) range = main;
  else range = findBlock(html, "body") ?? [0, html.length];

  const paras: Para[] = [];
  walk(html, range[0], range[1], paras);

  const assemble = (minLen: number): { body: string; truncated: boolean } => {
    const parts: string[] = [];
    let prev = "";
    let len = 0;
    let truncated = false;
    for (const p of paras) {
      if (parts.length > 400 || len > MAX_ARTICLE_CHARS) {
        truncated = true;
        break;
      }
      const need = p.heading ? 2 : minLen;
      if (p.text.length < need) continue;
      if (p.text === prev) continue;
      prev = p.text;
      const line = p.heading ? `# ${p.text}` : p.text;
      parts.push(line);
      len += line.length + 2;
    }
    return { body: parts.join("\n\n"), truncated };
  };

  let r = assemble(30);
  if (r.body.length < 250) r = assemble(12); // short or oddly structured page
  if (r.body.length < 60) return { ok: false, reason: "No readable text found (the page may need JavaScript)" };
  const article: Article = { title: title || domainOf(url), body: r.body };
  if (r.truncated || r.body.length > MAX_ARTICLE_CHARS) {
    article.body = `${r.body.slice(0, MAX_ARTICLE_CHARS)}\n\n[Article truncated.]`;
    article.truncated = true;
  }
  return { ok: true, article };
}

/** Fetches a page (10 s, ≤ 1.5 MB, one redirect hop allowed by the platform) and extracts it. */
export async function fetchArticle(url: string, fetchFn: typeof fetch = fetch): Promise<ExtractResult | ExtractFailure> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuireOS-hn/1.0; +https://github.com/quireos)", Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: `Could not fetch the page (${(err as Error).name === "AbortError" ? "timed out" : (err as Error).message})`.slice(0, 120) };
  }
  clearTimeout(timer);
  if (!res.ok) return { ok: false, reason: `The site answered ${res.status}` };
  const ct = res.headers.get("Content-Type") ?? "";
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, MAX_HTML_BYTES));
  const charset = /charset=["']?([\w-]+)/i.exec(ct)?.[1]?.toLowerCase();
  let text = "";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const metaCharset = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const enc = charset ?? metaCharset ?? "utf-8";
  try {
    text = new TextDecoder(enc === "iso-8859-1" || enc === "windows-1252" || enc === "latin1" ? "windows-1252" : enc).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  return extract(text, ct, url);
}

/** Article text for a story, cached for ten minutes per story id (failures are not cached). */
export async function articleFor(storyId: number, url: string, fetchFn?: typeof fetch, force = false): Promise<ExtractResult | ExtractFailure> {
  const key = `article/${storyId}`;
  if (!force) {
    const hit = await cacheGet<Article>(key);
    if (hit) return { ok: true, article: hit };
  }
  const res = await fetchArticle(url, fetchFn);
  if (res.ok) await cachePut(key, res.article, ARTICLE_TTL);
  return res;
}
