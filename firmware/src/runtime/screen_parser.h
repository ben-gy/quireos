// JSON documents → typed structures with every cap and default from SPEC §4-§6 and §8.2.
#pragma once
#include <string>
#include <vector>
#include "widgets.h"

namespace quire {
namespace rt {

enum class ParseStatus : uint8_t { OK = 0, INVALID, UPDATE_OS, TOO_BIG };
struct ParseResult {
  ParseStatus status = ParseStatus::OK;
  char error[160] = {0};
  bool ok() const { return status == ParseStatus::OK; }
};

static const size_t SCREEN_MAX_BYTES = 32 * 1024;
static const size_t DATA_MAX_BYTES = 16 * 1024;
static const size_t IMAGE_MAX_BYTES = 256 * 1024;
static const size_t STRING_MAX_BYTES = 512;
static const int MAX_DATA = 8, MAX_VARS = 16, MAX_IMAGES = 2, MAX_HISTORY = 8;
static const int SPEC_VERSION = 1;

enum class Refresh : uint8_t { AUTO = 0, PARTIAL, FULL };

struct DataSource {
  char id[33] = {0};
  JsonVariantConst url, headers, body;
  bool post = false, body_raw = false, required = false;
  int ttl = 0;               // seconds; 0 = only with the screen
};
struct VarDef { char name[33] = {0}; JsonVariantConst value; };
struct ImageSlot { int widget = -1; int ttl = 0; bool ttl_set = false; };

struct ScreenMeta {
  char id[33] = {0};
  std::string url;           // canonical, may be empty (= the fetched URL)
  int ttl = 300;
  Refresh refresh = Refresh::AUTO;
  DataSource data[MAX_DATA];
  int data_count = 0;
  VarDef vars[MAX_VARS];
  int var_count = 0;
  ImageSlot images[MAX_IMAGES];
  int image_count = 0;
  bool uses_device_time = false;
  JsonVariantConst key_short, key_double;   // §6 `keys`: actions for the function button
};

// A parsed screen keeps its JsonDocument alive: widgets reference template strings and actions in it.
struct ParsedScreen {
  JsonDocument doc;
  WidgetTree tree;
  ScreenMeta meta;
  void clear() { doc.clear(); tree.clear(); meta = ScreenMeta(); }
};

ParseResult parse_screen(const char *json, size_t len, ParsedScreen &out);

// ---- manifest (SPEC §5) ----
enum class SType : uint8_t { STRING = 0, SECRET, URL, NUMBER, BOOL, SELECT, LIST };
struct SettingDef {
  char key[33] = {0};
  std::string label, help;
  SType type = SType::STRING;
  bool required = false;
  JsonVariantConst def;      // default value (never for secrets)
  JsonVariantConst options;  // select: [{value,label}]
  JsonVariantConst item;     // list: Setting[] of scalars
  double min = 0, max = 0;
  bool has_min = false, has_max = false;
};
struct AppManifest {
  JsonDocument doc;
  int spec_version = 1;
  char id[33] = {0};
  std::string name, version, min_os, icon, entry, event, orientation;
  std::vector<std::string> hosts;
  std::vector<std::string> screens;
  std::vector<SettingDef> settings;
  bool landscape() const { return orientation == "landscape"; }
  const SettingDef *setting(const char *key) const {
    for (const SettingDef &s : settings) if (strcmp(s.key, key) == 0) return &s;
    return nullptr;
  }
};
ParseResult parse_manifest(const char *json, size_t len, AppManifest &out);

// ---- store index (SPEC §4) ----
struct StoreApp {
  std::string id, name, tagline, icon, version, manifest, min_os, author, kind, visibility;
  std::vector<std::string> screens, categories;
  int installs = 0;
};
struct StoreIndex { std::string name, updated; std::vector<StoreApp> apps; };
ParseResult parse_index(const char *json, size_t len, StoreIndex &out);

// ---- error body (SPEC §8.2) ----
bool parse_error_body(const char *json, size_t len, std::string &code, std::string &message);

// ---- shared validators ----
bool valid_id(const char *s, bool app_id = false);
bool parse_version(const char *s, int out[3]);
int compare_versions(const char *a, const char *b);   // <0, 0, >0; unparsable sorts first
const char *stype_name(SType t);
bool stype_from_name(const char *s, SType &out);

}  // namespace rt
}  // namespace quire
