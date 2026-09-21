// PNG → 4-bit grey image buffer of a fixed size (pngle, streaming, no scaling).
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace quire {
namespace rt {

// Same packing as hal::Framebuffer (two pixels per byte, low nibble = left pixel, 0 = black).
struct ImageBuf {
  uint8_t *data = nullptr;
  uint16_t w = 0, h = 0;
  size_t stride() const { return (size_t)(w + 1) / 2; }
  size_t bytes() const { return stride() * h; }
  uint8_t get(int x, int y) const {
    if (!data || x < 0 || y < 0 || x >= w || y >= h) return 15;
    uint8_t b = data[(size_t)y * stride() + (size_t)x / 2];
    return (x & 1) ? (b >> 4) : (b & 0x0F);
  }
};

// Decodes `png` into a w × h buffer (allocated with hal::alloc_big, white background). Pixels are
// converted with Rec. 709 luma (0.2126 / 0.7152 / 0.0722), quantised to 16 levels and drawn from the
// top-left; anything outside w × h is clipped. Returns false (and frees) on a decode error.
bool png_decode(const uint8_t *png, size_t len, int w, int h, ImageBuf &out);
bool png_dimensions(const uint8_t *png, size_t len, int &w, int &h);
void image_free(ImageBuf &img);

}  // namespace rt
}  // namespace quire
