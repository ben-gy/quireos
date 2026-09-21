#include "png_decode.h"
#include <string.h>
#include "../hal/hal.h"
#include "third_party/pngle.h"

namespace quire {
namespace rt {

namespace {
struct Ctx { ImageBuf *img; bool failed; };

void on_draw(pngle_t *p, uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint8_t rgba[4]) {
  Ctx *c = (Ctx *)pngle_get_user_data(p);
  ImageBuf &img = *c->img;
  // Rec. 709 luma in 16.16 fixed point, alpha composited over white.
  uint32_t grey = (13933u * rgba[0] + 46871u * rgba[1] + 4732u * rgba[2]) >> 16;
  uint32_t a = rgba[3];
  if (a < 255) grey = (grey * a + 255u * (255u - a)) / 255u;
  uint8_t v = (uint8_t)((grey * 15u + 127u) / 255u);
  for (uint32_t yy = y; yy < y + h && yy < img.h; yy++) {
    for (uint32_t xx = x; xx < x + w && xx < img.w; xx++) {
      uint8_t *b = &img.data[(size_t)yy * img.stride() + xx / 2];
      if (xx & 1) *b = (uint8_t)((*b & 0x0F) | (v << 4));
      else *b = (uint8_t)((*b & 0xF0) | v);
    }
  }
}
}  // namespace

void image_free(ImageBuf &img) {
  if (img.data) hal::free_big(img.data);
  img.data = nullptr; img.w = img.h = 0;
}

bool png_dimensions(const uint8_t *png, size_t len, int &w, int &h) {
  if (!png || len < 24 || memcmp(png, "\x89PNG\r\n\x1a\n", 8) != 0) return false;
  w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
  h = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
  return w > 0 && h > 0;
}

bool png_decode(const uint8_t *png, size_t len, int w, int h, ImageBuf &out) {
  image_free(out);
  if (!png || !len || w <= 0 || h <= 0 || w > 4096 || h > 4096) return false;
  out.w = (uint16_t)w; out.h = (uint16_t)h;
  out.data = (uint8_t *)hal::alloc_big(out.bytes());
  if (!out.data) { out.w = out.h = 0; return false; }
  memset(out.data, 0xFF, out.bytes());
  pngle_t *p = pngle_new();
  if (!p) { image_free(out); return false; }
  Ctx ctx{&out, false};
  pngle_set_user_data(p, &ctx);
  pngle_set_draw_callback(p, on_draw);
  size_t off = 0;
  bool ok = true;
  while (off < len) {
    size_t chunk = len - off > 4096 ? 4096 : len - off;
    int n = pngle_feed(p, png + off, chunk);
    if (n < 0) { hal::log(hal::LOG_WARN, "png", "decode failed: %s", pngle_error(p)); ok = false; break; }
    if (n == 0) break;
    off += (size_t)n;
  }
  pngle_destroy(p);
  if (!ok) image_free(out);
  return ok;
}

}  // namespace rt
}  // namespace quire
