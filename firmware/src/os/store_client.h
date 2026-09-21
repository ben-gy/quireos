// Device side of the store service API (SPEC §9) plus the local install bookkeeping.
#pragma once
#include <string>
#include <vector>
#include "../runtime/screen_parser.h"
#include "net_task.h"
#include "prefs.h"

namespace quire {
namespace os {
namespace store {

enum class Busy : uint8_t { NONE = 0, REGISTER, INDEX, DETAIL, INSTALL_MANIFEST, INSTALL_ICON, UPDATE_CHECK, PAIR_START, PAIR_POLL, REPORT };

struct Detail {
  std::string id, description;
  std::vector<std::string> screenshots, changelog;
};
struct Pairing {
  bool active = false, done = false, expired = false;
  std::string code, url, user, error;
  uint32_t expires_ms = 0, next_poll_ms = 0;
};

void begin();
void tick(uint32_t now_ms, int64_t epoch);
bool on_response(net::Response &res);           // true when the response was ours

void fetch_index(bool force);
bool index_loaded();
const rt::StoreIndex &index();
const std::string &index_error();

void fetch_detail(const std::string &id);
const Detail *detail(const std::string &id);

void install(const rt::StoreApp &app);         // from the index
void install_url(const std::string &manifest_url);
void uninstall(const std::string &id);
void update(const std::string &id);            // re-installs from the newest manifest
void check_updates(bool force);

const std::vector<prefs::AppRecord> &installed();
void reload_installed();
bool is_installed(const std::string &id, prefs::AppRecord *out = nullptr);
bool update_available(const std::string &id, std::string &version);
bool min_os_ok(const std::string &min_os);

void pair_start();
void pair_cancel();
const Pairing &pairing();

Busy busy();
const std::string &status();                   // last human-readable status line
bool take_changed();                           // true once after any state change (UI refresh)
bool take_apps_changed();                      // installed set changed (launcher refresh)

}  // namespace store
}  // namespace os
}  // namespace quire
