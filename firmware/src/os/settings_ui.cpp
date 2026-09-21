// Settings: Wi-Fi, frontlight, sleep, refresh policy, time zone, about, LAN page URL.
#include <stdio.h>
#include "../hal/hal.h"
#include "../runtime/profile_gen.h"
#include "os.h"
#include "ui.h"

namespace quire {
namespace os {
namespace ui {

static const char *const TZ_OPTIONS[] = {
  "Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Pacific/Auckland",
  "Asia/Tokyo", "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Athens", "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
};
const char *tz_option(int i) { int n = tz_option_count(); if (n == 0) return "UTC"; i = ((i % n) + n) % n; return TZ_OPTIONS[i]; }
int tz_option_count() { return (int)(sizeof TZ_OPTIONS / sizeof TZ_OPTIONS[0]); }
int tz_option_index(const std::string &name) {
  for (int i = 0; i < tz_option_count(); i++) if (name == TZ_OPTIONS[i]) return i;
  return -1;
}

namespace {
int row(rt::WidgetTree &t, const Chrome &c, int y, const char *label, const std::string &value, Action minus, Action plus, int arg = 1) {
  const int pad = profile::MARGIN, h = 64;
  add_text(t, pad, y, c.w / 2 - pad, h, label, Size::MD, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  int bx = c.w - pad - 56;
  if (plus != A_NONE) { add_button(t, bx, y + 8, 56, 48, "+", plus, arg, nullptr, nullptr, 15, 0, Size::MD); bx -= 64; }
  if (minus != A_NONE) { add_button(t, bx, y + 8, 56, 48, "-", minus, -arg, nullptr, nullptr, 15, 0, Size::MD); bx -= 64; }
  add_text(t, c.w / 2 - 20, y, bx + 56 - (c.w / 2 - 20) - 8, h, value.c_str(), Size::SM, Weight::REGULAR, Align::RIGHT, VAlign::MIDDLE, 0, 2);
  add_line(t, pad, y + h, c.w - pad, y + h, 10, 1);
  return y + h + 6;
}
}  // namespace

void build_settings(rt::WidgetTree &t, const Chrome &c) {
  t.clear();
  const int pad = profile::MARGIN;
  int y = nav_bar(t, c, "Settings", A_HOME) + 8;
  hal::Board &b = hal::board();
  // Wi-Fi
  std::string wifi;
  if (b.net) {
    if (b.net->connected()) { char rs[16]; snprintf(rs, sizeof rs, " (%d dBm)", b.net->rssi()); wifi = std::string(b.net->ssid() ? b.net->ssid() : "") + rs + "\n" + (b.net->ip() ? b.net->ip() : ""); }
    else wifi = b.net->has_credentials() ? "Not connected" : "Not configured";
  } else wifi = "No network";
  add_text(t, pad, y, c.w / 2, 64, "Wi-Fi", Size::MD, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  add_text(t, c.w / 2 - 20, y + 4, c.w / 2 - 20 - 110, 58, wifi.c_str(), Size::XS, Weight::REGULAR, Align::RIGHT, VAlign::MIDDLE, 0, 2);
  add_button(t, c.w - pad - 100, y + 8, 100, 48, "Forget", A_WIFI_FORGET, 0, nullptr, nullptr, 15, 0, Size::SM);
  add_line(t, pad, y + 64, c.w - pad, y + 64, 10, 1);
  y += 70;
  if (b.power && b.power->caps().frontlight) {
    static const char *L[] = {"Off", "Low", "Medium", "High"};
    y = row(t, c, y, "Frontlight", L[prefs::frontlight() & 3], A_FRONTLIGHT_DELTA, A_FRONTLIGHT_DELTA);
  }
  int s = prefs::sleep_timeout_s();
  std::string sleep = s == 0 ? "Never" : s < 60 ? std::to_string(s) + " s" : std::to_string(s / 60) + " min";
  y = row(t, c, y, "Sleep after", sleep, A_SLEEP_DELTA, A_SLEEP_DELTA);
  static const char *R[] = {"Auto", "Prefer partial", "Always full"};
  y = row(t, c, y, "Refresh", R[prefs::refresh_policy() % 3], A_REFRESH_POLICY_DELTA, A_REFRESH_POLICY_DELTA);
  y = row(t, c, y, "Time zone", prefs::tz(), A_TZ_DELTA, A_TZ_DELTA);
  // About
  char screen[32];
  hal::screen_string(screen, sizeof screen);
  std::string about = version_string() + " · " + b.profile + "\n" + hal::device_hw_id() + " · " + screen;
  add_text(t, pad, y, c.w / 2, 64, "About", Size::MD, Weight::BOLD, Align::LEFT, VAlign::MIDDLE);
  add_text(t, c.w / 2 - 40, y + 4, c.w / 2 + 40 - pad, 58, about.c_str(), Size::XS, Weight::REGULAR, Align::RIGHT, VAlign::MIDDLE, 0, 2);
  add_line(t, pad, y + 64, c.w - pad, y + 64, 10, 1);
  y += 70;
  if (b.power) {
    char mem[64];
    snprintf(mem, sizeof mem, "%u kB heap · %u kB PSRAM free", (unsigned)(b.power->free_heap() / 1024), (unsigned)(b.power->free_psram() / 1024));
    add_text(t, pad, y, c.w - 2 * pad, 29, mem, Size::XS, Weight::REGULAR, Align::LEFT, VAlign::MIDDLE, 6);
    y += 34;
  }
  // LAN page
  std::string lan = c.ip.empty() ? "Connect to Wi-Fi to use the settings page" : "Settings page: http://" + c.ip + "/os";
  add_text(t, pad, y, c.w - 2 * pad, 36 * 2, lan.c_str(), Size::SM, Weight::BOLD, Align::LEFT, VAlign::TOP, 0, 2);
  y += 72;
  std::string store_line = "Store: " + prefs::store_url() + (prefs::paired_user().empty() ? "" : " · paired as " + prefs::paired_user());
  add_text(t, pad, y, c.w - 2 * pad, 24 * 2, store_line.c_str(), Size::XS, Weight::REGULAR, Align::LEFT, VAlign::TOP, 6, 2);
  y += 56;
  // Buttons
  int by = c.h - 150;
  int bw = (c.w - 2 * pad - 32) / 3;
  add_button(t, pad, by, bw, 56, "Updates", A_CHECK_UPDATES, 0, nullptr, nullptr, 15, 0, Size::SM);
  add_button(t, pad + bw + 16, by, bw, 56, "Redraw", A_FULL_REDRAW, 0, nullptr, nullptr, 15, 0, Size::SM);
  add_button(t, pad + 2 * (bw + 16), by, bw, 56, "Reboot", A_REBOOT, 0, nullptr, nullptr, 15, 0, Size::SM);
  const std::string &st = store::status();
  if (!st.empty()) add_text(t, pad, by + 66, c.w - 2 * pad, 29, st.c_str(), Size::SM, Weight::REGULAR, Align::CENTER, VAlign::TOP, 4);
}

}  // namespace ui
}  // namespace os
}  // namespace quire
