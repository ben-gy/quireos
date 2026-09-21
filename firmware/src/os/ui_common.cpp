#include <stdio.h>
#include <string.h>
#include "../hal/hal.h"
#include "../runtime/expr.h"
#include "../runtime/profile_gen.h"
#include "os.h"
#include "ui.h"

namespace quire {
namespace os {
namespace ui {

rt::Widget *add_text(rt::WidgetTree &t, int x, int y, int w, int h, const char *text, Size size, Weight weight,
                     Align align, VAlign valign, int color, int lines) {
  rt::Widget *wd = t.add();
  if (!wd) return nullptr;
  wd->type = rt::WType::TEXT;
  wd->r.x = (int16_t)x; wd->r.y = (int16_t)y; wd->r.w = (int16_t)w;
  wd->r.h = (int16_t)(h > 0 ? h : fontlib::font(size, weight)->advance_y * lines);
  wd->text = t.add_str(text);
  wd->size = size; wd->weight = weight; wd->align = align; wd->valign = valign;
  wd->color = (int8_t)color; wd->lines = (uint8_t)(lines < 1 ? 1 : lines > 8 ? 8 : lines);
  return wd;
}

rt::Widget *add_rect(rt::WidgetTree &t, int x, int y, int w, int h, int fill, int stroke, int stroke_w, int radius) {
  rt::Widget *wd = t.add();
  if (!wd) return nullptr;
  wd->type = rt::WType::RECT;
  wd->r.x = (int16_t)x; wd->r.y = (int16_t)y; wd->r.w = (int16_t)w; wd->r.h = (int16_t)h;
  wd->fill = (int8_t)fill; wd->stroke = (int8_t)stroke; wd->stroke_w = (uint8_t)stroke_w; wd->radius = (uint8_t)radius;
  return wd;
}

rt::Widget *add_line(rt::WidgetTree &t, int x1, int y1, int x2, int y2, int color, int width) {
  rt::Widget *wd = t.add();
  if (!wd) return nullptr;
  wd->type = rt::WType::LINE;
  wd->x1 = (int16_t)x1; wd->y1 = (int16_t)y1; wd->x2 = (int16_t)x2; wd->y2 = (int16_t)y2;
  wd->color = (int8_t)color; wd->line_w = (uint8_t)width;
  int minx = x1 < x2 ? x1 : x2, miny = y1 < y2 ? y1 : y2, maxx = x1 > x2 ? x1 : x2, maxy = y1 > y2 ? y1 : y2;
  wd->r.x = (int16_t)(minx - width); wd->r.y = (int16_t)(miny - width);
  wd->r.w = (int16_t)(maxx - minx + 2 * width + 1); wd->r.h = (int16_t)(maxy - miny + 2 * width + 1);
  return wd;
}

rt::Widget *add_icon(rt::WidgetTree &t, int x, int y, const char *name, icons::IconSize size, int color) {
  rt::Widget *wd = t.add();
  if (!wd) return nullptr;
  wd->type = rt::WType::ICON;
  int px = icons::pixels(size);
  wd->r.x = (int16_t)x; wd->r.y = (int16_t)y; wd->r.w = (int16_t)px; wd->r.h = (int16_t)px;
  wd->icon = (int16_t)icons::index_of(name); wd->icon_size = size; wd->color = (int8_t)color;
  return wd;
}

rt::Widget *add_button(rt::WidgetTree &t, int x, int y, int w, int h, const char *label, Action action, int arg,
                       const char *icon, const char *sub, int fill, int stroke, Size size, int radius) {
  rt::Widget *wd = t.add();
  if (!wd) return nullptr;
  wd->type = rt::WType::BUTTON;
  wd->r.x = (int16_t)x; wd->r.y = (int16_t)y; wd->r.w = (int16_t)w; wd->r.h = (int16_t)h;
  wd->text = t.add_str(label);
  if (sub) wd->sub = t.add_str(sub);
  if (icon) { wd->icon = (int16_t)icons::index_of(icon); wd->icon_size = h >= 150 ? icons::IconSize::LG : icons::IconSize::MD; }
  wd->fill = (int8_t)fill; wd->stroke = (int8_t)stroke; wd->stroke_w = 2; wd->radius = (uint8_t)radius;
  wd->size = size; wd->weight = Weight::BOLD; wd->lines = 2; wd->align = Align::CENTER;
  wd->feedback = action == A_NONE ? rt::Feedback::NONE : rt::Feedback::INVERT;
  wd->os_action = action; wd->os_arg = (int16_t)arg;
  return wd;
}

std::string format_time(const Chrome &c, const char *fmt) {
  static tz::Zone utc;
  return expr::format_time(c.zone ? *c.zone : utc, c.epoch, fmt);
}

std::string version_string() { return std::string("QuireOS ") + hal::board().os_version; }

const char *wifi_icon(const Chrome &c) {
  if (!c.online) return "wifi-off";
  if (c.rssi >= -60) return "wifi-strength-4";
  if (c.rssi >= -70) return "wifi-strength-3";
  if (c.rssi >= -80) return "wifi-strength-2";
  return "wifi-strength-1";
}

const char *battery_icon(const Chrome &c) {
  if (c.charging) return "battery-charging";
  if (c.battery < 15) return "battery-alert-variant-outline";
  if (c.battery < 25) return "battery-10";
  if (c.battery < 45) return "battery-30";
  if (c.battery < 65) return "battery-50";
  if (c.battery < 85) return "battery-70";
  if (c.battery < 97) return "battery-90";
  return "battery";
}

// Status bar (profile chrome.status, 44 px on t5pro): clock left, wifi and battery right. Not tappable.
int status_bar(rt::WidgetTree &t, const Chrome &c, const char *title, bool home_button) {
  (void)home_button;
  const int H = profile::STATUS, pad = profile::MARGIN, ic = profile::ICON_SM;
  int iy = (H - ic) / 2;
  if (c.epoch > 0) {
    std::string tm = format_time(c, "HH:mm");
    add_text(t, pad, 0, 160, H, tm.c_str(), Size::SM, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  } else if (title && *title) {
    add_text(t, pad, 0, c.w / 2, H, title, Size::SM, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  }
  int rx = c.w - pad;
  if (c.battery >= 0) {
    char b[8];
    snprintf(b, sizeof b, "%d%%", c.battery);
    add_text(t, rx - 60, 0, 60, H, b, Size::SM, Weight::REGULAR, Align::RIGHT, VAlign::MIDDLE);
    rx -= 64;
    add_icon(t, rx - ic, iy, battery_icon(c), icons::IconSize::SM);
    rx -= ic + 8;
  }
  add_icon(t, rx - ic, iy, wifi_icon(c), icons::IconSize::SM);
  add_line(t, pad, H - 1, c.w - pad, H - 1, profile::TONE_HAIRLINE, profile::STROKE_HAIRLINE);
  return H;
}

// Nav bar (profile chrome.nav, 56 px on t5pro): a back/home button and the title.
int nav_bar(rt::WidgetTree &t, const Chrome &c, const char *title, Action back_action, const char *back_label) {
  const int H = profile::NAV, pad = profile::MARGIN;
  int x = pad;
  if (back_action != A_NONE) {
    add_button(t, pad, (H - 44) / 2, 96, 44, back_label ? back_label : "Home", back_action, 0, nullptr, nullptr, 15, 0, Size::SM);
    x = pad + 108;
  }
  add_text(t, x, 0, c.w - x - pad, H, title, Size::MD, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  add_line(t, pad, H - 1, c.w - pad, H - 1, profile::TONE_INK, profile::STROKE_FRAME);
  return H;
}

}  // namespace ui
}  // namespace os
}  // namespace quire
