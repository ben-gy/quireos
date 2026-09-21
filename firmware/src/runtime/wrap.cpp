#include "wrap.h"
#include <string.h>

namespace quire {
namespace wrap {

static const char ELLIPSIS[] = "\xE2\x80\xA6";   // U+2026

int measure(const fontlib::Font *f, const char *s, size_t len) { return fontlib::text_width(f, s, len); }

namespace {

struct Out {
  char *buf; size_t cap, used;
  Line *lines; int cap_lines, n;
  bool push(const char *s, size_t len) {
    if (n >= cap_lines) return false;
    if (used + len + 1 > cap) len = (used + 1 < cap) ? cap - used - 1 : 0;
    char *dst = buf + used;
    memcpy(dst, s, len);
    dst[len] = 0;
    lines[n].text = dst; lines[n].len = len; n++;
    used += len + 1;
    return true;
  }
};

// Bytes of the last UTF-8 code point in s[0..len).
size_t last_cp_len(const char *s, size_t len) {
  if (!len) return 0;
  size_t i = len - 1;
  while (i > 0 && ((unsigned char)s[i] & 0xC0) == 0x80) i--;
  return len - i;
}

// Longest prefix (≥ 1 code point) of word[0..len) that fits in w. Returns its byte length.
size_t fit_prefix(const fontlib::Font *f, const char *word, size_t len, int w) {
  size_t best = 0;
  const char *p = word;
  const char *end = word + len;
  while (p < end) {
    const char *q = p;
    fontlib::utf8_next(&q);
    size_t cand = (size_t)(q - word);
    if (measure(f, word, cand) > w && best > 0) break;
    best = cand;
    p = q;
    if (measure(f, word, best) > w) break;   // first code point alone is too wide: keep it anyway
  }
  return best ? best : len;
}

}  // namespace

int wrap(const fontlib::Font *f, const char *text, int w, int max_lines, char *buf, size_t buf_len,
         Line *out, int out_cap) {
  if (!text) text = "";
  if (max_lines < 1) max_lines = 1;
  if (out_cap < 1 || !buf || buf_len < 4) return 0;
  Out o{buf, buf_len, 0, out, out_cap, 0};
  bool overflow = false;   // more lines than max_lines were produced

  // Working line lives in a scratch region at the end of buf is awkward; instead we track the
  // current line as a [start, end) span in `text` plus an optional broken-word tail. To keep it
  // simple, a line is always a contiguous span of the paragraph (words joined by their original
  // single spaces), so spans suffice.
  const char *p = text;
  bool done = false;
  while (!done) {
    const char *para_end = strchr(p, '\n');
    if (!para_end) { para_end = p + strlen(p); done = true; }
    const char *line_start = p;
    const char *line_end = p;          // exclusive
    const char *word = p;
    bool first = true;
    while (true) {
      const char *sp = (const char *)memchr(word, ' ', (size_t)(para_end - word));
      const char *word_end = sp ? sp : para_end;
      if (first) {
        line_start = word; line_end = word_end; first = false;
      } else {
        // candidate = line + " " + word  (contiguous in the source)
        if (measure(f, line_start, (size_t)(word_end - line_start)) <= w) {
          line_end = word_end;
        } else {
          if (o.n >= max_lines) overflow = true; else o.push(line_start, (size_t)(line_end - line_start));
          line_start = word; line_end = word_end;
        }
      }
      // Break a word wider than w at the last fitting character.
      while (measure(f, line_start, (size_t)(line_end - line_start)) > w) {
        size_t k = fit_prefix(f, line_start, (size_t)(line_end - line_start), w);
        if (k >= (size_t)(line_end - line_start)) break;
        if (o.n >= max_lines) overflow = true; else o.push(line_start, k);
        line_start += k;
      }
      if (!sp) break;
      word = sp + 1;
    }
    if (o.n >= max_lines) overflow = true; else o.push(line_start, (size_t)(line_end - line_start));
    if (overflow) break;
    p = para_end + 1;
  }

  if (overflow && o.n > 0) {
    // Ellipsise the last line so it fits in w.
    Line &l = out[o.n - 1];
    char *s = (char *)l.text;
    size_t len = l.len;
    while (len > 0 && s[len - 1] == ' ') len--;
    const int ell_w = measure(f, ELLIPSIS, 3);
    while (len > 0 && measure(f, s, len) + ell_w > w) {
      len -= last_cp_len(s, len);
      while (len > 0 && s[len - 1] == ' ') len--;
    }
    // The line was the last thing pushed, so its bytes end at o.used - 1; rewrite in place.
    size_t room = o.cap - (size_t)(s - o.buf);
    if (len + 4 <= room) { memcpy(s + len, ELLIPSIS, 3); s[len + 3] = 0; l.len = len + 3; }
    else { s[len] = 0; l.len = len; }
  }
  return o.n;
}

}  // namespace wrap
}  // namespace quire
