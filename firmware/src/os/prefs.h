// Typed accessors over hal::Storage::kv. Keys are short (NVS limits keys to 15 characters; boards
// whose kv cannot take longer keys must hash them, see docs/porting.md).
#pragma once
#include <string>
#include <vector>

#ifndef QUIRE_STORE_URL
#define QUIRE_STORE_URL "https://quireos-store.ben-gy.workers.dev"
#endif

namespace quire {
namespace os {
namespace prefs {

struct AppRecord {
  std::string id, name, version, icon, manifest_url, install_id, orientation, manifest_etag, update_version;
  bool has_icon_file = false;
};

void begin();
std::string get(const char *key, const char *def = "");
void set(const char *key, const std::string &value);
void remove(const char *key);
int get_int(const char *key, int def);
void set_int(const char *key, int value);

std::string store_url();
void set_store_url(const std::string &url);
std::string device_token();
std::string device_id();
void set_device(const std::string &device_id, const std::string &token);
std::string paired_user();
void set_paired_user(const std::string &login);

std::vector<AppRecord> apps();
void save_apps(const std::vector<AppRecord> &apps);
bool find_app(const char *id, AppRecord &out);

// Per-app settings: a JSON object (≤ 2 kB) with secrets included.
std::string app_settings(const char *id);
bool set_app_settings(const char *id, const std::string &json);
void remove_app_settings(const char *id);

int sleep_timeout_s();          // 0 = never
void set_sleep_timeout_s(int s);
int frontlight();               // 0..3
void set_frontlight(int level);
std::string tz();               // IANA name
void set_tz(const std::string &name);
std::string web_password();     // empty = no auth on the LAN page
void set_web_password(const std::string &pw);
int refresh_policy();           // 0 auto, 1 prefer partial, 2 always full
void set_refresh_policy(int p);
std::string device_name();
void set_device_name(const std::string &name);
int64_t last_update_check();
void set_last_update_check(int64_t epoch);

std::string new_uuid();

}  // namespace prefs
}  // namespace os
}  // namespace quire
