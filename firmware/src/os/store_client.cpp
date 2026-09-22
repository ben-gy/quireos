#include "store_client.h"
#include <stdio.h>
#include <string.h>
#include "../hal/hal.h"
#include "../runtime/png_decode.h"
#include "../runtime/url.h"
#include "os.h"

namespace quire {
namespace os {
namespace store {

namespace {
const char *TAG = "store";
enum Tag : uint32_t { T_REGISTER = 1, T_INDEX, T_DETAIL, T_MANIFEST, T_ICON, T_UPDATE, T_PAIR_START, T_PAIR_POLL, T_REPORT };

Busy g_busy = Busy::NONE;
std::string g_status, g_index_error;
bool g_changed = false, g_apps_changed = false;
rt::StoreIndex g_index;
bool g_index_loaded = false;
std::string g_index_etag;
uint32_t g_index_fetched_ms = 0;
std::vector<Detail> g_details;
std::vector<prefs::AppRecord> g_installed;
Pairing g_pair;
uint32_t g_now = 0;
int64_t g_epoch = 0;
bool g_registering = false;

// Pending install.
struct Install {
  bool active = false, is_update = false;
  std::string manifest_url, name;
  rt::AppManifest manifest;
  std::string manifest_json;
} g_install;
// Update check queue.
std::vector<std::string> g_update_queue;
std::string g_update_current;

void set_status(const std::string &s) { g_status = s; g_changed = true; hal::log(hal::LOG_INFO, TAG, "%s", s.c_str()); }
void set_busy(Busy b) { g_busy = b; g_changed = true; }

bool send(uint32_t tag, const char *method, const std::string &url, const std::string &body = "", const std::string &etag = "",
          size_t max_bytes = 64 * 1024, const char *accept = "application/json") {
  rt::FetchRequest req;
  req.tag = tag;
  req.method = method;
  req.url = url;
  req.max_bytes = max_bytes;
  req.accept = accept;
  std::string tok = prefs::device_token();
  if (!tok.empty() && url.compare(0, prefs::store_url().size(), prefs::store_url()) == 0) req.headers.push_back("Authorization: Bearer " + tok);
  if (!etag.empty()) req.headers.push_back("If-None-Match: " + etag);
  if (!body.empty()) { req.body = body; req.headers.push_back("Content-Type: application/json"); }
  if (!net::submit(net::OWNER_STORE, req)) { set_status("Network busy, try again"); return false; }
  return true;
}

// A store URL ending in ".json" is a static index (e.g. the devstore's /index.json): no device API.
bool has_api() {
  std::string u = prefs::store_url();
  return !(u.size() > 5 && u.compare(u.size() - 5, 5, ".json") == 0);
}
std::string api(const char *path) { return prefs::store_url() + "/api/v1" + path; }
std::string index_url() { return has_api() ? api("/index") : prefs::store_url(); }

void save_installed() { prefs::save_apps(g_installed); g_apps_changed = true; g_changed = true; }

void register_device() {
  if (g_registering || !has_api() || !prefs::device_token().empty()) return;
  hal::Board &b = hal::board();
  char screen[32];
  hal::screen_string(screen, sizeof screen);
  JsonDocument d;
  d["hw_id"] = hal::device_hw_id();
  d["os_version"] = b.os_version;
  d["screen"] = screen;
  std::string body;
  serializeJson(d, body);
  g_registering = send(T_REGISTER, "POST", api("/devices"), body);
}

void report(const std::string &app, const std::string &version, const char *action) {
  if (!has_api() || prefs::device_token().empty()) return;
  JsonDocument d;
  d["app"] = app; d["version"] = version; d["action"] = action;
  std::string body;
  serializeJson(d, body);
  send(T_REPORT, "POST", api("/installs"), body);
}

void finish_install(const rt::AppManifest &m, bool icon_saved) {
  prefs::AppRecord rec;
  bool existed = false;
  for (prefs::AppRecord &a : g_installed) if (a.id == m.id) { rec = a; existed = true; break; }
  if (!existed) rec.install_id = prefs::new_uuid();
  rec.id = m.id; rec.name = m.name; rec.version = m.version; rec.icon = m.icon;
  rec.manifest_url = g_install.manifest_url; rec.orientation = m.orientation; rec.has_icon_file = icon_saved;
  rec.update_version.clear();
  if (existed) { for (prefs::AppRecord &a : g_installed) if (a.id == m.id) a = rec; }
  else g_installed.push_back(rec);
  save_installed();
  report(m.id, m.version, existed ? "update" : "install");
  set_status((existed ? "Updated " : "Installed ") + m.name);
  g_install.active = false;
  set_busy(Busy::NONE);
}

void start_next_update_check() {
  if (g_update_queue.empty()) { set_busy(Busy::NONE); g_update_current.clear(); return; }
  g_update_current = g_update_queue.front();
  g_update_queue.erase(g_update_queue.begin());
  prefs::AppRecord rec;
  if (!is_installed(g_update_current, &rec)) { start_next_update_check(); return; }
  set_busy(Busy::UPDATE_CHECK);
  if (!send(T_UPDATE, "GET", rec.manifest_url, "", rec.manifest_etag, rt::SCREEN_MAX_BYTES)) start_next_update_check();
}
}  // namespace

void begin() {
  reload_installed();
  register_device();
}

void reload_installed() { g_installed = prefs::apps(); g_apps_changed = true; }
const std::vector<prefs::AppRecord> &installed() { return g_installed; }

bool is_installed(const std::string &id, prefs::AppRecord *out) {
  for (const prefs::AppRecord &a : g_installed) if (a.id == id) { if (out) *out = a; return true; }
  return false;
}
bool update_available(const std::string &id, std::string &version) {
  for (const prefs::AppRecord &a : g_installed) if (a.id == id && !a.update_version.empty()) { version = a.update_version; return true; }
  return false;
}
bool min_os_ok(const std::string &min_os) { return rt::compare_versions(hal::board().os_version, min_os.c_str()) >= 0; }

void tick(uint32_t now, int64_t epoch) {
  g_now = now;
  g_epoch = epoch;
  // Only once a code exists: until the response arrives expires_ms is 0, which would read as
  // long past and expire the code before it was ever shown.
  if (g_pair.active && !g_pair.code.empty() && !g_pair.done && !g_pair.expired) {
    if ((int32_t)(now - g_pair.expires_ms) >= 0) { g_pair.expired = true; g_pair.error = "Code expired"; set_busy(Busy::NONE); }
    else if (g_busy != Busy::PAIR_POLL && (int32_t)(now - g_pair.next_poll_ms) >= 0) {
      g_pair.next_poll_ms = now + 5000;
      if (send(T_PAIR_POLL, "GET", api(("/pair/" + g_pair.code).c_str()))) set_busy(Busy::PAIR_POLL);
    }
  }
}

void fetch_index(bool force) {
  if (g_busy == Busy::INDEX) return;
  if (!force && g_index_loaded && (int32_t)(g_now - g_index_fetched_ms) < 300000) return;
  register_device();
  set_busy(Busy::INDEX);
  g_index_error.clear();
  if (!send(T_INDEX, "GET", index_url(), "", g_index_etag, 128 * 1024)) set_busy(Busy::NONE);
}
bool index_loaded() { return g_index_loaded; }
const rt::StoreIndex &index() { return g_index; }
const std::string &index_error() { return g_index_error; }

void fetch_detail(const std::string &id) {
  if (!has_api() || detail(id) || g_busy != Busy::NONE) return;
  set_busy(Busy::DETAIL);
  if (!send(T_DETAIL, "GET", api(("/apps/" + id).c_str()))) set_busy(Busy::NONE);
}
const Detail *detail(const std::string &id) {
  for (const Detail &d : g_details) if (d.id == id) return &d;
  return nullptr;
}

void install_url(const std::string &manifest_url) {
  if (g_install.active) { set_status("Another install is in progress"); return; }
  if (!url::is_absolute(manifest_url)) { set_status("Manifest URL must be absolute"); return; }
  g_install = Install();
  g_install.active = true;
  g_install.manifest_url = manifest_url;
  set_busy(Busy::INSTALL_MANIFEST);
  set_status("Fetching manifest…");
  if (!send(T_MANIFEST, "GET", manifest_url, "", "", rt::SCREEN_MAX_BYTES)) { g_install.active = false; set_busy(Busy::NONE); }
}
void install(const rt::StoreApp &app) {
  if (!min_os_ok(app.min_os)) { set_status("Needs QuireOS " + app.min_os); return; }
  install_url(app.manifest);
  g_install.name = app.name;
}
void update(const std::string &id) {
  prefs::AppRecord rec;
  if (!is_installed(id, &rec)) return;
  install_url(rec.manifest_url);
  g_install.is_update = true;
  g_install.name = rec.name;
}

void uninstall(const std::string &id) {
  prefs::AppRecord rec;
  if (!is_installed(id, &rec)) return;
  hal::Storage *st = hal::board().storage;
  if (st) st->file_remove(("/apps/" + id).c_str());
  prefs::remove_app_settings(id.c_str());
  for (size_t i = 0; i < g_installed.size(); i++) if (g_installed[i].id == id) { g_installed.erase(g_installed.begin() + (long)i); break; }
  save_installed();
  report(id, rec.version, "uninstall");
  set_status("Uninstalled " + rec.name);
}

void check_updates(bool force) {
  if (g_installed.empty()) return;
  if (!force && g_epoch && g_epoch - prefs::last_update_check() < 86400) return;
  if (g_busy != Busy::NONE) return;
  prefs::set_last_update_check(g_epoch);
  g_update_queue.clear();
  for (const prefs::AppRecord &a : g_installed) g_update_queue.push_back(a.id);
  start_next_update_check();
}

void pair_start() {
  if (g_busy != Busy::NONE) return;
  if (!has_api()) { g_pair = Pairing(); g_pair.active = true; g_pair.error = "This store has no accounts"; g_changed = true; return; }
  if (prefs::device_token().empty()) { register_device(); set_status("Registering device…"); g_pair = Pairing(); g_pair.active = true; g_pair.error = "Registering…"; return; }
  g_pair = Pairing();
  g_pair.active = true;
  set_busy(Busy::PAIR_START);
  if (!send(T_PAIR_START, "POST", api("/pair"), "{}")) { set_busy(Busy::NONE); g_pair.error = "Could not start pairing"; }
}
void pair_cancel() { g_pair = Pairing(); g_changed = true; }
const Pairing &pairing() { return g_pair; }

Busy busy() { return g_busy; }
const std::string &status() { return g_status; }
bool take_changed() { bool c = g_changed; g_changed = false; return c; }
bool take_apps_changed() { bool c = g_apps_changed; g_apps_changed = false; return c; }

bool on_response(net::Response &res) {
  if (res.owner != net::OWNER_STORE) return false;
  const char *body = (const char *)(res.body ? res.body : (const uint8_t *)"");
  switch (res.tag) {
    case T_REGISTER: {
      g_registering = false;
      if (res.error || res.status != 200) { hal::log(hal::LOG_WARN, TAG, "device registration failed (%d/%d)", res.status, res.error); break; }
      JsonDocument d;
      if (deserializeJson(d, body, res.len)) break;
      const char *tok = d["token"] | (const char *)nullptr;
      const char *id = d["device_id"] | (const char *)nullptr;
      if (tok && id) { prefs::set_device(id, tok); set_status("Device registered"); if (g_pair.active && g_pair.code.empty()) { g_pair = Pairing(); pair_start(); } }
      break;
    }
    case T_INDEX: {
      set_busy(Busy::NONE);
      if (res.error) { g_index_error = res.error == hal::HTTP_ERR_OFFLINE ? "Offline" : "Could not reach the store"; break; }
      if (res.status == 304) { g_index_fetched_ms = g_now; break; }
      if (res.status != 200) { char b[48]; snprintf(b, sizeof b, "Store error %d", res.status); g_index_error = b; break; }
      rt::StoreIndex idx;
      rt::ParseResult pr = rt::parse_index(body, res.len, idx);
      if (!pr.ok()) { g_index_error = pr.error; break; }
      g_index = idx;
      g_index_loaded = true;
      g_index_etag = res.etag;
      g_index_fetched_ms = g_now;
      g_changed = true;
      break;
    }
    case T_DETAIL: {
      set_busy(Busy::NONE);
      if (res.error || res.status != 200) break;
      JsonDocument d;
      if (deserializeJson(d, body, res.len)) break;
      Detail det;
      det.id = d["id"] | "";
      det.description = d["description"] | "";
      for (JsonVariantConst s : d["screenshots"].as<JsonArrayConst>()) if (s.is<const char *>()) det.screenshots.push_back(s.as<const char *>());
      for (JsonVariantConst s : d["changelog"].as<JsonArrayConst>()) {
        if (s.is<const char *>()) det.changelog.push_back(s.as<const char *>());
        else if (s.is<JsonObjectConst>()) det.changelog.push_back(std::string(s["version"] | "") + ": " + (s["notes"] | ""));
      }
      if (!det.id.empty()) g_details.push_back(det);
      break;
    }
    case T_MANIFEST: {
      if (!g_install.active) break;
      if (res.error || res.status != 200) { set_status(res.error ? "Could not fetch the manifest" : "Manifest error " + std::to_string(res.status)); g_install.active = false; set_busy(Busy::NONE); break; }
      rt::ParseResult pr = rt::parse_manifest(body, res.len, g_install.manifest);
      if (pr.status == rt::ParseStatus::UPDATE_OS) { set_status("This app needs a newer QuireOS"); g_install.active = false; set_busy(Busy::NONE); break; }
      if (!pr.ok()) { set_status(std::string("Invalid manifest: ") + pr.error); g_install.active = false; set_busy(Busy::NONE); break; }
      rt::AppManifest &m = g_install.manifest;
      if (!min_os_ok(m.min_os)) { set_status("Needs QuireOS " + m.min_os); g_install.active = false; set_busy(Busy::NONE); break; }
      hal::Storage *st = hal::board().storage;
      std::string dir = std::string("/apps/") + m.id;
      if (st) { st->file_mkdir("/apps"); st->file_mkdir(dir.c_str()); }
      if (!st || !st->file_write((dir + "/manifest.json").c_str(), res.body, res.len)) { set_status("Could not save the manifest"); g_install.active = false; set_busy(Busy::NONE); break; }
      for (prefs::AppRecord &a : g_installed) if (a.id == m.id) a.manifest_etag = res.etag;
      if (url::is_absolute(m.icon)) {
        set_busy(Busy::INSTALL_ICON);
        set_status("Fetching icon…");
        if (!send(T_ICON, "GET", m.icon, "", "", 64 * 1024, "image/png")) finish_install(m, false);
      } else {
        finish_install(m, false);
      }
      break;
    }
    case T_ICON: {
      if (!g_install.active) break;
      bool saved = false;
      if (!res.error && res.status == 200 && res.body) {
        rt::ImageBuf img;
        if (rt::png_decode(res.body, res.len, 96, 96, img)) {
          std::vector<uint8_t> blob(4 + img.bytes());
          blob[0] = 96; blob[1] = 0; blob[2] = 96; blob[3] = 0;
          memcpy(blob.data() + 4, img.data, img.bytes());
          std::string path = std::string("/apps/") + g_install.manifest.id + "/icon.bin";
          saved = hal::board().storage && hal::board().storage->file_write(path.c_str(), blob.data(), blob.size());
          rt::image_free(img);
        }
      }
      finish_install(g_install.manifest, saved);
      break;
    }
    case T_UPDATE: {
      if (!res.error && res.status == 200) {
        rt::AppManifest m;
        rt::ParseResult pr = rt::parse_manifest(body, res.len, m);
        if (pr.ok()) {
          for (prefs::AppRecord &a : g_installed) if (a.id == g_update_current) {
            a.manifest_etag = res.etag;
            if (rt::compare_versions(m.version.c_str(), a.version.c_str()) > 0 && min_os_ok(m.min_os)) { a.update_version = m.version; set_status("Update available: " + a.name + " " + m.version); }
            else a.update_version.clear();
          }
          save_installed();
        }
      }
      start_next_update_check();
      break;
    }
    case T_PAIR_START: {
      set_busy(Busy::NONE);
      if (res.error || res.status != 200) { g_pair.error = res.status == 401 ? "Device not registered" : "Could not start pairing"; g_pair.active = false; g_changed = true; break; }
      JsonDocument d;
      if (deserializeJson(d, body, res.len)) { g_pair.error = "Bad pairing response"; g_changed = true; break; }
      g_pair.code = d["code"] | "";
      int expires = d["expires_in"] | 600;
      g_pair.expires_ms = g_now + (uint32_t)expires * 1000u;
      g_pair.next_poll_ms = g_now + 5000;
      g_pair.url = prefs::store_url() + "/pair";
      g_pair.expired = false;
      g_pair.error.clear();
      g_changed = true;
      break;
    }
    case T_PAIR_POLL: {
      set_busy(Busy::NONE);
      if (res.error) break;
      if (res.status == 200) {
        JsonDocument d;
        deserializeJson(d, body, res.len);
        std::string user = d["user"]["login"] | (d["user"] | "");
        g_pair.done = true;
        g_pair.user = user;
        prefs::set_paired_user(user.empty() ? "paired" : user);
        set_status("Paired with " + (user.empty() ? std::string("account") : user));
        g_index_etag.clear();
        g_index_loaded = false;
      } else if (res.status == 410) { g_pair.expired = true; g_pair.error = "Code expired"; g_changed = true; }
      break;
    }
    case T_REPORT: break;
    default: break;
  }
  return true;
}

}  // namespace store
}  // namespace os
}  // namespace quire
