// Word wrapping exactly as SPEC §6.4 (the SDK implements the same algorithm from spec/fonts.json).
#pragma once
#include <stddef.h>
#include "fontlib.h"

namespace quire {
namespace wrap {

struct Line { const char *text; size_t len; };   // NUL-terminated inside the caller's buffer

// Width of `len` bytes of UTF-8 in `f`: the sum of glyph advances, no kerning.
int measure(const fontlib::Font *f, const char *s, size_t len);

// Wrap `text` into at most `max_lines` lines no wider than `w`. Lines are copied NUL-terminated
// into `buf` (needs strlen(text) + 4 * max_lines bytes; overflow truncates). Returns the number of
// lines written to `out` (≤ out_cap). The last line is ellipsised when the text was cut.
int wrap(const fontlib::Font *f, const char *text, int w, int max_lines, char *buf, size_t buf_len,
         Line *out, int out_cap);

}  // namespace wrap
}  // namespace quire
