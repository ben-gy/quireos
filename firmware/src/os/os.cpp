// QuireOS core: modes, the main loop, input dispatch, rendering policy, sleep, web mailbox.
#include "os.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include "../hal/hal.h"
#include "../runtime/profile_gen.h"
#include "../runtime/renderer.h"
#include "../runtime/session.h"
#include "../runtime/url.h"
#include "net_task.h"
#include "prefs.h"
#include "store_client.h"
#include "ui.h"
#include "web_api.h"

namespace quire {
namespace os {

namespace {
const char *TAG = "os";
using hal::Rect;

enum class Mode : uint8_t { SETUP, LAUNCHER, STORE, SETTINGS, APP, ERROR, NEEDS_SETUP, UPDATE_OS };
const char *mode_name(Mode m) {
  static const char *N[] = {"setup", "launcher", "store", "settings", "app", "error", "needs_setup", "update_os"};
  return N[(int)m];
}

struct SessionFetcher : rt::Fetcher {
  bool fetch(const rt::FetchRequest &req) override { return net::submit(net::OWNER_SESSION, req); }
};

Mode g_mode = Mode::LAUNCHER;
Mode g_prev_mode = Mode::LAUNCHER;      // where Home/Back from an error goes
hal::Framebuffer g_fb;
rt::WidgetTree g_tree;                  // OS screens
rt::AppSession *g_session = nullptr;
SessionFetcher g_fetcher;
std::vector<prefs::AppRecord> g_apps;
int g_app_index = -1;
std::string g_app_name;
std::string g_error_message;
std::vector<std::string> g_missing;
int g_launcher_page = 0, g_page_count = 1;
ui::StoreView g_store_view;
bool g_os_dirty = false;                // OS tree must be rebuilt and drawn
bool g_full_redraw = false;
bool g_home_requested = false;
uint32_t g_last_activity_ms = 0;
uint32_t g_last_minute = 0;
int g_partials_since_full = 0;
uint32_t g_last_full_ms = 0;
std::string g_alert;
uint32_t g_alert_until_ms = 0;
Rect g_alert_rect;
int g_corner_drawn = -1;        // icon index of the OS corner glyph on glass, -1 = none
bool g_presented = false;       // a present happened in this loop iteration
tz::Zone g_zone;
uint32_t g_state_published_ms = 0;
bool g_state_dirty = true;
uint32_t g_boot_ms = 0;
bool g_setup_done = false;

hal::Board &B() { return hal::board(); }
uint32_t now_ms() { return hal::millis(); }
int64_t epoch() { return B().clock ? B().clock->now() : 0; }

// ------------------------------------------------------------------------------ helpers ---

ui::Chrome chrome() {
  ui::Chrome c;
  c.w = g_fb.w; c.h = g_fb.h;
  c.epoch = epoch();
  c.zone = &g_zone;
  if (B().power && B().power->caps().battery) { c.battery = B().power->battery_percent(); c.charging = B().power->charging(); }
  if (B().net) { c.online = B().net->connected(); c.rssi = B().net->rssi(); c.ip = c.online && B().net->ip() ? B().net->ip() : ""; }
  return c;
}

rt::DeviceInfo device_info() {
  rt::DeviceInfo d;
  if (B().power && B().power->caps().battery) { d.battery = B().power->battery_percent(); d.charging = B().power->charging(); }
  if (B().net) { d.online = B().net->connected(); d.rssi = d.online ? B().net->rssi() : -100; }   // SPEC §3
  d.name = prefs::device_name();
  d.tz = prefs::tz();
  d.w = g_fb.w; d.h = g_fb.h;
  if (B().display) { d.greys = B().display->caps().greys; d.dpi = B().display->caps().dpi; }
  return d;
}

bool alloc_fb() {
  if (!B().display) return false;
  uint16_t w = B().display->width(), h = B().display->height();
  if (g_fb.data && g_fb.w == w && g_fb.h == h) return true;
  if (g_fb.data) hal::free_big(g_fb.data);
  g_fb.w = w; g_fb.h = h;
  g_fb.data = (uint8_t *)hal::alloc_big(g_fb.bytes());
  if (!g_fb.data) { hal::log(hal::LOG_ERROR, TAG, "framebuffer alloc failed"); return false; }
  g_fb.fill(15);
  return true;
}

void set_orientation(bool landscape) {
  hal::Display *d = B().display;
  if (!d) return;
  hal::Rotation def = B().default_rotation;
  bool def_landscape;
  {
    bool swap = def == hal::Rotation::R90 || def == hal::Rotation::R270;
    uint16_t w = swap ? d->caps().native_h : d->caps().native_w, h = swap ? d->caps().native_w : d->caps().native_h;
    def_landscape = w >= h;
  }
  hal::Rotation want = def;
  if (landscape != def_landscape) want = (hal::Rotation)(((int)def + 3) % 4);
  if (want != d->rotation()) {
    d->set_rotation(want);
    if (B().input) B().input->set_rotation(want);
    alloc_fb();
    g_partials_since_full = 100;   // force a clean full refresh after rotating
  }
}

hal::UpdateMode choose_mode(rt::Refresh hint, bool full_screen) {
  const hal::DisplayCaps &caps = B().display->caps();
  if (!caps.partial_update) return hal::UpdateMode::FULL;
  int policy = prefs::refresh_policy();
  if (policy == 2 || hint == rt::Refresh::FULL) return hal::UpdateMode::FULL;
  uint32_t since_full = now_ms() - g_last_full_ms;
  if (full_screen) {
    int limit = hint == rt::Refresh::PARTIAL || policy == 1 ? 24 : 8;
    if (g_partials_since_full >= limit || since_full > 30u * 60u * 1000u) return hal::UpdateMode::FULL;
    return hal::UpdateMode::PARTIAL;
  }
  if (g_partials_since_full >= 40) return hal::UpdateMode::FULL;
  return hal::UpdateMode::PARTIAL;
}

void present(Rect r, hal::UpdateMode mode) {
  if (!B().display) return;
  Rect full; full.w = (int16_t)g_fb.w; full.h = (int16_t)g_fb.h;
  if (r.empty()) r = full;                       // an empty rect means "the whole screen"
  if (mode == hal::UpdateMode::FULL) { r = full; g_partials_since_full = 0; g_last_full_ms = now_ms(); }
  else g_partials_since_full++;
  B().display->present(g_fb, r, mode);
  g_presented = true;
}

const rt::WidgetTree &active_tree() { return g_mode == Mode::APP && g_session ? g_session->tree() : g_tree; }
rt::WidgetTree &active_tree_mut() { return g_mode == Mode::APP && g_session ? g_session->tree() : g_tree; }

void log_tree(const rt::WidgetTree &t) {
  static const char *T[] = {"none", "text", "rect", "line", "icon", "image", "button"};
  hal::log(hal::LOG_DEBUG, TAG, "tree: %d widgets", t.count());
  for (int i = 0; i < t.count(); i++) {
    const rt::Widget &w = t[i];
    hal::log(hal::LOG_DEBUG, TAG, "  #%d %-6s %4d,%4d %4dx%-4d %s%s%s", i, T[(int)w.type], w.r.x, w.r.y, w.r.w, w.r.h,
             w.visible ? "" : "(hidden) ", t.str(w.text), w.has_action() ? " [action]" : "");
  }
}

// ---------------------------------------------------------------------------- OS screens ---

void rebuild_os_screen();

void enter(Mode m) {
  if (g_mode != Mode::APP && g_mode != Mode::ERROR && g_mode != Mode::NEEDS_SETUP && g_mode != Mode::UPDATE_OS) g_prev_mode = g_mode;
  g_mode = m;
  g_state_dirty = true;
  if (m != Mode::APP) rebuild_os_screen();
  hal::log(hal::LOG_INFO, TAG, "mode -> %s", mode_name(m));
}

void rebuild_os_screen() {
  ui::Chrome c = chrome();
  switch (g_mode) {
    case Mode::SETUP: ui::build_setup(g_tree, c, B().net && B().net->has_credentials() == false); break;
    case Mode::LAUNCHER: ui::build_launcher(g_tree, c, g_apps, g_launcher_page, g_page_count); break;
    case Mode::STORE: ui::build_store(g_tree, c, g_store_view, g_page_count); break;
    case Mode::SETTINGS: ui::build_settings(g_tree, c); break;
    case Mode::ERROR: ui::build_error(g_tree, c, ui::ErrorKind::APP_ERROR, g_app_name.c_str(), g_error_message.c_str(), g_missing); break;
    case Mode::NEEDS_SETUP: ui::build_error(g_tree, c, ui::ErrorKind::NEEDS_SETUP, g_app_name.c_str(), "", g_missing); break;
    case Mode::UPDATE_OS: ui::build_error(g_tree, c, ui::ErrorKind::UPDATE_OS, g_app_name.c_str(), "This app needs a newer QuireOS version.", g_missing); break;
    case Mode::APP: break;
  }
  g_os_dirty = true;
}

void go_launcher() {
  if (g_session) g_session->close();
  g_app_index = -1;
  prefs::remove("last_app");
  set_orientation(false);
  enter(Mode::LAUNCHER);
}

void reload_apps() {
  g_apps = store::installed();
  if (g_mode == Mode::LAUNCHER) rebuild_os_screen();
  g_state_dirty = true;
}

void draw_loading(const char *name) {
  Rect r; r.x = 0; r.y = (int16_t)(g_fb.h - 60); r.w = (int16_t)g_fb.w; r.h = 60;
  g_fb.fill_rect(r, 15);
  std::string msg = std::string("Opening ") + name + "…";
  rt::draw_text_block(g_fb, msg.c_str(), r, fontlib::Size::SM, fontlib::Weight::REGULAR, rt::Align::CENTER, rt::VAlign::MIDDLE, 1, 0, r);
  present(r, hal::UpdateMode::PARTIAL);
}

bool open_app(int index) {
  if (index < 0 || index >= (int)g_apps.size()) return false;
  const prefs::AppRecord rec = g_apps[(size_t)index];
  if (!g_session) g_session = new rt::AppSession();
  hal::Storage *st = B().storage;
  uint8_t *data = nullptr;
  size_t len = 0;
  std::string path = "/apps/" + rec.id + "/manifest.json";
  if (!st || !st->file_read(path.c_str(), &data, &len)) {
    g_app_name = rec.name; g_error_message = "The app's manifest is missing. Reinstall it from the Store.";
    enter(Mode::ERROR);
    return false;
  }
  rt::ParseResult pr = rt::parse_manifest((const char *)data, len, g_session->manifest);
  st->file_free(data);
  g_app_name = rec.name;
  g_missing.clear();
  if (pr.status == rt::ParseStatus::UPDATE_OS) { enter(Mode::UPDATE_OS); return false; }
  if (!pr.ok()) { g_error_message = std::string("Invalid manifest: ") + pr.error; enter(Mode::ERROR); return false; }
  draw_loading(rec.name.c_str());
  set_orientation(g_session->manifest.landscape());
  g_app_index = index;
  prefs::set("last_app", rec.id);
  std::string settings = prefs::app_settings(rec.id.c_str());
  g_session->open(&g_fetcher, rec.manifest_url, rec.install_id, settings.c_str(), device_info());
  switch (g_session->state()) {
    case rt::AppSession::State::NEEDS_SETUP: g_missing = g_session->missing_settings(); enter(Mode::NEEDS_SETUP); return false;
    case rt::AppSession::State::ERROR: g_error_message = g_session->error_message(); enter(Mode::ERROR); return false;
    default: break;
  }
  g_mode = Mode::APP;
  g_state_dirty = true;
  hal::log(hal::LOG_INFO, TAG, "mode -> app (%s %s)", rec.id.c_str(), rec.version.c_str());
  return true;
}

bool open_app_by_id(const std::string &id) {
  for (size_t i = 0; i < g_apps.size(); i++) if (g_apps[i].id == id) return open_app((int)i);
  return false;
}

// -------------------------------------------------------------------------- state snapshot ---

void publish_state() {
  JsonDocument d;
  JsonObject dev = d["device"].to<JsonObject>();
  char screen[32];
  hal::screen_string(screen, sizeof screen);
  dev["name"] = prefs::device_name();
  dev["hw_id"] = hal::device_hw_id();
  dev["os_version"] = B().os_version;
  dev["profile"] = B().profile;
  dev["screen"] = screen;
  dev["mode"] = mode_name(g_mode);
  dev["app"] = g_app_index >= 0 && g_app_index < (int)g_apps.size() ? g_apps[(size_t)g_app_index].id : "";
  dev["battery"] = B().power && B().power->caps().battery ? B().power->battery_percent() : -1;
  dev["charging"] = B().power ? B().power->charging() : false;
  JsonObject wifi = dev["wifi"].to<JsonObject>();
  if (B().net) {
    wifi["connected"] = B().net->connected();
    wifi["ssid"] = B().net->ssid() ? B().net->ssid() : "";
    wifi["ip"] = B().net->ip() ? B().net->ip() : "";
    wifi["rssi"] = B().net->rssi();
  }
  dev["heap"] = B().power ? (long long)B().power->free_heap() : 0;
  dev["psram"] = B().power ? (long long)B().power->free_psram() : 0;
  dev["tz"] = prefs::tz();
  dev["sleep_s"] = prefs::sleep_timeout_s();
  dev["frontlight"] = prefs::frontlight();
  dev["frontlight_supported"] = B().power && B().power->caps().frontlight;
  dev["refresh_policy"] = prefs::refresh_policy();
  dev["store_url"] = prefs::store_url();
  dev["paired_user"] = prefs::paired_user();
  dev["web_auth"] = !prefs::web_password().empty();
  dev["uptime_s"] = (now_ms() - g_boot_ms) / 1000;
  JsonArray apps = d["apps"].to<JsonArray>();
  JsonDocument schemas;
  JsonObject sch = schemas.to<JsonObject>();
  for (const prefs::AppRecord &a : g_apps) {
    JsonObject o = apps.add<JsonObject>();
    o["id"] = a.id; o["name"] = a.name; o["version"] = a.version; o["icon"] = a.icon;
    o["manifest_url"] = a.manifest_url; o["install_id"] = a.install_id; o["orientation"] = a.orientation;
    o["update_version"] = a.update_version;
    // settings schema + current non-secret values
    rt::AppManifest m;
    uint8_t *data = nullptr; size_t len = 0;
    std::string path = "/apps/" + a.id + "/manifest.json";
    if (B().storage && B().storage->file_read(path.c_str(), &data, &len)) {
      rt::ParseResult pr = rt::parse_manifest((const char *)data, len, m);
      B().storage->file_free(data);
      if (pr.ok()) {
        JsonDocument vals;
        deserializeJson(vals, prefs::app_settings(a.id.c_str()));
        JsonArray sarr = o["settings"].to<JsonArray>();
        JsonArray sarr2 = sch[a.id].to<JsonArray>();
        for (const rt::SettingDef &s : m.settings) {
          JsonObject so = sarr.add<JsonObject>();
          so["key"] = std::string(s.key); so["label"] = s.label; so["type"] = rt::stype_name(s.type); so["required"] = s.required; so["help"] = s.help;
          if (!s.options.isNull()) so["options"] = s.options;
          if (!s.item.isNull()) so["item"] = s.item;
          if (s.has_min) so["min"] = s.min;
          if (s.has_max) so["max"] = s.max;
          const char *skey = s.key;
          if (s.type == rt::SType::SECRET) so["set"] = !vals[skey].isNull() && *(vals[skey] | "") != 0;
          else if (!vals[skey].isNull()) so["value"] = vals[skey];
          else if (!s.def.isNull()) so["value"] = s.def;
          JsonObject so2 = sarr2.add<JsonObject>();
          so2["key"] = std::string(s.key); so2["type"] = rt::stype_name(s.type);
          if (!s.options.isNull()) so2["options"] = s.options;
          if (!s.item.isNull()) so2["item"] = s.item;
          if (s.has_min) so2["min"] = s.min;
          if (s.has_max) so2["max"] = s.max;
        }
        std::string app_origin = url::origin(a.manifest_url);
        for (const std::string &h : m.hosts) if (url::origin(h) == app_origin) o["warn_secrets"] = app_origin;
      }
    }
  }
  JsonObject st = d["store"].to<JsonObject>();
  st["status"] = store::status();
  st["busy"] = store::busy() != store::Busy::NONE;
  const store::Pairing &p = store::pairing();
  JsonObject pj = st["pairing"].to<JsonObject>();
  pj["active"] = p.active; pj["code"] = p.code; pj["url"] = p.url; pj["done"] = p.done; pj["user"] = p.user; pj["error"] = p.error;
  std::string sj, schj;
  serializeJson(d, sj);
  serializeJson(schemas, schj);
  web::publish(sj.c_str(), schj.c_str());
  g_state_dirty = false;
  g_state_published_ms = now_ms();
}

// ------------------------------------------------------------------------------ actions ---

void handle_os_action(uint16_t action, int arg) {
  switch (action) {
    case ui::A_OPEN_APP: open_app(arg); break;
    case ui::A_OPEN_STORE: g_store_view = ui::StoreView(); enter(Mode::STORE); store::fetch_index(false); break;
    case ui::A_OPEN_SETTINGS: enter(Mode::SETTINGS); break;
    case ui::A_HOME: go_launcher(); break;
    case ui::A_BACK:
      if (g_mode == Mode::STORE && g_store_view.page != ui::StorePage::LIST) { if (g_store_view.page == ui::StorePage::PAIRING) store::pair_cancel(); g_store_view.page = ui::StorePage::LIST; rebuild_os_screen(); }
      else go_launcher();
      break;
    case ui::A_PAGE:
      if (g_mode == Mode::LAUNCHER) { g_launcher_page += arg; if (g_launcher_page < 0) g_launcher_page = 0; if (g_launcher_page >= g_page_count) g_launcher_page = g_page_count - 1; }
      else if (g_mode == Mode::STORE) { g_store_view.list_page += arg; if (g_store_view.list_page < 0) g_store_view.list_page = 0; if (g_store_view.list_page >= g_page_count) g_store_view.list_page = g_page_count - 1; }
      rebuild_os_screen();
      break;
    case ui::A_STORE_DETAIL:
      g_store_view.page = ui::StorePage::DETAIL; g_store_view.detail_index = arg;
      if (store::index_loaded() && arg >= 0 && arg < (int)store::index().apps.size()) store::fetch_detail(store::index().apps[(size_t)arg].id);
      rebuild_os_screen();
      break;
    case ui::A_STORE_INSTALL: if (store::index_loaded() && arg >= 0 && arg < (int)store::index().apps.size()) store::install(store::index().apps[(size_t)arg]); rebuild_os_screen(); break;
    case ui::A_STORE_UNINSTALL: if (store::index_loaded() && arg >= 0 && arg < (int)store::index().apps.size()) { store::uninstall(store::index().apps[(size_t)arg].id); reload_apps(); } rebuild_os_screen(); break;
    case ui::A_STORE_UPDATE: if (store::index_loaded() && arg >= 0 && arg < (int)store::index().apps.size()) store::update(store::index().apps[(size_t)arg].id); rebuild_os_screen(); break;
    case ui::A_STORE_PAIR: store::pair_start(); g_store_view.page = ui::StorePage::PAIRING; rebuild_os_screen(); break;
    case ui::A_STORE_PAIR_CANCEL: store::pair_cancel(); g_store_view.page = ui::StorePage::LIST; rebuild_os_screen(); break;
    case ui::A_STORE_REFRESH: store::fetch_index(true); rebuild_os_screen(); break;
    case ui::A_FRONTLIGHT_DELTA: {
      int l = prefs::frontlight() + arg;
      if (l < 0) l = 0; if (l > 3) l = 3;
      prefs::set_frontlight(l);
      if (B().power) B().power->frontlight((uint8_t)(l * 85));
      rebuild_os_screen();
      break;
    }
    case ui::A_SLEEP_DELTA: {
      static const int STEPS[] = {0, 60, 120, 300, 600, 900, 1800, 3600};
      int cur = prefs::sleep_timeout_s(), idx = 3;
      for (int i = 0; i < 8; i++) if (STEPS[i] == cur) idx = i;
      idx += arg; if (idx < 0) idx = 0; if (idx > 7) idx = 7;
      prefs::set_sleep_timeout_s(STEPS[idx]);
      rebuild_os_screen();
      break;
    }
    case ui::A_REFRESH_POLICY_DELTA: prefs::set_refresh_policy(((prefs::refresh_policy() + arg) % 3 + 3) % 3); rebuild_os_screen(); break;
    case ui::A_TZ_DELTA: {
      int idx = ui::tz_option_index(prefs::tz());
      idx = idx < 0 ? 0 : idx + arg;
      prefs::set_tz(ui::tz_option(idx));
      tz::parse(prefs::tz().c_str(), g_zone);
      rebuild_os_screen();
      break;
    }
    case ui::A_WIFI_FORGET:
      if (B().net) { B().net->forget(); enter(Mode::SETUP); }
      break;
    case ui::A_REBOOT: hal::reboot(); break;
    case ui::A_CHECK_UPDATES: store::check_updates(true); rebuild_os_screen(); break;
    case ui::A_FULL_REDRAW: g_full_redraw = true; break;
    case ui::A_RETRY:
      if (g_session && g_session->state() == rt::AppSession::State::ERROR) { g_session->retry(); g_mode = Mode::APP; g_state_dirty = true; }
      else if (g_app_index >= 0) open_app(g_app_index);
      else go_launcher();
      break;
    case ui::A_SETUP_DONE: g_setup_done = true; go_launcher(); break;
    default: break;
  }
}

void handle_web_commands() {
  web::Command c;
  while (web::take_command(c)) {
    hal::log(hal::LOG_INFO, TAG, "web command %d %s", (int)c.type, c.a);
    switch (c.type) {
      case web::Command::STORE_URL: prefs::set_store_url(c.a); break;
      case web::Command::APP_SETTINGS: {
        JsonDocument cur, patch;
        deserializeJson(cur, prefs::app_settings(c.a));
        if (!cur.is<JsonObject>()) cur.to<JsonObject>();
        if (c.b) deserializeJson(patch, c.b);
        JsonObject o = cur.as<JsonObject>();
        for (JsonPairConst p : patch.as<JsonObjectConst>()) {
          std::string k = p.key().c_str();
          if (p.value().isNull()) o.remove(k); else o[k] = p.value();
        }
        std::string s;
        serializeJson(cur, s);
        prefs::set_app_settings(c.a, s);
        // Settings change: re-open the app if it is running (network policy and X-App-Settings recompute).
        if (g_app_index >= 0 && g_app_index < (int)g_apps.size() && g_apps[(size_t)g_app_index].id == c.a &&
            (g_mode == Mode::APP || g_mode == Mode::NEEDS_SETUP || g_mode == Mode::ERROR)) open_app(g_app_index);
        break;
      }
      case web::Command::INSTALL: store::install_url(c.a); break;
      case web::Command::UNINSTALL:
        if (g_app_index >= 0 && g_app_index < (int)g_apps.size() && g_apps[(size_t)g_app_index].id == c.a) go_launcher();
        store::uninstall(c.a);
        reload_apps();
        break;
      case web::Command::PAIR: store::pair_start(); if (g_mode == Mode::STORE) { g_store_view.page = ui::StorePage::PAIRING; rebuild_os_screen(); } break;
      case web::Command::REFRESH: if (g_mode == Mode::APP && g_session) g_session->refresh(); else { g_full_redraw = true; } break;
      case web::Command::REBOOT: hal::reboot(); break;
      case web::Command::HOME: go_launcher(); break;
      case web::Command::WIFI_FORGET: if (B().net) { B().net->forget(); enter(Mode::SETUP); } break;
      case web::Command::CHECK_UPDATES: store::check_updates(true); break;
      case web::Command::OPEN_APP: open_app_by_id(c.a); break;
      case web::Command::PREFS: {
        JsonDocument p;
        if (c.b) deserializeJson(p, c.b);
        if (p["tz"].is<const char *>()) { tz::Zone z; if (tz::parse(p["tz"], z)) { prefs::set_tz(p["tz"].as<const char *>()); g_zone = z; } }
        if (p["sleep_s"].is<int>()) prefs::set_sleep_timeout_s(p["sleep_s"]);
        if (p["frontlight"].is<int>()) { prefs::set_frontlight(p["frontlight"]); if (B().power) B().power->frontlight((uint8_t)(prefs::frontlight() * 85)); }
        if (p["refresh_policy"].is<int>()) prefs::set_refresh_policy(p["refresh_policy"]);
        if (p["name"].is<const char *>()) prefs::set_device_name(p["name"].as<const char *>());
        if (p["web_password"].is<const char *>()) prefs::set_web_password(p["web_password"].as<const char *>());
        if (g_mode != Mode::APP) rebuild_os_screen();
        break;
      }
      default: break;
    }
    web::free_command(c);
    g_state_dirty = true;
  }
}

// ------------------------------------------------------------------------------ OS corner ---
// SPEC §6: status glyphs in a `corner` square whose right edge is `margin` from the screen edge and
// whose top is (nav - corner) / 2. Drawn only over app screens (the OS chrome has its own bar).

Rect corner_rect() {
  Rect r;
  r.w = (int16_t)profile::CORNER; r.h = (int16_t)profile::CORNER;
  r.x = (int16_t)(g_fb.w - profile::MARGIN - profile::CORNER);
  r.y = (int16_t)((profile::NAV - profile::CORNER) / 2);
  return r;
}

int corner_glyph() {
  if (g_mode != Mode::APP || !g_session) return -1;
  bool online = B().net ? B().net->connected() : true;
  if (!online) return icons::index_of("wifi-off");
  if (g_session->background_failed()) return icons::index_of("alert-circle-outline");
  if (g_session->busy()) return icons::index_of("progress-clock");
  for (const prefs::AppRecord &a : g_apps) if (!a.update_version.empty()) return icons::index_of("update");
  if (B().power && B().power->caps().battery) {
    if (B().power->charging()) return icons::index_of("battery-charging");
    int pct = B().power->battery_percent();
    if (pct >= 0 && pct < 15) return icons::index_of("battery-alert-variant-outline");
  }
  return -1;
}

// Draw the current glyph into the framebuffer (no present). Returns the glyph drawn.
int composite_corner() {
  int g = corner_glyph();
  if (g < 0) return -1;
  Rect r = corner_rect();
  Rect clip; clip.w = (int16_t)g_fb.w; clip.h = (int16_t)g_fb.h;
  g_fb.fill_rect(r, 15);
  int px = profile::ICON_MD;
  icons::draw(g_fb, g, icons::IconSize::MD, r.x + (r.w - px) / 2, r.y + (r.h - px) / 2, 0, clip);
  return g;
}

// Called once per loop after rendering: presents the corner square on its own when the glyph changed.
void update_corner() {
  if (g_mode != Mode::APP || !g_session || !g_session->has_screen()) { g_corner_drawn = -1; return; }
  int g = corner_glyph();
  if (g == g_corner_drawn) return;
  if (g_presented) return;              // something else was drawn this iteration; next loop
  Rect r = corner_rect();
  if (g < 0) rt::render_region(g_fb, g_session->tree(), r, &g_session->images());
  else composite_corner();
  present(r, hal::UpdateMode::PARTIAL);
  g_corner_drawn = g;
}

// ------------------------------------------------------------------------------- overlays ---

void draw_alert(const char *msg) {
  const fontlib::Font *f = fontlib::font(fontlib::Size::SM, fontlib::Weight::BOLD);
  int tw = fontlib::text_width(f, msg) + 48 + 32;
  if (tw > g_fb.w - 32) tw = g_fb.w - 32;
  Rect r; r.w = (int16_t)tw; r.h = (int16_t)profile::TOAST; r.x = (int16_t)((g_fb.w - tw) / 2); r.y = (int16_t)(g_fb.h - profile::TOAST - profile::MARGIN);
  Rect clip; clip.w = (int16_t)g_fb.w; clip.h = (int16_t)g_fb.h;
  rt::fill_rounded(g_fb, r, profile::RADIUS_MD, 0, -1, 0, clip);
  icons::draw(g_fb, icons::index_of("alert-circle-outline"), icons::IconSize::SM, r.x + 12,
              r.y + (r.h - icons::pixels(icons::IconSize::SM)) / 2, 15, clip);
  Rect tr; tr.x = (int16_t)(r.x + 52); tr.y = r.y; tr.w = (int16_t)(r.w - 64); tr.h = r.h;
  rt::draw_text_block(g_fb, msg, tr, fontlib::Size::SM, fontlib::Weight::BOLD, rt::Align::LEFT, rt::VAlign::MIDDLE, 1, 15, clip);
  g_alert_rect = r;
  present(r, hal::UpdateMode::PARTIAL);
}

void clear_alert() {
  if (g_alert_rect.empty()) return;
  rt::render_region(g_fb, active_tree(), g_alert_rect, g_mode == Mode::APP && g_session ? &g_session->images() : nullptr);
  present(g_alert_rect, hal::UpdateMode::PARTIAL);
  g_alert_rect = Rect();
}

// ------------------------------------------------------------------------------ rendering ---

void render_os_screen() {
  rt::render_full(g_fb, g_tree, nullptr);
  log_tree(g_tree);
  present(Rect(), g_full_redraw ? hal::UpdateMode::FULL : choose_mode(rt::Refresh::AUTO, true));
  g_os_dirty = false;
  g_full_redraw = false;
  g_alert_rect = Rect();
}

void render_app() {
  rt::RenderPlan plan;
  if (g_full_redraw) {
    rt::render_full(g_fb, g_session->tree(), &g_session->images());
    g_corner_drawn = composite_corner();
    present(Rect(), hal::UpdateMode::FULL);
    g_full_redraw = false;
    g_alert_rect = Rect();
    rt::RenderPlan discard;
    g_session->take_render(discard);
    return;
  }
  if (!g_session->take_render(plan)) return;
  if (plan.full) {
    rt::render_full(g_fb, g_session->tree(), &g_session->images());
    log_tree(g_session->tree());
    g_corner_drawn = composite_corner();
    present(Rect(), choose_mode(plan.hint, true));
    g_alert_rect = Rect();
  } else {
    Rect u;
    for (int i = 0; i < plan.count; i++) u = u.united(rt::render_region(g_fb, g_session->tree(), plan.rects[i], &g_session->images()));
    if (!u.empty()) {
      if (u.intersects(corner_rect())) g_corner_drawn = composite_corner();
      present(u, choose_mode(plan.hint, false));
    }
    if (!g_alert_rect.empty() && u.intersects(g_alert_rect)) g_alert_rect = Rect();
  }
}

// ---------------------------------------------------------------------------------- sleep ---

void maybe_sleep() {
  hal::Power *p = B().power;
  if (!p || !p->caps().deep_sleep) return;
  int timeout = prefs::sleep_timeout_s();
  if (timeout <= 0 || g_mode == Mode::SETUP) return;
  if (now_ms() - g_last_activity_ms < (uint32_t)timeout * 1000u) return;
  if (!net::idle() || g_os_dirty) return;
  if (g_mode == Mode::APP && g_session && g_session->state() == rt::AppSession::State::LOADING) return;
  hal::WakeSources w;
  w.touch = B().input && B().input->caps().touch;
  w.button = B().input && B().input->caps().button_count > 0;
  uint32_t next = 0xFFFFFFFFu;
  if (g_mode == Mode::APP && g_session) next = g_session->next_timer_ms(now_ms());
  if (next == 0xFFFFFFFFu || next > 3600000u) next = 3600000u;
  if (next < 5000) next = 5000;
  w.timer_ms = next;
  hal::log(hal::LOG_INFO, TAG, "idle for %d s, sleeping (timer %u ms)", timeout, w.timer_ms);
  if (B().display) B().display->power_off();
  p->sleep(w);
  // Boards whose sleep returns (the host) continue here as if woken.
  g_last_activity_ms = now_ms();
  if (p->wake_cause() == hal::WakeCause::TIMER && g_mode == Mode::APP && g_session) g_session->refresh();
}

}  // namespace

// ----------------------------------------------------------------------------- public API ---

void request_home() { g_home_requested = true; }
void request_full_redraw() { g_full_redraw = true; }

void setup() {
  hal::Board &b = B();
  g_boot_ms = now_ms();
  if (b.storage) b.storage->begin();
  prefs::begin();
  tz::parse(prefs::tz().c_str(), g_zone);
  if (b.display) b.display->begin(b.default_rotation);
  if (b.input) { b.input->begin(); b.input->set_rotation(b.default_rotation); }
  if (b.net) b.net->begin();
  if (b.power && b.power->caps().frontlight) b.power->frontlight((uint8_t)(prefs::frontlight() * 85));
  alloc_fb();
  if (b.display) rt::set_greys(b.display->caps().greys);
  net::begin();
  g_tree.init();
  if (g_session) { g_session->close(); }
  g_apps.clear();
  g_app_index = -1;
  g_last_activity_ms = now_ms();
  g_partials_since_full = 100;
  hal::log(hal::LOG_INFO, TAG, "QuireOS %s on %s (%s), %ux%u", b.os_version, b.name, b.profile, g_fb.w, g_fb.h);

  if (b.net && !b.net->has_credentials()) {
    enter(Mode::SETUP);
    render_os_screen();
    b.net->provision();                 // blocking captive portal on Wi-Fi boards; no-op on the host
    if (!b.net->has_credentials()) { hal::log(hal::LOG_WARN, TAG, "still no Wi-Fi credentials; staying in setup"); }
  }
  if (b.net && b.net->has_credentials() && !b.net->connected()) b.net->connect(15000);
  store::begin();
  g_apps = store::installed();
  g_mode = Mode::LAUNCHER;
  // After a timed wake, go straight back into the last app.
  std::string last = prefs::get("last_app");
  hal::WakeCause cause = b.power ? b.power->wake_cause() : hal::WakeCause::POWER_ON;
  if (!last.empty() && (cause == hal::WakeCause::TIMER || cause == hal::WakeCause::TOUCH) && open_app_by_id(last)) return;
  enter(Mode::LAUNCHER);
  render_os_screen();
  publish_state();
}

void loop() {
  hal::Board &b = B();
  uint32_t now = now_ms();
  int64_t ep = epoch();
  if (b.net) b.net->poll();

  // 1. Network responses.
  net::Response res;
  int drained = 0;
  while (drained++ < 8 && net::take(res)) {
    if (res.owner == net::OWNER_SESSION) { if (g_session) { rt::FetchResult r = res.as_result(); g_session->on_response(r); } }
    else if (res.owner == net::OWNER_STORE) store::on_response(res);
    net::release(res);
  }

  // 2. Input.
  hal::Event e;
  while (b.input && b.input->poll(e)) {
    g_last_activity_ms = now;
    if (e.kind == hal::Event::BUTTON) {
      // SPEC §6 keys: long = always Home; short/double run the screen's actions when claimed,
      // otherwise short = Home and double = a clean full redraw.
      bool in_app = g_mode == Mode::APP && g_session;
      if (e.gesture == hal::Gesture::LONG) g_home_requested = true;
      else if (e.gesture == hal::Gesture::SHORT) { if (!(in_app && g_session->run_key(false, ep))) g_home_requested = true; }
      else { if (!(in_app && g_session->run_key(true, ep))) g_full_redraw = true; }
      continue;
    }
    if (e.kind != hal::Event::TAP && e.kind != hal::Event::HOLD) continue;
    rt::WidgetTree &t = active_tree_mut();
    int idx = t.hit_test(e.x, e.y);
    hal::log(hal::LOG_INFO, TAG, "%s %d,%d -> widget %d", e.kind == hal::Event::HOLD ? "hold" : "tap", e.x, e.y, idx);
    if (idx < 0) continue;
    rt::Widget &w = t[idx];
    if (w.feedback == rt::Feedback::INVERT) {
      Rect full; full.w = (int16_t)g_fb.w; full.h = (int16_t)g_fb.h;
      Rect r = w.r.clipped(full);
      g_fb.invert_rect(r);
      present(r, b.display->caps().fast_update ? hal::UpdateMode::FAST : hal::UpdateMode::PARTIAL);
      w.pressed = true;
    }
    if (g_mode == Mode::APP && g_session) g_session->tap(e.x, e.y, e.kind == hal::Event::HOLD, ep);
    else handle_os_action(w.os_action, w.os_arg);
  }
  if (g_home_requested) { g_home_requested = false; if (g_mode == Mode::APP && g_session && g_session->has_screen()) go_launcher(); else go_launcher(); }

  // 3. Timers.
  if (g_session && g_mode == Mode::APP) {
    g_session->tick(now, ep);
    switch (g_session->state()) {
      case rt::AppSession::State::ERROR: g_error_message = g_session->error_message(); if (g_session->has_screen() && g_error_message.empty()) break; enter(Mode::ERROR); break;
      case rt::AppSession::State::UPDATE_OS: enter(Mode::UPDATE_OS); break;
      case rt::AppSession::State::NEEDS_SETUP: g_missing = g_session->missing_settings(); enter(Mode::NEEDS_SETUP); break;
      default: break;
    }
    const char *al = g_session->take_alert();
    if (al && *al) { g_alert = al; g_alert_until_ms = now + 4000; }
  }
  store::tick(now, ep);
  if (store::take_apps_changed()) reload_apps();
  if (store::take_changed()) { g_state_dirty = true; if (g_mode == Mode::STORE || g_mode == Mode::SETTINGS) rebuild_os_screen(); }
  uint32_t minute = (uint32_t)(ep / 60);
  if (minute != g_last_minute) {
    g_last_minute = minute;
    if (g_mode == Mode::LAUNCHER) rebuild_os_screen();
    if (ep > 0 && (minute % 60) == 0) store::check_updates(false);
    g_state_dirty = true;
  }

  // 4. Web mailbox.
  handle_web_commands();
  if (g_state_dirty || now - g_state_published_ms > 10000) publish_state();

  // 5. At most one display update (plus overlays).
  g_presented = false;
  if (g_mode == Mode::APP && g_session) {
    if (g_session->state() == rt::AppSession::State::READY || g_session->has_screen()) render_app();
  } else if (g_os_dirty || g_full_redraw) {
    render_os_screen();
  }
  if (!g_alert.empty()) { draw_alert(g_alert.c_str()); g_alert.clear(); }
  else if (!g_alert_rect.empty() && (int32_t)(now - g_alert_until_ms) >= 0) clear_alert();
  update_corner();

  // 6. Idle sleep.
  maybe_sleep();
}

}  // namespace os
}  // namespace quire
