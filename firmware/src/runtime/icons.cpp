#include "icons.h"
#include <string.h>
#include "icons_gen.h"

namespace quire {
namespace icons {

int count() { return COUNT; }

int index_of(const char *n) {
  if (!n) return -1;
  int lo = 0, hi = COUNT - 1;      // ICONS is sorted by name
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    int c = strcmp(ICONS[mid].name, n);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

const char *name(int i) { return (i >= 0 && i < COUNT) ? ICONS[i].name : ""; }

bool size_from_name(const char *n, IconSize &out) {
  if (!n) return false;
  if (!strcmp(n, "sm")) { out = IconSize::SM; return true; }
  if (!strcmp(n, "md")) { out = IconSize::MD; return true; }
  if (!strcmp(n, "lg")) { out = IconSize::LG; return true; }
  return false;
}

uint16_t pixels(IconSize s) { return SIZES[(int)s % 3]; }
bool has_size(int index, IconSize s) { return index >= 0 && index < COUNT && ICONS[index].bitmap[(int)s % 3] != nullptr; }

void draw(hal::Framebuffer &fb, int index, IconSize s, int x, int y, uint8_t color, const hal::Rect &clip) {
  if (index < 0 || index >= COUNT || !fb.data) return;
  if (!ICONS[index].bitmap[(int)s % 3]) {
    // No bitmap at this size: centre the md bitmap in the requested box.
    int req = SIZES[(int)s % 3], md = SIZES[1];
    s = IconSize::MD;
    x += (req - md) / 2; y += (req - md) / 2;
  }
  const int px = SIZES[(int)s % 3];
  const uint8_t *bm = ICONS[index].bitmap[(int)s % 3];
  hal::Rect fbr; fbr.w = (int16_t)fb.w; fbr.h = (int16_t)fb.h;
  hal::Rect c = clip.clipped(fbr);
  if (c.empty()) return;
  int x0 = x > c.x ? x : c.x, y0 = y > c.y ? y : c.y;
  int x1 = (x + px) < (c.x + c.w) ? (x + px) : (c.x + c.w);
  int y1 = (y + px) < (c.y + c.h) ? (y + px) : (c.y + c.h);
  const size_t rowbytes = (px + 1) / 2;
  for (int py = y0; py < y1; py++) {
    const uint8_t *row = bm + (size_t)(py - y) * rowbytes;
    for (int qx = x0; qx < x1; qx++) {
      int ix = qx - x;
      uint8_t cov = (ix & 1) ? (row[ix / 2] >> 4) : (row[ix / 2] & 0x0F);
      if (!cov) continue;
      if (cov >= 15) { fb.set(qx, py, color); continue; }
      int bg = fb.get(qx, py);
      fb.set(qx, py, (uint8_t)(bg + ((int)color - bg) * cov / 15));
    }
  }
}

}  // namespace icons
}  // namespace quire
