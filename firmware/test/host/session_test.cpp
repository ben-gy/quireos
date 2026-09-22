// AppSession request building: header handling, secret gating and origin policy (SPEC §8.4).
#include "../../src/runtime/session.h"
#include "test_util.h"

using namespace quire;
using namespace quire::rt;

namespace {

// A Fetcher that accepts everything and keeps the last request, so build_request can be exercised
// without a network or an event loop.
struct NullFetcher : Fetcher {
  bool fetch(const FetchRequest &req) override { return true; }
};

const char *MANIFEST = R"({
  "spec_version": 1, "id": "ha-lights", "name": "HA Lights", "version": "1.0.0", "min_os": "0.1.0",
  "icon": "lightbulb", "orientation": "portrait", "entry": "/screens/home.json", "event": "/event",
  "hosts": ["{{settings.ha_url}}"],
  "settings": [
    { "key": "ha_url", "label": "URL", "type": "url", "required": true },
    { "key": "ha_token", "label": "Token", "type": "secret", "required": true }
  ]
})";

const char *SETTINGS = R"({"ha_url":"http://192.168.1.10:8123","ha_token":"SECRET-TOKEN"})";

int count_header(const std::vector<std::string> &headers, const char *lower_name) {
  int n = 0;
  const size_t len = strlen(lower_name);
  for (const std::string &h : headers) {
    if (h.size() <= len || h[len] != ':') continue;
    bool same = true;
    for (size_t i = 0; i < len && same; i++) {
      char c = h[i];
      if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
      same = c == lower_name[i];
    }
    if (same) n++;
  }
  return n;
}

bool header_value(const std::vector<std::string> &headers, const char *name, std::string &out) {
  for (const std::string &h : headers) {
    if (h.rfind(name, 0) == 0 && h.size() > strlen(name) && h[strlen(name)] == ':') {
      size_t v = strlen(name) + 1;
      while (v < h.size() && h[v] == ' ') v++;
      out = h.substr(v);
      return true;
    }
  }
  return false;
}

// Builds a POST the way an `http` action does, with whatever headers the app declared.
bool build_post(AppSession &s, const char *headers_json, FetchRequest &out, std::string &err) {
  JsonDocument h, b;
  deserializeJson(h, headers_json);
  deserializeJson(b, R"({"entity_id":"switch.garage_outside"})");
  return s.build_request("{{settings.ha_url}}/api/services/switch/toggle", h.as<JsonVariantConst>(),
                         b.as<JsonVariantConst>(), false, "POST", out, err);
}

}  // namespace

int main(int argc, char **argv) {
  NullFetcher fetcher;
  DeviceInfo dev;
  AppSession s;
  ParseResult pr = parse_manifest(MANIFEST, strlen(MANIFEST), s.manifest);
  CHECK(pr.ok(), "manifest parse: %s", pr.error);
  CHECK(s.open(&fetcher, "https://app.example.com/manifest.json", "install-1", SETTINGS, dev),
        "session open failed");

  FetchRequest req;
  std::string err;

  // Regression: an app that declares Content-Type must not get a second one from the OS. Home
  // Assistant (aiohttp) answers 400 to a duplicate.
  CHECK(build_post(s, R"({"Authorization":"Bearer {{settings.ha_token}}","Content-Type":"application/json"})", req, err),
        "declared Content-Type: %s", err.c_str());
  CHECK(count_header(req.headers, "content-type") == 1, "expected exactly one Content-Type, got %d",
        count_header(req.headers, "content-type"));
  CHECK(req.body == R"({"entity_id":"switch.garage_outside"})", "body was %s", req.body.c_str());

  // Case and spacing must not defeat the check.
  req = FetchRequest();
  CHECK(build_post(s, R"({"content-TYPE":"application/json; charset=utf-8"})", req, err), "mixed case: %s", err.c_str());
  CHECK(count_header(req.headers, "content-type") == 1, "mixed-case duplicate: %d",
        count_header(req.headers, "content-type"));

  // Without a declared one the OS still supplies it for a JSON body.
  req = FetchRequest();
  CHECK(build_post(s, R"({"Authorization":"Bearer {{settings.ha_token}}"})", req, err), "no Content-Type: %s", err.c_str());
  CHECK(count_header(req.headers, "content-type") == 1, "OS should add Content-Type, got %d",
        count_header(req.headers, "content-type"));

  // A header whose name merely starts the same is left alone.
  req = FetchRequest();
  CHECK(build_post(s, R"({"Content-Type-Hint":"x"})", req, err), "prefix header: %s", err.c_str());
  CHECK(count_header(req.headers, "content-type") == 1, "prefix name confused the check: %d",
        count_header(req.headers, "content-type"));
  CHECK(count_header(req.headers, "content-type-hint") == 1, "prefix header lost");

  // Secrets resolve for the declared LAN host...
  std::string auth;
  req = FetchRequest();
  CHECK(build_post(s, R"({"Authorization":"Bearer {{settings.ha_token}}"})", req, err), "secret to host: %s", err.c_str());
  CHECK(header_value(req.headers, "Authorization", auth) && auth == "Bearer SECRET-TOKEN",
        "secret not substituted for the declared host (got '%s')", auth.c_str());

  // ...and never for the app's own origin, which the manifest did not list in hosts.
  {
    JsonDocument h, b;
    deserializeJson(h, R"({"Authorization":"Bearer {{settings.ha_token}}"})");
    deserializeJson(b, R"({"x":1})");
    FetchRequest bad;
    std::string e2;
    bool ok = s.build_request("https://app.example.com/steal", h.as<JsonVariantConst>(), b.as<JsonVariantConst>(),
                              false, "POST", bad, e2);
    CHECK(!ok, "a secret sent to the app origin must be refused");
  }

  // An origin outside the manifest hosts is refused outright.
  {
    JsonDocument h, b;
    deserializeJson(h, "{}");
    deserializeJson(b, "{}");
    FetchRequest bad;
    std::string e2;
    bool ok = s.build_request("https://evil.example.com/x", h.as<JsonVariantConst>(), b.as<JsonVariantConst>(),
                              false, "POST", bad, e2);
    CHECK(!ok, "undeclared origin must be refused");
  }

  return finish("session_test");
}
