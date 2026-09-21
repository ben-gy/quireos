#include "prefs.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../hal/hal.h"
#include "../runtime/third_party/ArduinoJson.h"

namespace quire {
namespace os {
namespace prefs {

static const char *TAG = "prefs";

void begin() {
  if (tz().empty()) set_tz("Australia/Sydney");
}

std::string get(const char *key, const char *def) {
  char buf[2100];
  if (hal::board().storage && hal::board().storage->kv_get(key, buf, sizeof buf)) return buf;
  return def ? def : "";
}
void set(const char *key, const std::string &value) {
  if (value.size() > 2048) { hal::log(hal::LOG_WARN, TAG, "value for %s over 2 kB, not saved", key); return; }
  if (hal::board().storage) hal::board().storage->kv_set(key, value.c_str());
}
void remove(const char *key) { if (hal::board().storage) hal::board().storage->kv_remove(key); }
int get_int(const char *key, int def) {
  std::string v = get(key, "");
  return v.empty() ? def : atoi(v.c_str());
}
void set_int(const char *key, int value) { set(key, std::to_string(value)); }

std::string store_url() {
  std::string u = get("store_url", QUIRE_STORE_URL);
  while (!u.empty() && u.back() == '/') u.pop_back();
  return u;
}
void set_store_url(const std::string &u) { if (u.empty()) remove("store_url"); else set("store_url", u); }
std::string device_token() { return get("dev_token"); }
std::string device_id() { return get("dev_id"); }
void set_device(const std::string &id, const std::string &token) { set("dev_id", id); set("dev_token", token); }
std::string paired_user() { return get("paired"); }
void set_paired_user(const std::string &login) { if (login.empty()) remove("paired"); else set("paired", login); }

std::vector<AppRecord> apps() {
  std::vector<AppRecord> out;
  std::string json = get("apps", "[]");
  JsonDocument doc;
  if (deserializeJson(doc, json)) return out;
  for (JsonObjectConst o : doc.as<JsonArrayConst>()) {
    AppRecord a;
    a.id = o["id"] | "";
    if (a.id.empty()) continue;
    a.name = o["name"] | a.id.c_str();
    a.version = o["version"] | "";
    a.icon = o["icon"] | "";
    a.manifest_url = o["manifest"] | "";
    a.install_id = o["install_id"] | "";
    a.orientation = o["orientation"] | "portrait";
    a.manifest_etag = o["etag"] | "";
    a.update_version = o["update"] | "";
    a.has_icon_file = o["icon_file"] | false;
    out.push_back(a);
  }
  return out;
}

void save_apps(const std::vector<AppRecord> &apps) {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (const AppRecord &a : apps) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = a.id; o["name"] = a.name; o["version"] = a.version; o["icon"] = a.icon;
    o["manifest"] = a.manifest_url; o["install_id"] = a.install_id; o["orientation"] = a.orientation;
    if (!a.manifest_etag.empty()) o["etag"] = a.manifest_etag;
    if (!a.update_version.empty()) o["update"] = a.update_version;
    if (a.has_icon_file) o["icon_file"] = true;
  }
  std::string json;
  serializeJson(doc, json);
  set("apps", json);
}

bool find_app(const char *id, AppRecord &out) {
  for (const AppRecord &a : apps()) if (a.id == id) { out = a; return true; }
  return false;
}

static std::string cfg_key(const char *id) { return std::string("cfg/") + id; }
std::string app_settings(const char *id) { std::string v = get(cfg_key(id).c_str(), "{}"); return v.empty() ? "{}" : v; }
bool set_app_settings(const char *id, const std::string &json) {
  if (json.size() > 2048) return false;
  set(cfg_key(id).c_str(), json);
  return true;
}
void remove_app_settings(const char *id) { remove(cfg_key(id).c_str()); }

int sleep_timeout_s() { return get_int("sleep_s", 300); }
void set_sleep_timeout_s(int s) { set_int("sleep_s", s); }
int frontlight() { return get_int("frontlight", 0); }
void set_frontlight(int l) { set_int("frontlight", l < 0 ? 0 : l > 3 ? 3 : l); }
std::string tz() { return get("tz", ""); }
void set_tz(const std::string &name) { set("tz", name); }
std::string web_password() { return get("web_pw"); }
void set_web_password(const std::string &pw) { if (pw.empty()) remove("web_pw"); else set("web_pw", pw); }
int refresh_policy() { return get_int("refresh", 0); }
void set_refresh_policy(int p) { set_int("refresh", p); }
std::string device_name() { std::string n = get("name"); return n.empty() ? "QuireOS" : n; }
void set_device_name(const std::string &n) { if (n.empty()) remove("name"); else set("name", n); }
int64_t last_update_check() { return (int64_t)atoll(get("upd_check", "0").c_str()); }
void set_last_update_check(int64_t e) { char b[24]; snprintf(b, sizeof b, "%lld", (long long)e); set("upd_check", b); }

std::string new_uuid() {
  uint32_t r[4] = {hal::random_u32(), hal::random_u32(), hal::random_u32(), hal::random_u32()};
  r[1] = (r[1] & 0xFFFF0FFFu) | 0x00004000u;   // version 4
  r[2] = (r[2] & 0x3FFFFFFFu) | 0x80000000u;   // variant
  char b[40];
  snprintf(b, sizeof b, "%08x-%04x-%04x-%04x-%04x%08x", r[0], r[1] >> 16, r[1] & 0xFFFF, r[2] >> 16, r[2] & 0xFFFF, r[3]);
  return b;
}

}  // namespace prefs
}  // namespace os
}  // namespace quire
