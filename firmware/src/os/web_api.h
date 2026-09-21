// The device's LAN settings page and JSON API, as a pure request handler.
//
// Boards own the HTTP listener (an Arduino WebServer on ESP32, the emulator's server on the host)
// and forward every request under /os to quire::os::web::handle(). This keeps the OS core free of
// any web-server library. Handlers are called from the listener's context; the implementation is
// thread-safe and only touches OS state through a mailbox drained in quire::os::loop().
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace quire {
namespace os {
namespace web {

struct Request {
  const char *method = "GET";     // GET or POST
  const char *path = "/os";       // path without query, always starts with /os
  const char *query = "";         // raw query string without '?', may be empty
  const char *body = nullptr;     // request body (JSON for the API), may be null
  size_t body_len = 0;
  const char *authorization = nullptr;  // raw Authorization header or null
  const char *remote = "";        // peer address, for logs
};

struct Response {
  int status = 200;
  const char *content_type = "application/json";
  const uint8_t *body = nullptr;
  size_t len = 0;
  bool gzip = false;              // body is gzip-compressed; listener adds Content-Encoding: gzip
  bool must_free = false;         // listener calls release() after sending
  const char *extra_header = nullptr;   // one extra "Name: value" header (e.g. WWW-Authenticate) or null
};

// Handle one request. Returns a complete response; call release() afterwards.
Response handle(const Request &req);
void release(Response &res);

// ---- OS side (called from quire::os::loop(), never from the listener) ----
struct Command {
  enum Type : uint8_t { NONE = 0, STORE_URL, APP_SETTINGS, INSTALL, UNINSTALL, PAIR, REFRESH, REBOOT, WIFI_FORGET,
                        PREFS, OPEN_APP, CHECK_UPDATES, HOME } type = NONE;
  char a[512] = {0};        // id or URL
  char *b = nullptr;        // JSON payload (heap, freed by take_command's caller via free_command)
};
bool take_command(Command &out);
void free_command(Command &c);
// Publish the read-only state snapshot and the per-app settings schemas (JSON) for validation.
void publish(const char *state_json, const char *schemas_json);

}  // namespace web
}  // namespace os
}  // namespace quire
