// Board-independent helpers declared in hal.h: geometry, framebuffer fills, the X-Screen string.
#include "hal.h"
#include <stdio.h>
#include <string.h>

namespace quire {
namespace hal {

Rect Rect::united(const Rect &o) const {
  if (empty()) return o;
  if (o.empty()) return *this;
  int x0 = x < o.x ? x : o.x;
  int y0 = y < o.y ? y : o.y;
  int x1 = (x + w) > (o.x + o.w) ? (x + w) : (o.x + o.w);
  int y1 = (y + h) > (o.y + o.h) ? (y + h) : (o.y + o.h);
  Rect r;
  r.x = (int16_t)x0; r.y = (int16_t)y0; r.w = (int16_t)(x1 - x0); r.h = (int16_t)(y1 - y0);
  return r;
}

Rect Rect::clipped(const Rect &o) const {
  int x0 = x > o.x ? x : o.x;
  int y0 = y > o.y ? y : o.y;
  int x1 = (x + w) < (o.x + o.w) ? (x + w) : (o.x + o.w);
  int y1 = (y + h) < (o.y + o.h) ? (y + h) : (o.y + o.h);
  Rect r;
  if (x1 <= x0 || y1 <= y0) return r;   // empty
  r.x = (int16_t)x0; r.y = (int16_t)y0; r.w = (int16_t)(x1 - x0); r.h = (int16_t)(y1 - y0);
  return r;
}

void Framebuffer::fill(uint8_t v) {
  if (!data) return;
  v &= 0x0F;
  memset(data, (v << 4) | v, bytes());
}

void Framebuffer::fill_rect(Rect r, uint8_t v) {
  if (!data) return;
  Rect full; full.w = (int16_t)w; full.h = (int16_t)h;
  r = r.clipped(full);
  if (r.empty()) return;
  v &= 0x0F;
  const uint8_t both = (uint8_t)((v << 4) | v);
  for (int y = r.y; y < r.y + r.h; y++) {
    int x = r.x, x1 = r.x + r.w;
    uint8_t *row = data + (size_t)y * stride();
    if (x & 1) { row[x / 2] = (uint8_t)((row[x / 2] & 0x0F) | (v << 4)); x++; }
    while (x + 1 < x1) { row[x / 2] = both; x += 2; }
    if (x < x1) row[x / 2] = (uint8_t)((row[x / 2] & 0xF0) | v);
  }
}

void Framebuffer::invert_rect(Rect r) {
  if (!data) return;
  Rect full; full.w = (int16_t)w; full.h = (int16_t)h;
  r = r.clipped(full);
  if (r.empty()) return;
  for (int y = r.y; y < r.y + r.h; y++) {
    int x = r.x, x1 = r.x + r.w;
    uint8_t *row = data + (size_t)y * stride();
    if (x & 1) { row[x / 2] ^= 0xF0; x++; }
    while (x + 1 < x1) { row[x / 2] ^= 0xFF; x += 2; }
    if (x < x1) row[x / 2] ^= 0x0F;
  }
}

const char *screen_string(char *buf, size_t len) {
  Board &b = board();
  unsigned w = 0, h = 0, greys = 16, dpi = 150;
  if (b.display) {
    w = b.display->width();
    h = b.display->height();
    greys = b.display->caps().greys;
    dpi = b.display->caps().dpi;
  }
  snprintf(buf, len, "%ux%ux%u@%u", w, h, greys, dpi);
  return buf;
}

}  // namespace hal
}  // namespace quire
