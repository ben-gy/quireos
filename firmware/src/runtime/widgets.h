// The widget tree: a flat, fixed-capacity array of absolutely positioned widgets in draw order.
// Both parsed app screens and the OS's own screens (launcher, store, settings) are widget trees, so
// there is exactly one renderer and one hit-tester.
#pragma once
#include <stdint.h>
#include <string.h>
#include "../hal/hal.h"
#include "fontlib.h"
#include "icons.h"
#include "third_party/ArduinoJson.h"
#include "expr.h"

namespace quire {
namespace rt {

enum class WType : uint8_t { NONE = 0, TEXT, RECT, LINE, ICON, IMAGE, BUTTON };
enum class Align : uint8_t { LEFT = 0, CENTER, RIGHT };
enum class VAlign : uint8_t { TOP = 0, MIDDLE, BOTTOM };
enum class Feedback : uint8_t { NONE = 0, INVERT };

// String reference into the tree's arenas. Bit 31 selects the dynamic arena (re-evaluated on every
// rebind); 0 is the empty string.
typedef uint32_t StrRef;
static const StrRef DYN_BIT = 0x80000000u;

struct Widget {
  WType type = WType::NONE;
  hal::Rect r;
  StrRef id = 0;
  // Evaluated visual state.
  StrRef text = 0;              // text widget text or button label
  StrRef sub = 0;               // button sub line
  StrRef src = 0;               // image URL after templates
  int16_t icon = -1;            // icon index, -1 = none/unknown
  int8_t image_slot = -1;       // 0..1
  int8_t fill = -1;             // -1 = null
  int8_t stroke = -1;           // -1 = null
  int8_t color = -1;            // -1 = auto-contrast (button) / default
  uint8_t stroke_w = 2, radius = 0, line_w = 1;
  fontlib::Size size = fontlib::Size::MD;
  fontlib::Weight weight = fontlib::Weight::REGULAR;
  Align align = Align::LEFT;
  VAlign valign = VAlign::TOP;
  uint8_t lines = 1;
  icons::IconSize icon_size = icons::IconSize::MD;
  int16_t x1 = 0, y1 = 0, x2 = 0, y2 = 0;   // line
  Feedback feedback = Feedback::NONE;
  bool visible = true;          // after `when`
  bool disabled = false;        // after `disabled`: dimmed, not hit-tested, no feedback
  bool pressed = false;         // inverted until the next full render
  int16_t json_index = -1;      // position in the document's widget list, for "#<index>"
  // Dynamic sources for parsed screens (null for OS-built trees).
  JsonVariantConst src_when, src_disabled, src_text, src_sub, src_src, src_fill, src_stroke, src_color, src_icon;
  JsonVariantConst on_tap, on_hold;
  // OS-built trees dispatch on these instead of on_tap.
  uint16_t os_action = 0;
  int16_t os_arg = 0;
  uint64_t hash = 0;            // FNV-1a of the evaluated state after the last rebind

  bool has_action() const { return os_action != 0 || !on_tap.isNull() || !on_hold.isNull(); }
};

class WidgetTree {
 public:
  static const int CAP = 96;
  static const size_t STATIC_ARENA = 12 * 1024;
  static const size_t DYN_ARENA = 48 * 1024;

  WidgetTree() {}
  ~WidgetTree() { release(); }
  WidgetTree(const WidgetTree &) = delete;
  WidgetTree &operator=(const WidgetTree &) = delete;

  bool init() {
    if (w_) return true;
    w_ = (Widget *)hal::alloc_big(sizeof(Widget) * CAP);
    sarena_ = (char *)hal::alloc_big(STATIC_ARENA);
    darena_ = (char *)hal::alloc_big(DYN_ARENA);
    if (!w_ || !sarena_ || !darena_) { release(); return false; }
    clear();
    return true;
  }
  void release() {
    if (w_) { for (int i = 0; i < n_; i++) w_[i].~Widget(); hal::free_big(w_); w_ = nullptr; }
    if (sarena_) { hal::free_big(sarena_); sarena_ = nullptr; }
    if (darena_) { hal::free_big(darena_); darena_ = nullptr; }
    n_ = 0;
  }
  void clear() {
    for (int i = 0; i < n_; i++) w_[i].~Widget();
    n_ = 0;
    sused_ = 1; dused_ = 1;
    if (sarena_) sarena_[0] = 0;
    if (darena_) darena_[0] = 0;
  }
  bool valid() const { return w_ != nullptr; }
  int count() const { return n_; }
  Widget &operator[](int i) { return w_[i]; }
  const Widget &operator[](int i) const { return w_[i]; }
  Widget *add() {
    if (!w_ || n_ >= CAP) return nullptr;
    Widget *w = new (&w_[n_]) Widget();
    n_++;
    return w;
  }
  StrRef add_str(const char *s, size_t len) { return put(sarena_, STATIC_ARENA, sused_, s, len, 0); }
  StrRef add_str(const char *s) { return s ? add_str(s, strlen(s)) : 0; }
  void reset_dyn() { dused_ = 1; }
  StrRef add_dyn(const char *s, size_t len) { return put(darena_, DYN_ARENA, dused_, s, len, DYN_BIT); }
  const char *str(StrRef r) const {
    if (r & DYN_BIT) return darena_ ? darena_ + (r & ~DYN_BIT) : "";
    return sarena_ ? sarena_ + r : "";
  }
  // Topmost visible widget with an action containing (x, y), or -1.
  int hit_test(int x, int y) const {
    for (int i = n_ - 1; i >= 0; i--) {
      const Widget &w = w_[i];
      if (w.type == WType::NONE || !w.visible || w.disabled || !w.has_action()) continue;
      if (w.r.contains(x, y)) return i;
    }
    return -1;
  }
  int find_id(const char *id) const {
    if (!id) return -1;
    for (int i = 0; i < n_; i++) if (w_[i].id && strcmp(str(w_[i].id), id) == 0) return i;
    return -1;
  }

 private:
  StrRef put(char *arena, size_t cap, size_t &used, const char *s, size_t len, StrRef flag) {
    if (!arena || !s) return 0;
    if (len == 0) return 0;
    if (used + len + 1 > cap) {
      hal::log(hal::LOG_WARN, "tree", "string arena full, truncating");
      if (used + 1 >= cap) return 0;
      len = cap - used - 1;
    }
    memcpy(arena + used, s, len);
    arena[used + len] = 0;
    StrRef r = (StrRef)used | flag;
    used += len + 1;
    return r;
  }
  Widget *w_ = nullptr;
  int n_ = 0;
  char *sarena_ = nullptr, *darena_ = nullptr;
  size_t sused_ = 1, dused_ = 1;
};

}  // namespace rt
}  // namespace quire
