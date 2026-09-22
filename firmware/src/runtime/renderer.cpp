#include "renderer.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "wrap.h"

namespace quire {
namespace rt {

static int g_greys = 16;
void set_greys(int greys) { g_greys = greys; }
int tone_tertiary() { return g_greys >= 16 ? 9 : g_greys >= 4 ? 10 : 0; }
int tone_secondary() { return g_greys >= 16 ? 6 : g_greys >= 4 ? 5 : 0; }
int tone_fill_disabled() { return g_greys >= 16 ? 13 : 15; }

namespace {

// Horizontal inset of a rounded rectangle at `row` (0-based) of height h with corner radius r.
int corner_inset(int row, int r, int h) {
  if (r <= 0) return 0;
  float dy;
  if (row < r) dy = (float)r - (float)row - 0.5f;
  else if (row >= h - r) dy = (float)row - (float)(h - r) + 0.5f;
  else return 0;
  float dx = sqrtf((float)r * (float)r - dy * dy);
  int inset = (int)((float)r - dx + 0.5f);
  return inset < 0 ? 0 : inset;
}

void hspan(hal::Framebuffer &fb, int y, int x0, int x1, uint8_t v, const hal::Rect &clip) {
  if (y < clip.y || y >= clip.y + clip.h) return;
  if (x0 < clip.x) x0 = clip.x;
  if (x1 > clip.x + clip.w) x1 = clip.x + clip.w;
  if (x1 <= x0) return;
  hal::Rect r; r.x = (int16_t)x0; r.y = (int16_t)y; r.w = (int16_t)(x1 - x0); r.h = 1;
  fb.fill_rect(r, v);
}

int button_fill(const Widget &w) {
  if (w.disabled && w.fill >= 0 && w.fill < 8) return tone_fill_disabled();
  return w.fill;
}
uint8_t button_colour(const Widget &w) {
  if (w.disabled) return (uint8_t)tone_tertiary();
  if (w.color >= 0) return (uint8_t)w.color;
  return (w.fill >= 0 && w.fill < 8) ? 15 : 0;
}
uint8_t ink(const Widget &w, int def) {
  if (w.disabled) return (uint8_t)tone_tertiary();
  return (uint8_t)(w.color < 0 ? def : w.color);
}

void blit_image(hal::Framebuffer &fb, const ImageBuf &img, hal::Rect r, const hal::Rect &clip) {
  hal::Rect c = r.clipped(clip);
  if (c.empty() || !img.data) return;
  for (int y = c.y; y < c.y + c.h; y++) {
    int iy = y - r.y;
    if (iy >= img.h) break;
    for (int x = c.x; x < c.x + c.w; x++) {
      int ix = x - r.x;
      if (ix >= img.w) break;
      fb.set(x, y, img.get(ix, iy));
    }
  }
}

}  // namespace

void fill_rounded(hal::Framebuffer &fb, hal::Rect r, int radius, int fill, int stroke, int stroke_w, const hal::Rect &clip) {
  if (r.empty()) return;
  int maxr = (r.w < r.h ? r.w : r.h) / 2;
  if (radius > maxr) radius = maxr;
  if (stroke < 0) stroke_w = 0;
  if (stroke_w * 2 > r.w || stroke_w * 2 > r.h) stroke_w = (r.w < r.h ? r.w : r.h) / 2;
  int ri = radius - stroke_w; if (ri < 0) ri = 0;
  int ih = r.h - 2 * stroke_w;
  for (int row = 0; row < r.h; row++) {
    int y = r.y + row;
    if (y < clip.y || y >= clip.y + clip.h) continue;
    int o = corner_inset(row, radius, r.h);
    int xo0 = r.x + o, xo1 = r.x + r.w - o;
    if (stroke_w > 0 && (row < stroke_w || row >= r.h - stroke_w)) { hspan(fb, y, xo0, xo1, (uint8_t)stroke, clip); continue; }
    int i = stroke_w > 0 ? corner_inset(row - stroke_w, ri, ih) : 0;
    int xi0 = r.x + stroke_w + i, xi1 = r.x + r.w - stroke_w - i;
    if (stroke_w > 0) {
      hspan(fb, y, xo0, xi0, (uint8_t)stroke, clip);
      hspan(fb, y, xi1, xo1, (uint8_t)stroke, clip);
    }
    if (fill >= 0) hspan(fb, y, xi0, xi1, (uint8_t)fill, clip);
  }
}

void draw_line(hal::Framebuffer &fb, int x1, int y1, int x2, int y2, int width, uint8_t color, const hal::Rect &clip) {
  if (width < 1) width = 1;
  int half = width / 2;
  if (y1 == y2) {
    hal::Rect r; r.x = (int16_t)(x1 < x2 ? x1 : x2); r.y = (int16_t)(y1 - half); r.w = (int16_t)(abs(x2 - x1) + 1); r.h = (int16_t)width;
    fb.fill_rect(r.clipped(clip), color);
    return;
  }
  if (x1 == x2) {
    hal::Rect r; r.x = (int16_t)(x1 - half); r.y = (int16_t)(y1 < y2 ? y1 : y2); r.w = (int16_t)width; r.h = (int16_t)(abs(y2 - y1) + 1);
    fb.fill_rect(r.clipped(clip), color);
    return;
  }
  int dx = abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  int dy = -abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  int err = dx + dy;
  int x = x1, y = y1;
  while (true) {
    hal::Rect r; r.x = (int16_t)(x - half); r.y = (int16_t)(y - half); r.w = (int16_t)width; r.h = (int16_t)width;
    fb.fill_rect(r.clipped(clip), color);
    if (x == x2 && y == y2) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

int draw_text_block(hal::Framebuffer &fb, const char *text, hal::Rect r, fontlib::Size size, fontlib::Weight weight,
                    Align align, VAlign valign, int max_lines, uint8_t color, const hal::Rect &clip) {
  if (!text || !*text || r.empty()) return 0;
  const fontlib::Font *f = fontlib::font(size, weight);
  if (max_lines < 1) max_lines = 1;
  if (max_lines > 8) max_lines = 8;
  size_t tl = strlen(text);
  size_t cap = tl + 4 * (size_t)max_lines + 8;
  char stackbuf[640];
  char *buf = cap <= sizeof stackbuf ? stackbuf : (char *)malloc(cap);
  if (!buf) return 0;
  wrap::Line lines[8];
  int n = wrap::wrap(f, text, r.w, max_lines, buf, cap, lines, 8);
  int lh = f->advance_y;
  int block = n * lh;
  int y0 = r.y;
  if (valign == VAlign::MIDDLE) y0 = r.y + (r.h - block) / 2;
  else if (valign == VAlign::BOTTOM) y0 = r.y + r.h - block;
  hal::Rect c = r.clipped(clip);
  for (int i = 0; i < n; i++) {
    int lw = fontlib::text_width(f, lines[i].text, lines[i].len);
    int x = r.x;
    if (align == Align::CENTER) x = r.x + (r.w - lw) / 2;
    else if (align == Align::RIGHT) x = r.x + r.w - lw;
    fontlib::draw_text(fb, f, lines[i].text, lines[i].len, x, y0 + i * lh + f->ascender, color, c);
  }
  if (buf != stackbuf) free(buf);
  return n;
}

void draw_widget(hal::Framebuffer &fb, const WidgetTree &tree, const Widget &w, const hal::Rect &clip, const RenderImages *images) {
  hal::Rect c = w.r.clipped(clip);
  switch (w.type) {
    case WType::TEXT:
      draw_text_block(fb, tree.str(w.text), w.r, w.size, w.weight, w.align, w.valign, w.lines, ink(w, 0), clip);
      break;
    case WType::RECT:
      fill_rounded(fb, w.r, w.radius, w.disabled && w.fill >= 0 && w.fill < 8 ? tone_fill_disabled() : w.fill,
                   w.disabled && w.stroke >= 0 ? tone_tertiary() : w.stroke, w.stroke_w, clip);
      break;
    case WType::LINE:
      draw_line(fb, w.x1, w.y1, w.x2, w.y2, w.line_w, ink(w, 0), clip);
      break;
    case WType::ICON: {
      if (w.icon < 0) break;
      int px = icons::pixels(w.icon_size);
      icons::draw(fb, w.icon, w.icon_size, w.r.x + (w.r.w - px) / 2, w.r.y + (w.r.h - px) / 2, ink(w, 0), clip);
      break;
    }
    case WType::IMAGE:
      if (images && w.image_slot >= 0 && w.image_slot < MAX_IMAGES && images->slots[w.image_slot])
        blit_image(fb, *images->slots[w.image_slot], w.r, clip);
      break;
    case WType::BUTTON: {
      fill_rounded(fb, w.r, w.radius, button_fill(w), w.disabled && w.stroke >= 0 ? tone_tertiary() : w.stroke, w.stroke_w, clip);
      uint8_t col = button_colour(w);
      int pad = 10;
      const char *label = tree.str(w.text);
      const char *sub = tree.str(w.sub);
      const fontlib::Font *lf = fontlib::font(w.size, w.weight);
      const fontlib::Font *sf = fontlib::font(fontlib::Size::SM, fontlib::Weight::REGULAR);
      int inner_w = w.r.w - 2 * pad;
      int sub_h = (sub && *sub) ? sf->advance_y : 0;
      // Measure the label's line count for vertical centring.
      int label_lines = 0;
      if (label && *label) {
        char buf[640];
        wrap::Line lines[8];
        label_lines = wrap::wrap(lf, label, inner_w, w.lines, buf, sizeof buf, lines, 8);
      }
      // Icon above the label: pick the largest icon size that fits the box, then shrink padding.
      icons::IconSize isz = w.icon_size;
      int icon_px = 0, gap = 0, block = 0;
      if (w.icon >= 0) {
        int order[3] = {(int)isz, (int)icons::IconSize::MD, (int)icons::IconSize::SM};
        for (int k = 0; k < 3; k++) {
          isz = (icons::IconSize)order[k];
          icon_px = icons::pixels(isz);
          gap = label_lines ? 6 : 0;
          block = icon_px + gap + label_lines * lf->advance_y;
          if (block <= w.r.h - 2 * pad - sub_h) break;
        }
        if (block > w.r.h - 2 * pad - sub_h) pad = 2;
        // Still too tall even at the smallest icon and padding: the label carries the meaning, so
        // drop the icon rather than overflow the button.
        if (block > w.r.h - 2 * pad - sub_h && label_lines) {
          icon_px = 0;
          gap = 0;
          block = label_lines * lf->advance_y;
        }
      } else {
        block = label_lines * lf->advance_y;
      }
      // A label alone that cannot fit loses its last lines rather than spilling out.
      while (label_lines > 1 && block > w.r.h - 2 * pad - sub_h) {
        label_lines--;
        block = icon_px + gap + label_lines * lf->advance_y;
      }
      int area_h = w.r.h - 2 * pad - sub_h;
      int y = w.r.y + pad + (area_h - block) / 2;
      if (y < w.r.y + pad) y = w.r.y + pad;
      if (icon_px) {
        icons::draw(fb, w.icon, isz, w.r.x + (w.r.w - icon_px) / 2, y, col, c);
        y += icon_px + gap;
      }
      if (label_lines) {
        hal::Rect lr; lr.x = (int16_t)(w.r.x + pad); lr.y = (int16_t)y; lr.w = (int16_t)inner_w; lr.h = (int16_t)(label_lines * lf->advance_y);
        draw_text_block(fb, label, lr, w.size, w.weight, Align::CENTER, VAlign::TOP, w.lines, col, c);
      }
      if (sub_h) {
        hal::Rect sr; sr.x = (int16_t)(w.r.x + pad); sr.y = (int16_t)(w.r.y + w.r.h - pad - sub_h); sr.w = (int16_t)inner_w; sr.h = (int16_t)sub_h;
        draw_text_block(fb, sub, sr, fontlib::Size::SM, fontlib::Weight::REGULAR, Align::CENTER, VAlign::TOP, 1, col, c);
      }
      break;
    }
    default: break;
  }
  if (w.pressed && !w.disabled && !c.empty()) fb.invert_rect(c);
}

hal::Rect render_region(hal::Framebuffer &fb, const WidgetTree &tree, hal::Rect region, const RenderImages *images) {
  hal::Rect full; full.w = (int16_t)fb.w; full.h = (int16_t)fb.h;
  hal::Rect clip = region.clipped(full);
  if (clip.empty()) return clip;
  fb.fill_rect(clip, 15);
  for (int i = 0; i < tree.count(); i++) {
    const Widget &w = tree[i];
    if (w.type == WType::NONE || !w.visible) continue;
    if (!w.r.intersects(clip)) continue;
    draw_widget(fb, tree, w, clip, images);
  }
  return clip;
}

hal::Rect render_full(hal::Framebuffer &fb, const WidgetTree &tree, const RenderImages *images) {
  hal::Rect full; full.w = (int16_t)fb.w; full.h = (int16_t)fb.h;
  return render_region(fb, tree, full, images);
}

}  // namespace rt
}  // namespace quire
