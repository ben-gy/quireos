// Glyph lookup, measurement and blitting for the generated Roboto tables.
#include "fontlib.h"
#include <string.h>
#include "fonts/fonts_all.h"

namespace quire {
namespace fontlib {

static const char *const SIZE_NAMES[] = {"xs", "sm", "md", "lg", "xl", "2xl", "3xl", "digits"};

const char *size_name(Size s) { return SIZE_NAMES[(int)s < (int)Size::COUNT ? (int)s : 2]; }

bool size_from_name(const char *name, Size &out) {
  if (!name) return false;
  for (int i = 0; i < (int)Size::COUNT; i++)
    if (strcmp(name, SIZE_NAMES[i]) == 0) { out = (Size)i; return true; }
  return false;
}

bool weight_from_name(const char *name, Weight &out) {
  if (!name) return false;
  if (strcmp(name, "regular") == 0) { out = Weight::REGULAR; return true; }
  if (strcmp(name, "bold") == 0) { out = Weight::BOLD; return true; }
  return false;
}

const Font *font(Size s, Weight w) {
  int si = (int)s;
  if (si < 0 || si >= (int)Size::COUNT) si = (int)Size::MD;
  return fonts::TABLE[si][(int)w & 1];
}

const Glyph *glyph(const Font *f, uint32_t cp) {
  if (!f) return nullptr;
  for (uint32_t i = 0; i < f->interval_count; i++) {
    const Interval &iv = f->intervals[i];
    if (cp < iv.first) return nullptr;      // intervals are ascending
    if (cp <= iv.last) return &f->glyph[iv.offset + (cp - iv.first)];
  }
  return nullptr;
}

uint32_t fallback_code_point() { return '?'; }

uint32_t utf8_next(const char **s) {
  const uint8_t *p = (const uint8_t *)*s;
  if (!*p) return 0;
  uint32_t cp = *p++;
  int extra = 0;
  if (cp >= 0xF0) { extra = 3; cp &= 0x07; }
  else if (cp >= 0xE0) { extra = 2; cp &= 0x0F; }
  else if (cp >= 0xC0) { extra = 1; cp &= 0x1F; }
  else if (cp >= 0x80) { cp = 0xFFFD; }     // stray continuation byte
  while (extra-- > 0) {
    if ((*p & 0xC0) != 0x80) { cp = 0xFFFD; break; }
    cp = (cp << 6) | (*p++ & 0x3F);
  }
  *s = (const char *)p;
  return cp;
}

static const Glyph *glyph_or_fallback(const Font *f, uint32_t cp) {
  const Glyph *g = glyph(f, cp);
  if (!g) g = glyph(f, fallback_code_point());
  if (!g && f->interval_count) g = &f->glyph[0];
  return g;
}

int text_width(const Font *f, const char *s, size_t len) {
  if (!f || !s) return 0;
  int w = 0;
  const char *end = s + len;
  while (s < end) {
    uint32_t cp = utf8_next(&s);
    if (!cp) break;
    const Glyph *g = glyph_or_fallback(f, cp);
    if (g) w += g->advance_x;
  }
  return w;
}

int text_width(const Font *f, const char *s) { return s ? text_width(f, s, strlen(s)) : 0; }

static inline void blend_px(hal::Framebuffer &fb, int x, int y, uint8_t color, uint8_t cov) {
  if (cov == 0) return;
  if (cov >= 15) { fb.set(x, y, color); return; }
  int bg = fb.get(x, y);
  int v = bg + ((int)color - bg) * cov / 15;
  fb.set(x, y, (uint8_t)v);
}

int draw_text(hal::Framebuffer &fb, const Font *f, const char *s, size_t len, int x, int y,
              uint8_t color, const hal::Rect &clip) {
  if (!f || !s || !fb.data) return x;
  hal::Rect fbr; fbr.w = (int16_t)fb.w; fbr.h = (int16_t)fb.h;
  hal::Rect c = clip.clipped(fbr);
  const char *end = s + len;
  while (s < end) {
    uint32_t cp = utf8_next(&s);
    if (!cp) break;
    const Glyph *g = glyph_or_fallback(f, cp);
    if (!g) continue;
    if (!c.empty() && g->width && g->height) {
      int gx = x + g->left, gy = y - g->top;
      int x0 = gx > c.x ? gx : c.x;
      int y0 = gy > c.y ? gy : c.y;
      int x1 = (gx + g->width) < (c.x + c.w) ? (gx + g->width) : (c.x + c.w);
      int y1 = (gy + g->height) < (c.y + c.h) ? (gy + g->height) : (c.y + c.h);
      const size_t rowbytes = (g->width + 1) / 2;
      const uint8_t *bm = f->bitmap + g->data_offset;
      for (int py = y0; py < y1; py++) {
        const uint8_t *row = bm + (size_t)(py - gy) * rowbytes;
        for (int px = x0; px < x1; px++) {
          int ix = px - gx;
          uint8_t cov = (ix & 1) ? (row[ix / 2] >> 4) : (row[ix / 2] & 0x0F);
          blend_px(fb, px, py, color, cov);
        }
      }
    }
    x += g->advance_x;
  }
  return x;
}

}  // namespace fontlib
}  // namespace quire
