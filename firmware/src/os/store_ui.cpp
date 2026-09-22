// Store screens: paged list from the store index, app detail with Install/Uninstall/Update, pairing.
#include <stdio.h>
#include "../hal/hal.h"
#include "../runtime/profile_gen.h"
#include "ui.h"

namespace quire {
namespace os {
namespace ui {

namespace {

void build_list(rt::WidgetTree &t, const Chrome &c, int page, int &page_count) {
  const int pad = profile::MARGIN;
  int y = nav_bar(t, c, "Store", A_HOME) + 12;
  page_count = 1;
  const int foot = 64;
  if (!store::index_loaded()) {
    const std::string &err = store::index_error();
    if (!err.empty()) {
      add_icon(t, c.w / 2 - icons::pixels(icons::IconSize::MD) / 2, y + 40, "cloud-off-outline", icons::IconSize::MD);
      add_text(t, pad, y + 100, c.w - 2 * pad, 72, err.c_str(), Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 2);
      add_button(t, c.w / 2 - 80, y + 190, 160, 52, "Retry", A_STORE_REFRESH);
    } else {
      add_text(t, pad, y + 60, c.w - 2 * pad, 44, store::busy() == store::Busy::INDEX ? "Loading the store…" : "Store not loaded",
               Size::LG, Weight::REGULAR, Align::CENTER);
      if (store::busy() != store::Busy::INDEX) add_button(t, c.w / 2 - 80, y + 130, 160, 52, "Load", A_STORE_REFRESH);
    }
  } else {
    const rt::StoreIndex &idx = store::index();
    const int row_h = 100, gap = 10;
    int rows = (c.h - y - foot) / (row_h + gap);
    if (rows < 1) rows = 1;
    int total = (int)idx.apps.size();
    page_count = total ? (total + rows - 1) / rows : 1;
    if (page >= page_count) page = page_count - 1;
    if (page < 0) page = 0;
    if (total == 0) add_text(t, pad, y + 40, c.w - 2 * pad, 44, "No apps listed yet", Size::LG, Weight::REGULAR, Align::CENTER);
    for (int i = 0; i < rows; i++) {
      int ai = page * rows + i;
      if (ai >= total) break;
      const rt::StoreApp &a = idx.apps[(size_t)ai];
      int ry = y + i * (row_h + gap);
      rt::Widget *row = add_button(t, pad, ry, c.w - 2 * pad, row_h, "", A_STORE_DETAIL, ai, nullptr, nullptr, 15, 8, Size::MD, 10);
      if (row) row->feedback = rt::Feedback::INVERT;
      const char *icon = icons::index_of(a.icon.c_str()) >= 0 ? a.icon.c_str() : "apps";
      add_icon(t, pad + 14, ry + (row_h - icons::pixels(icons::IconSize::MD)) / 2, icon, icons::IconSize::MD);
      int tx = pad + 76;
      int tw = c.w - 2 * pad - 76 - 130;
      add_text(t, tx, ry + 12, tw, 36, a.name.c_str(), Size::MD, Weight::BOLD);
      add_text(t, tx, ry + 50, tw, 29, a.tagline.c_str(), Size::SM, Weight::REGULAR, Align::LEFT, VAlign::TOP, 4);
      std::string badge;
      prefs::AppRecord rec;
      std::string uv;
      if (store::update_available(a.id, uv)) badge = "Update";
      else if (store::is_installed(a.id, &rec)) badge = "Installed";
      else if (!store::min_os_ok(a.min_os)) badge = "Needs " + a.min_os;
      else badge = a.version;
      add_text(t, c.w - pad - 130, ry + 12, 118, row_h - 24, badge.c_str(), Size::SM, Weight::BOLD, Align::RIGHT, VAlign::MIDDLE, 0, 2);
    }
  }
  int fy = c.h - foot + 8;
  rt::Widget *prev = add_button(t, pad, fy, 96, 44, "Prev", A_PAGE, -1, nullptr, nullptr, 15, 0, Size::SM);
  if (prev) prev->disabled = page <= 0;
  rt::Widget *next = add_button(t, pad + 104, fy, 96, 44, "Next", A_PAGE, 1, nullptr, nullptr, 15, 0, Size::SM);
  if (next) next->disabled = page + 1 >= page_count;
  add_button(t, c.w - pad - 96, fy, 96, 44, "Reload", A_STORE_REFRESH, 0, nullptr, nullptr, 15, 0, Size::SM);
  std::string paired = prefs::paired_user();
  rt::Widget *pair = add_button(t, c.w - pad - 96 - 8 - 130, fy, 130, 44, paired.empty() ? "Pair" : "Paired", A_STORE_PAIR, 0, nullptr, nullptr, 15, 0, Size::SM);
  if (pair) pair->disabled = !paired.empty();
}

void build_detail(rt::WidgetTree &t, const Chrome &c, int index) {
  const int pad = profile::MARGIN;
  int y = nav_bar(t, c, "Store", A_BACK, "Back") + 16;
  const rt::StoreIndex &idx = store::index();
  if (index < 0 || index >= (int)idx.apps.size()) { add_text(t, pad, y, c.w - 2 * pad, 44, "No such app", Size::LG); return; }
  const rt::StoreApp &a = idx.apps[(size_t)index];
  const char *icon = icons::index_of(a.icon.c_str()) >= 0 ? a.icon.c_str() : "apps";
  add_icon(t, pad, y, icon, icons::IconSize::LG);
  int tx = pad + 112, tw = c.w - 2 * pad - 112;
  add_text(t, tx, y, tw, 44, a.name.c_str(), Size::LG, Weight::BOLD);
  std::string meta = a.version + (a.author.empty() ? "" : " · " + a.author) + (a.installs > 0 ? " · " + std::to_string(a.installs) + " installs" : "");
  add_text(t, tx, y + 48, tw, 29, meta.c_str(), Size::SM, Weight::REGULAR, Align::LEFT, VAlign::TOP, 4);
  y += 112;
  add_text(t, pad, y, c.w - 2 * pad, 36 * 2, a.tagline.c_str(), Size::MD, Weight::REGULAR, Align::LEFT, VAlign::TOP, 0, 2);
  y += 36 * 2 + 12;
  const store::Detail *d = store::detail(a.id);
  int desc_lines = (c.h - y - 200) / 29;
  if (desc_lines > 8) desc_lines = 8;
  if (desc_lines < 2) desc_lines = 2;
  if (d && !d->description.empty()) add_text(t, pad, y, c.w - 2 * pad, 29 * desc_lines, d->description.c_str(), Size::SM, Weight::REGULAR, Align::LEFT, VAlign::TOP, 0, desc_lines);
  else if (store::busy() == store::Busy::DETAIL) add_text(t, pad, y, c.w - 2 * pad, 29, "Loading details…", Size::SM, Weight::REGULAR, Align::LEFT, VAlign::TOP, 6);
  y += 29 * desc_lines + 16;
  if (!a.screens.empty()) {
    std::string s = "Screens: ";
    for (size_t i = 0; i < a.screens.size(); i++) s += (i ? ", " : "") + a.screens[i];
    add_text(t, pad, y, c.w - 2 * pad, 24, s.c_str(), Size::XS, Weight::REGULAR, Align::LEFT, VAlign::TOP, 6);
    y += 28;
  }
  // Buttons.
  int by = c.h - 150;
  prefs::AppRecord rec;
  bool installed = store::is_installed(a.id, &rec);
  std::string uv;
  bool has_update = store::update_available(a.id, uv);
  bool busy = store::busy() != store::Busy::NONE;
  if (!store::min_os_ok(a.min_os)) {
    std::string msg = "This app needs QuireOS " + a.min_os + " (this device runs " + hal::board().os_version + ")";
    add_text(t, pad, by, c.w - 2 * pad, 29 * 2, msg.c_str(), Size::SM, Weight::BOLD, Align::CENTER, VAlign::TOP, 0, 2);
  } else if (installed) {
    add_button(t, pad, by, (c.w - 2 * pad - 16) / 2, 60, "Uninstall", busy ? A_NONE : A_STORE_UNINSTALL, index, nullptr, nullptr, 15, 0);
    if (has_update || rt::compare_versions(a.version.c_str(), rec.version.c_str()) > 0)
      add_button(t, pad + (c.w - 2 * pad - 16) / 2 + 16, by, (c.w - 2 * pad - 16) / 2, 60, ("Update to " + a.version).c_str(), busy ? A_NONE : A_STORE_UPDATE, index, nullptr, nullptr, 0, 0);
    else
      add_text(t, pad + (c.w - 2 * pad - 16) / 2 + 16, by, (c.w - 2 * pad - 16) / 2, 60, ("Installed " + rec.version).c_str(), Size::MD, Weight::BOLD, Align::CENTER, VAlign::MIDDLE);
  } else {
    add_button(t, pad, by, c.w - 2 * pad, 60, busy ? "Working…" : "Install", busy ? A_NONE : A_STORE_INSTALL, index, nullptr, nullptr, 0, 0);
  }
  const std::string &st = store::status();
  if (!st.empty()) add_text(t, pad, c.h - 70, c.w - 2 * pad, 29 * 2, st.c_str(), Size::SM, Weight::REGULAR, Align::CENTER, VAlign::TOP, 4, 2);
}

void build_pairing(rt::WidgetTree &t, const Chrome &c) {
  const int pad = profile::MARGIN;
  int y = nav_bar(t, c, "Pair with account", A_BACK, "Back");
  const store::Pairing &p = store::pairing();
  y += 24;
  if (p.done) {
    add_icon(t, c.w / 2 - icons::pixels(icons::IconSize::LG) / 2, y, "check-circle-outline", icons::IconSize::LG);
    y += 120;
    std::string msg = "Paired with " + (p.user.empty() ? std::string("your account") : p.user);
    add_text(t, pad, y, c.w - 2 * pad, 44 * 2, msg.c_str(), Size::LG, Weight::BOLD, Align::CENTER, VAlign::TOP, 0, 2);
    add_text(t, pad, y + 100, c.w - 2 * pad, 36 * 2, "Private apps from this account now appear in the store list.", Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 2);
    add_button(t, c.w / 2 - 80, y + 200, 160, 56, "Done", A_BACK);
    return;
  }
  if (!p.code.empty()) {
    add_text(t, pad, y, c.w - 2 * pad, 36, "Enter this code at", Size::MD, Weight::REGULAR, Align::CENTER);
    add_text(t, pad, y + 40, c.w - 2 * pad, 36, p.url.c_str(), Size::MD, Weight::BOLD, Align::CENTER);
    std::string spaced;
    for (size_t i = 0; i < p.code.size(); i++) { if (i) spaced.push_back(' '); spaced.push_back(p.code[i]); }
    add_rect(t, pad, y + 100, c.w - 2 * pad, 130, -1, 0, 3, 16);
    add_text(t, pad, y + 100, c.w - 2 * pad, 130, spaced.c_str(), Size::XXL, Weight::BOLD, Align::CENTER, VAlign::MIDDLE);
    int left_s = (int32_t)(p.expires_ms - hal::millis()) / 1000;
    if (left_s < 0) left_s = 0;
    char b[64];
    snprintf(b, sizeof b, "Waiting… code valid for %d:%02d", left_s / 60, left_s % 60);
    add_text(t, pad, y + 250, c.w - 2 * pad, 29, p.expired ? "Code expired" : b, Size::SM, Weight::REGULAR, Align::CENTER, VAlign::TOP, 4);
  } else {
    add_text(t, pad, y + 40, c.w - 2 * pad, 36 * 2, p.error.empty() ? "Requesting a pairing code…" : p.error.c_str(), Size::MD, Weight::REGULAR, Align::CENTER, VAlign::TOP, 0, 2);
  }
  int by = y + 310;
  if (p.expired || (!p.error.empty() && p.code.empty())) add_button(t, pad, by, (c.w - 2 * pad - 16) / 2, 56, "Try again", A_STORE_PAIR);
  add_button(t, c.w - pad - (c.w - 2 * pad - 16) / 2, by, (c.w - 2 * pad - 16) / 2, 56, "Cancel", A_STORE_PAIR_CANCEL);
}

}  // namespace

void build_store(rt::WidgetTree &t, const Chrome &c, const StoreView &v, int &page_count) {
  t.clear();
  page_count = 1;
  switch (v.page) {
    case StorePage::LIST: build_list(t, c, v.list_page, page_count); break;
    case StorePage::DETAIL: build_detail(t, c, v.detail_index); break;
    case StorePage::PAIRING: build_pairing(t, c); break;
  }
}

}  // namespace ui
}  // namespace os
}  // namespace quire
