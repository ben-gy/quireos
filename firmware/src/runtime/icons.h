// Built-in icon set (Material Design Icons rasterised by tools/gen_icons.py).
#pragma once
#include <stdint.h>
#include "../hal/hal.h"

namespace quire {
namespace icons {

enum class IconSize : uint8_t { SM = 0, MD = 1, LG = 2 };

int count();
int index_of(const char *name);                 // -1 when unknown
const char *name(int index);
bool size_from_name(const char *name, IconSize &out);
uint16_t pixels(IconSize s);                    // 32 / 48 / 96 on t5pro
bool has_size(int index, IconSize s);           // lg exists only for the design library's display subset
// Draw icon `index` with its top-left at (x, y) in `color`, clipped. Coverage is blended. When the
// icon has no bitmap at `s` (no lg for non-display icons) the md bitmap is drawn centred in the box.
void draw(hal::Framebuffer &fb, int index, IconSize s, int x, int y, uint8_t color, const hal::Rect &clip);

}  // namespace icons
}  // namespace quire
