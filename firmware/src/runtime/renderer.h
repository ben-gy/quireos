// Draws a WidgetTree into the logical 4-bit framebuffer.
#pragma once
#include "png_decode.h"
#include "screen_parser.h"

namespace quire {
namespace rt {

struct RenderImages { const ImageBuf *slots[MAX_IMAGES] = {nullptr, nullptr}; };

// Tone table for the panel depth (design tokens): set once from the display caps.
void set_greys(int greys);
int tone_tertiary();       // 9 on 16-grey, 10 on 4-grey, 0 on 1-bit
int tone_secondary();
int tone_fill_disabled();

// Paper-fills `region` and draws every visible widget intersecting it, clipped to it. Returns the
// region actually touched (clipped to the framebuffer).
hal::Rect render_region(hal::Framebuffer &fb, const WidgetTree &tree, hal::Rect region, const RenderImages *images = nullptr);
// The whole screen.
hal::Rect render_full(hal::Framebuffer &fb, const WidgetTree &tree, const RenderImages *images = nullptr);
// One widget without clearing (used for feedback and OS overlays).
void draw_widget(hal::Framebuffer &fb, const WidgetTree &tree, const Widget &w, const hal::Rect &clip, const RenderImages *images);

// Primitives shared with the OS chrome.
void fill_rounded(hal::Framebuffer &fb, hal::Rect r, int radius, int fill, int stroke, int stroke_w, const hal::Rect &clip);
void draw_line(hal::Framebuffer &fb, int x1, int y1, int x2, int y2, int width, uint8_t color, const hal::Rect &clip);
// Lays out and draws wrapped text in `r`. Returns the number of lines drawn.
int draw_text_block(hal::Framebuffer &fb, const char *text, hal::Rect r, fontlib::Size size, fontlib::Weight weight,
                    Align align, VAlign valign, int max_lines, uint8_t color, const hal::Rect &clip);

}  // namespace rt
}  // namespace quire
