// The LAN listener: an Arduino WebServer on port 80 that forwards every request under /os to
// quire::os::web::handle(). In the probe build (QUIREOS_PROBE) the OS core is absent and a stub
// answers instead.
#include <Arduino.h>
#include <WebServer.h>
#include <string.h>

#include "board_t5pro.h"
#ifndef QUIREOS_PROBE
#include "os/web_api.h"
#endif

namespace quire {
namespace t5pro {
namespace {

const char *const TAG = "web";
WebServer *g_srv = nullptr;

#ifdef QUIREOS_PROBE
namespace stub {
struct Request {
  const char *method = "GET";
  const char *path = "/os";
  const char *query = "";
  const char *body = nullptr;
  size_t body_len = 0;
  const char *authorization = nullptr;
  const char *remote = "";
};
struct Response {
  int status = 200;
  const char *content_type = "application/json";
  const uint8_t *body = nullptr;
  size_t len = 0;
  bool gzip = false;
  bool must_free = false;
};
Response handle(const Request &) {
  static const char body[] = "{\"probe\":true,\"board\":\"t5pro\"}";
  Response r;
  r.body = (const uint8_t *)body;
  r.len = sizeof(body) - 1;
  return r;
}
void release(Response &) {}
}  // namespace stub
namespace web = stub;
#else
namespace web = quire::os::web;
#endif

const char *method_name(HTTPMethod m) {
  switch (m) {
    case HTTP_POST: return "POST";
    case HTTP_PUT: return "PUT";
    case HTTP_DELETE: return "DELETE";
    case HTTP_PATCH: return "PATCH";
    case HTTP_HEAD: return "HEAD";
    case HTTP_OPTIONS: return "OPTIONS";
    default: return "GET";
  }
}

String url_encode(const String &s) {
  static const char *hex = "0123456789ABCDEF";
  String o;
  o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    unsigned char c = (unsigned char)s[i];
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o += (char)c;
    else {
      o += '%';
      o += hex[c >> 4];
      o += hex[c & 15];
    }
  }
  return o;
}

// WebServer parses the query into arguments (and puts a non-form body under "plain"); rebuild the
// raw query string from them.
String rebuild_query() {
  String q;
  for (int i = 0; i < g_srv->args(); i++) {
    String n = g_srv->argName(i);
    if (n == "plain") continue;
    if (q.length()) q += '&';
    q += url_encode(n);
    q += '=';
    q += url_encode(g_srv->arg(i));
  }
  return q;
}

void handle_os() {
  String uri = g_srv->uri();
  String query = rebuild_query();
  String body = g_srv->hasArg("plain") ? g_srv->arg("plain") : String();
  String auth = g_srv->header("Authorization");
  String remote = g_srv->client().remoteIP().toString();

  web::Request req;
  req.method = method_name(g_srv->method());
  req.path = uri.c_str();
  req.query = query.c_str();
  req.body = body.length() ? body.c_str() : nullptr;
  req.body_len = body.length();
  req.authorization = auth.length() ? auth.c_str() : nullptr;
  req.remote = remote.c_str();

  web::Response res = web::handle(req);
  g_srv->setContentLength(res.len);
  if (res.gzip) g_srv->sendHeader("Content-Encoding", "gzip");
  if (res.extra_header) {                                  // one "Name: value" header from the OS
    const char *colon = strchr(res.extra_header, ':');
    if (colon) {
      String name(res.extra_header, colon - res.extra_header);
      const char *v = colon + 1;
      while (*v == ' ') v++;
      g_srv->sendHeader(name, v);
    }
  }
  g_srv->send(res.status, res.content_type ? res.content_type : "application/octet-stream", "");
  if (res.len && res.body) g_srv->sendContent((const char *)res.body, res.len);
  web::release(res);
  hal::log(hal::LOG_DEBUG, TAG, "%s %s%s%s from %s -> %d (%u bytes)", req.method, uri.c_str(), query.length() ? "?" : "",
           query.c_str(), remote.c_str(), res.status, (unsigned)res.len);
}

void handle_any() {
  String uri = g_srv->uri();
  if (uri == "/os" || uri.startsWith("/os/")) {
    handle_os();
    return;
  }
  if (uri == "/") {
    g_srv->sendHeader("Location", "/os");
    g_srv->send(302, "text/plain", "");
    return;
  }
  g_srv->send(404, "text/plain", "not found");
}

}  // namespace

void web_server_start() {
  if (g_srv) return;
  g_srv = new WebServer(80);
  static const char *keys[] = {"Authorization"};
  g_srv->collectHeaders(keys, 1);
  g_srv->onNotFound(handle_any);
  g_srv->begin();
  hal::log(hal::LOG_INFO, TAG, "listening on :80");
}

void web_server_stop() {
  if (!g_srv) return;
  g_srv->stop();
  delete g_srv;
  g_srv = nullptr;
}

void web_server_poll() {
  if (g_srv) g_srv->handleClient();
}

}  // namespace t5pro
}  // namespace quire
