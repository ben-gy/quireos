// Runs spec/conformance/screens/cases.json through parse_screen(). Valid documents must parse.
// Invalid documents fall in two groups: hard limits the device must reject (SPEC §8.5), and
// authoring errors the device handles softly (skip the widget / empty string / log). The soft
// group must at least not crash and is reported.
#include "../../src/runtime/screen_parser.h"
#include "test_util.h"

using namespace quire;

// Rules the device must reject (file name prefixes).
static const char *const HARD[] = {
  "invalid-spec-version-unsupported", "invalid-spec-version-type", "invalid-id-missing", "invalid-id-pattern",
  "invalid-widgets-missing", "invalid-widgets-not-array", "invalid-widgets-limit", "invalid-data-limit",
  "invalid-data-id-reserved", "invalid-data-id-duplicate", "invalid-data-id-pattern", "invalid-data-missing-url",
  "invalid-vars-limit", "invalid-vars-key-pattern", "invalid-image-limit", "invalid-string-too-long",
  "invalid-document-too-large",
};

static bool is_hard(const std::string &file) {
  for (const char *h : HARD) if (file.compare(0, strlen(h), h) == 0) return true;
  return false;
}

int main(int argc, char **argv) {
  std::string root = repo_root(argc, argv);
  std::string dir = root + "/spec/conformance/screens/";
  std::string text;
  if (!read_file(dir + "cases.json", text)) { printf("missing %scases.json\n", dir.c_str()); return 1; }
  JsonDocument doc;
  deserializeJson(doc, text);
  int n = 0, soft_accepted = 0, soft_rejected = 0;
  rt::ParsedScreen screen;
  for (JsonObjectConst c : doc["cases"].as<JsonArrayConst>()) {
    n++;
    std::string file = c["file"] | "";
    bool valid = c["valid"] | false;
    std::string body;
    if (!read_file(dir + file, body)) { CHECK(false, "cannot read %s", file.c_str()); continue; }
    rt::ParseResult r = rt::parse_screen(body.c_str(), body.size(), screen);
    if (valid) {
      CHECK(r.ok(), "%s should parse: %s", file.c_str(), r.error);
      if (r.ok()) CHECK(screen.tree.count() >= 0 && screen.meta.id[0] != 0, "%s has an id", file.c_str());
    } else if (is_hard(file)) {
      CHECK(!r.ok(), "%s must be rejected (%s)", file.c_str(), c["rule"] | "");
      if (file.compare(0, 31, "invalid-spec-version-unsupported") == 0) CHECK(r.status == rt::ParseStatus::UPDATE_OS, "newer spec_version -> UPDATE_OS");
      if (file.compare(0, 26, "invalid-document-too-large") == 0) CHECK(r.status == rt::ParseStatus::TOO_BIG, "oversize -> TOO_BIG");
    } else {
      if (r.ok()) soft_accepted++; else soft_rejected++;
    }
  }
  // Grid expansion and defaults on the spec example.
  std::string ex;
  if (read_file(dir + "valid-spec-example.json", ex)) {
    rt::ParseResult r = rt::parse_screen(ex.c_str(), ex.size(), screen);
    CHECK(r.ok(), "spec example parses: %s", r.error);
    bool found_button = false;
    for (int i = 0; i < screen.tree.count(); i++) {
      const rt::Widget &w = screen.tree[i];
      if (w.type == rt::WType::BUTTON) { found_button = true; CHECK(w.r.x == 24 && w.r.y == 100 && w.r.w == 238 && w.r.h == 190, "grid child gets the cell rect (%d,%d %dx%d)", w.r.x, w.r.y, w.r.w, w.r.h); }
    }
    CHECK(found_button, "grid child expanded");
    CHECK(screen.meta.data_count == 1 && !strcmp(screen.meta.data[0].id, "e0"), "data source parsed");
    CHECK(screen.meta.data[0].ttl == 30, "data ttl");
    CHECK(screen.meta.ttl == 0, "screen ttl 0");
  }
  // Manifest, index and error body.
  {
    const char *m = "{\"spec_version\":1,\"id\":\"ha-lights\",\"name\":\"HA Lights\",\"version\":\"1.0.0\",\"min_os\":\"0.1.0\",\"icon\":\"lightbulb\",\"entry\":\"/home.json\",\"hosts\":[\"{{settings.ha_url}}\"],\"settings\":[{\"key\":\"ha_url\",\"label\":\"URL\",\"type\":\"url\",\"required\":true},{\"key\":\"tok\",\"label\":\"Token\",\"type\":\"secret\"},{\"key\":\"entities\",\"label\":\"E\",\"type\":\"list\",\"max\":8,\"item\":[{\"key\":\"id\",\"label\":\"Id\",\"type\":\"string\"}]}]}";
    rt::AppManifest am;
    rt::ParseResult r = rt::parse_manifest(m, strlen(m), am);
    CHECK(r.ok(), "manifest parses: %s", r.error);
    CHECK(am.settings.size() == 3 && am.settings[1].type == rt::SType::SECRET, "manifest settings");
    CHECK(am.setting("entities") && am.setting("entities")->has_max && am.setting("entities")->max == 8, "list max");
    const char *bad = "{\"spec_version\":1,\"id\":\"Bad_Id\",\"name\":\"x\",\"version\":\"1\",\"min_os\":\"0.1.0\",\"icon\":\"x\",\"entry\":\"/\"}";
    CHECK(!rt::parse_manifest(bad, strlen(bad), am).ok(), "bad manifest rejected");
    const char *idx = "{\"spec_version\":1,\"store\":{\"name\":\"S\",\"updated\":\"x\"},\"apps\":[{\"id\":\"hello\",\"name\":\"Hello\",\"tagline\":\"t\",\"icon\":\"star\",\"version\":\"1.0.0\",\"manifest\":\"https://s/a/hello/1.0.0/manifest.json\",\"min_os\":\"0.1.0\"}]}";
    rt::StoreIndex si;
    CHECK(rt::parse_index(idx, strlen(idx), si).ok() && si.apps.size() == 1 && si.apps[0].id == "hello", "index parses");
    std::string code, msg;
    const char *eb = "{\"spec_version\":1,\"error\":{\"code\":\"settings_missing\",\"message\":\"Add token\"}}";
    CHECK(rt::parse_error_body(eb, strlen(eb), code, msg) && code == "settings_missing" && msg == "Add token", "error body");
    CHECK(rt::compare_versions("1.2.0", "1.10.0") < 0 && rt::compare_versions("0.1.0", "0.1.0") == 0, "version compare");
    CHECK(rt::valid_id("ha-lights", true) && !rt::valid_id("ha_lights", true) && rt::valid_id("ha_lights", false), "id rules");
  }
  printf("  %d screen cases (soft rules: %d accepted with skips, %d rejected)\n", n, soft_accepted, soft_rejected);
  return finish("parser_test");
}
