// Built-in full-screen states: app error (Retry / Home), Needs setup, Update QuireOS, offline.
#include <stdio.h>
#include "../hal/hal.h"
#include "../runtime/profile_gen.h"
#include "ui.h"

namespace quire {
namespace os {
namespace ui {

void build_error(rt::WidgetTree &t, const Chrome &c, ErrorKind kind, const char *app_name, const char *message,
                 const std::vector<std::string> &missing) {
  t.clear();
  const int pad = profile::MARGIN + 8;
  int y = nav_bar(t, c, app_name && *app_name ? app_name : "QuireOS", A_HOME);
  y += c.h / 10;
  const char *icon = "alert-circle-outline";
  const char *title = "Something went wrong";
  switch (kind) {
    case ErrorKind::NEEDS_SETUP: icon = "cog-outline"; title = "Needs setup"; break;
    case ErrorKind::UPDATE_OS: icon = "update"; title = "Update QuireOS"; break;
    case ErrorKind::OFFLINE: icon = "wifi-off"; title = "Offline"; break;
    default: break;
  }
  add_icon(t, c.w / 2 - icons::pixels(icons::IconSize::LG) / 2, y, icon, icons::IconSize::LG);
  y += 112;
  add_text(t, pad, y, c.w - 2 * pad, 44, title, Size::LG, Weight::BOLD, Align::CENTER);
  y += 56;
  if (kind == ErrorKind::NEEDS_SETUP) {
    std::string msg = "Open the settings page and fill in:";
    add_text(t, pad, y, c.w - 2 * pad, 36, msg.c_str(), Size::MD, Weight::REGULAR, Align::CENTER);
    y += 44;
    for (size_t i = 0; i < missing.size() && i < 6; i++) {
      add_text(t, pad, y, c.w - 2 * pad, 36, ("• " + missing[i]).c_str(), Size::MD, Weight::BOLD, Align::CENTER);
      y += 38;
    }
    y += 12;
    std::string lan = c.ip.empty() ? "Connect to Wi-Fi first" : "http://" + c.ip + "/os";
    add_text(t, pad, y, c.w - 2 * pad, 36, lan.c_str(), Size::MD, Weight::BOLD, Align::CENTER);
    y += 60;
  } else {
    add_text(t, pad, y, c.w - 2 * pad, 36 * 4, message && *message ? message : "Unknown error", Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 4);
    y += 36 * 4 + 24;
  }
  int bw = (c.w - 2 * pad - 16) / 2;
  if (kind == ErrorKind::APP_ERROR || kind == ErrorKind::OFFLINE) {
    add_button(t, pad, y, bw, 60, "Retry", A_RETRY);
    add_button(t, pad + bw + 16, y, bw, 60, "Home", A_HOME);
  } else {
    add_button(t, c.w / 2 - bw / 2, y, bw, 60, "Home", A_HOME);
  }
}

}  // namespace ui
}  // namespace os
}  // namespace quire
