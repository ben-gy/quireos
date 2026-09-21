/** Maps JSON pointers to line numbers in the original text, for `path:line:` style messages. */

export interface Located {
  line: number;
  column: number;
}

/** Parses `text` and records the 1-based line/column of every value, keyed by JSON pointer. */
export function locateJson(text: string): Map<string, Located> {
  const out = new Map<string, Located>();
  let i = 0;
  let line = 1;
  let col = 1;
  const peek = () => text[i] ?? "";
  const adv = () => {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else col++;
    i++;
  };
  const ws = () => {
    while (i < text.length && /[\s]/.test(text[i]!)) adv();
  };
  const str = (): string => {
    adv(); // opening quote
    let s = "";
    while (i < text.length && peek() !== '"') {
      if (peek() === "\\") {
        adv();
        const c = peek();
        adv();
        if (c === "u") {
          s += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
          for (let k = 0; k < 4; k++) adv();
        } else s += { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }[c] ?? c;
      } else {
        s += peek();
        adv();
      }
    }
    adv(); // closing quote
    return s;
  };
  const esc = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");
  const value = (ptr: string): void => {
    ws();
    out.set(ptr, { line, column: col });
    const c = peek();
    if (c === "{") {
      adv();
      ws();
      if (peek() === "}") return void adv();
      for (;;) {
        ws();
        const key = str();
        ws();
        adv(); // :
        value(`${ptr}/${esc(key)}`);
        ws();
        if (peek() === ",") {
          adv();
          continue;
        }
        adv(); // }
        return;
      }
    }
    if (c === "[") {
      adv();
      ws();
      if (peek() === "]") return void adv();
      let n = 0;
      for (;;) {
        value(`${ptr}/${n++}`);
        ws();
        if (peek() === ",") {
          adv();
          continue;
        }
        adv(); // ]
        return;
      }
    }
    if (c === '"') return void str();
    while (i < text.length && !/[\s,\]}]/.test(peek())) adv(); // number / true / false / null
  };
  try {
    value("");
  } catch {
    /* malformed JSON: whatever was located is still useful */
  }
  return out;
}

/** Line of the pointer, or of its nearest existing ancestor, or 1. */
export function lineOf(map: Map<string, Located>, pointer: string): number {
  let p = pointer;
  for (;;) {
    const hit = map.get(p);
    if (hit) return hit.line;
    if (p === "") return 1;
    p = p.slice(0, p.lastIndexOf("/"));
  }
}
