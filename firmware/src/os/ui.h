// Helpers for building the OS's own screens as widget trees (one renderer for everything).
#pragma once
#include <stdint.h>
#include <string>
#include <vector>
#include "../runtime/screen_parser.h"
#include "../runtime/tz.h"
#include "prefs.h"
#include "store_client.h"

namespace quire {
namespace os {
namespace ui {

enum Action : uint16_t {
  A_NONE = 0, A_OPEN_APP, A_OPEN_STORE, A_OPEN_SETTINGS, A_HOME, A_BACK, A_PAGE,
  A_STORE_DETAIL, A_STORE_INSTALL, A_STORE_UNINSTALL, A_STORE_UPDATE, A_STORE_PAIR, A_STORE_PAIR_CANCEL, A_STORE_REFRESH,
  A_FRONTLIGHT_DELTA, A_SLEEP_DELTA, A_REFRESH_POLICY_DELTA, A_TZ_DELTA, A_WIFI_FORGET, A_REBOOT, A_CHECK_UPDATES,
  A_RETRY, A_APP_HOME, A_FULL_REDRAW, A_SETUP_DONE,
};

struct Chrome {
  int w = 540, h = 960;
  int64_t epoch = 0;
  const tz::Zone *zone = nullptr;
  int battery = -1;
  bool charging = false, online = true;
  int rssi = 0;
  std::string ip;
};

using rt::Align;
using rt::VAlign;
using fontlib::Size;
using fontlib::Weight;

rt::Widget *add_text(rt::WidgetTree &t, int x, int y, int w, int h, const char *text, Size size = Size::MD,
                     Weight weight = Weight::REGULAR, Align align = Align::LEFT, VAlign valign = VAlign::TOP,
                     int color = 0, int lines = 1);
rt::Widget *add_rect(rt::WidgetTree &t, int x, int y, int w, int h, int fill, int stroke, int stroke_w = 2, int radius = 0);
rt::Widget *add_line(rt::WidgetTree &t, int x1, int y1, int x2, int y2, int color = 0, int width = 1);
rt::Widget *add_icon(rt::WidgetTree &t, int x, int y, const char *name, icons::IconSize size = icons::IconSize::MD, int color = 0);
rt::Widget *add_button(rt::WidgetTree &t, int x, int y, int w, int h, const char *label, Action action, int arg = 0,
                       const char *icon = nullptr, const char *sub = nullptr, int fill = 15, int stroke = 0,
                       Size size = Size::MD, int radius = 8);
// Status bar (clock, wifi, battery; not tappable) and nav bar (back/home button + title). Both
// return the y below them; heights come from the profile tokens (44 / 56 px on t5pro).
int status_bar(rt::WidgetTree &t, const Chrome &c, const char *title, bool home_button);
int nav_bar(rt::WidgetTree &t, const Chrome &c, const char *title, Action back_action, const char *back_label = nullptr);
const char *wifi_icon(const Chrome &c);
const char *battery_icon(const Chrome &c);
std::string format_time(const Chrome &c, const char *fmt);
std::string version_string();

// Screens. Each clears and rebuilds `t`.
void build_launcher(rt::WidgetTree &t, const Chrome &c, const std::vector<prefs::AppRecord> &apps, int page, int &page_count);
void build_setup(rt::WidgetTree &t, const Chrome &c, bool wifi_capable);

enum class StorePage : uint8_t { LIST = 0, DETAIL, PAIRING };
struct StoreView { StorePage page = StorePage::LIST; int list_page = 0; int detail_index = -1; };
void build_store(rt::WidgetTree &t, const Chrome &c, const StoreView &v, int &page_count);

void build_settings(rt::WidgetTree &t, const Chrome &c);
const char *tz_option(int index);       // cycling list for the time zone setting
int tz_option_count();
int tz_option_index(const std::string &name);

enum class ErrorKind : uint8_t { APP_ERROR, NEEDS_SETUP, UPDATE_OS, OFFLINE };
void build_error(rt::WidgetTree &t, const Chrome &c, ErrorKind kind, const char *app_name, const char *message,
                 const std::vector<std::string> &missing);

}  // namespace ui
}  // namespace os
}  // namespace quire
