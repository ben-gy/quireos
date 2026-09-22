// The launcher: clock, status and a grid of installed apps plus Store and Settings tiles.
#include <stdio.h>
#include "../hal/hal.h"
#include "../runtime/profile_gen.h"
#include "ui.h"

namespace quire {
namespace os {
namespace ui {

void build_launcher(rt::WidgetTree &t, const Chrome &c, const std::vector<prefs::AppRecord> &apps, int page, int &page_count) {
  t.clear();
  const int pad = profile::MARGIN;
  int y = status_bar(t, c, "QuireOS", false) + 8;
  bool portrait = c.h > c.w;
  // Clock block.
  if (c.epoch > 0) {
    std::string tm = format_time(c, "H:mm");
    std::string date = format_time(c, "EEEE d MMMM");
    int clock_h = portrait ? 96 : 72;
    add_text(t, pad, y + 4, c.w - 2 * pad, clock_h, tm.c_str(), portrait ? Size::XXXL : Size::XXL, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
    add_text(t, pad, y + clock_h + 8, c.w - 2 * pad, 29, date.c_str(), Size::SM, Weight::REGULAR);
    y += clock_h + 8 + 29 + 16;
  }
  add_line(t, pad, y, c.w - pad, y, 0, 1);
  y += 16;
  // Tiles.
  const int gap = 16;
  int cols = (c.w - 2 * pad + gap) / (238 + gap);
  if (cols < 2) cols = 2;
  int tile_w = (c.w - 2 * pad - gap * (cols - 1)) / cols;
  int tile_h = portrait ? 172 : 150;
  int foot = 60;
  int rows = (c.h - y - foot + gap) / (tile_h + gap);
  if (rows < 1) rows = 1;
  int per_page = cols * rows;
  int total = (int)apps.size() + 2;
  page_count = (total + per_page - 1) / per_page;
  if (page >= page_count) page = page_count - 1;
  if (page < 0) page = 0;
  int first = page * per_page;
  for (int i = 0; i < per_page; i++) {
    int idx = first + i;
    if (idx >= total) break;
    int col = i % cols, row = i / cols;
    int x = pad + col * (tile_w + gap), ty = y + row * (tile_h + gap);
    if (idx < (int)apps.size()) {
      const prefs::AppRecord &a = apps[(size_t)idx];
      const char *icon = icons::index_of(a.icon.c_str()) >= 0 ? a.icon.c_str() : "apps";
      std::string sub = a.update_version.empty() ? "" : "Update " + a.update_version;
      add_button(t, x, ty, tile_w, tile_h, a.name.c_str(), A_OPEN_APP, idx, icon, sub.empty() ? nullptr : sub.c_str(), 15, 0, Size::MD, profile::RADIUS_LG);
    } else if (idx == (int)apps.size()) {
      add_button(t, x, ty, tile_w, tile_h, "Store", A_OPEN_STORE, 0, "apps", nullptr, 0, 0, Size::MD, profile::RADIUS_LG);
    } else {
      add_button(t, x, ty, tile_w, tile_h, "Settings", A_OPEN_SETTINGS, 0, "cog-outline", nullptr, 15, 0, Size::MD, profile::RADIUS_LG);
    }
  }
  // Footer: paging and hint.
  int fy = c.h - foot + 8;
  if (page_count > 1) {
    add_button(t, pad, fy, 100, 44, "Prev", A_PAGE, -1, nullptr, nullptr, 15, 0, Size::SM);
    add_button(t, c.w - pad - 100, fy, 100, 44, "Next", A_PAGE, 1, nullptr, nullptr, 15, 0, Size::SM);
    char b[24];
    snprintf(b, sizeof b, "%d / %d", page + 1, page_count);
    add_text(t, pad + 110, fy, c.w - 2 * pad - 220, 44, b, Size::SM, Weight::REGULAR, Align::CENTER, VAlign::MIDDLE);
  } else if (!c.ip.empty()) {
    std::string hint = "Settings page: http://" + c.ip + "/os";
    add_text(t, pad, fy, c.w - 2 * pad, 44, hint.c_str(), Size::XS, Weight::REGULAR, Align::CENTER, VAlign::MIDDLE, 6);
  }
}

void build_setup(rt::WidgetTree &t, const Chrome &c, bool wifi_capable) {
  t.clear();
  const int pad = 32;
  int y = c.h / 5;
  add_icon(t, c.w / 2 - icons::pixels(icons::IconSize::LG) / 2, y, "wifi-strength-4", icons::IconSize::LG);
  y += 120;
  add_text(t, pad, y, c.w - 2 * pad, 56, "Welcome to QuireOS", Size::XL, Weight::BOLD, Align::CENTER);
  y += 80;
  if (wifi_capable) {
    add_text(t, pad, y, c.w - 2 * pad, 36 * 4, "Connect your phone or laptop to the Wi-Fi network \"QuireOS-Setup\" and follow the page that opens to choose your network.",
             Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 4);
    y += 36 * 4 + 24;
    add_text(t, pad, y, c.w - 2 * pad, 29 * 2, "The device will restart when Wi-Fi is configured.", Size::SM, Weight::REGULAR, Align::CENTER, VAlign::TOP, 6, 2);
  } else {
    add_text(t, pad, y, c.w - 2 * pad, 36 * 3, "This board has no Wi-Fi provisioning; the network is configured by the host.", Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 3);
    y += 36 * 3 + 24;
    add_button(t, c.w / 2 - 100, y, 200, 56, "Continue", A_SETUP_DONE);
  }
}

}  // namespace ui
}  // namespace os
}  // namespace quire
