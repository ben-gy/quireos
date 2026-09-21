// LAN settings page and JSON API (see web_api.h). Thread-safe: only touches the mailbox, the
// published snapshot and the schema copy, all under one mutex.
#include "web_api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <deque>
#include <string>
#include "../hal/hal.h"
#include "../runtime/screen_parser.h"
#include "../runtime/third_party/ArduinoJson.h"
#include "prefs.h"
#include "www/settings_html_gz.h"

namespace quire {
namespace os {
namespace web {

namespace {
void *g_mutex = nullptr;
std::deque<Command> g_mailbox;
std::string g_state = "{}";
JsonDocument g_schemas;
std::string g_password;   // cached copy of the web password (prefs are main-thread only)

void lock() { if (!g_mutex) g_mutex = hal::mutex_create(); hal::mutex_lock(g_mutex); }
void unlock() { hal::mutex_unlock(g_mutex); }

Response text(int status, const char *ct, const std::string &body, const char *extra = nullptr) {
  Response r;
  r.status = status;
  r.content_type = ct;
  char *b = (char *)malloc(body.size() + 1);
  memcpy(b, body.data(), body.size());
  b[body.size()] = 0;
  r.body = (const uint8_t *)b;
  r.len = body.size();
  r.must_free = true;
  r.extra_header = extra;
  return r;
}
Response json_ok() { return text(200, "application/json", "{\"ok\":true}"); }
Response json_error(int status, const std::string &msg) {
  JsonDocument d;
  d["ok"] = false;
  d["error"] = msg;
  std::string s;
  serializeJson(d, s);
  return text(status, "application/json", s);
}

bool base64_decode(const char *in, std::string &out) {
  static const char *T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  uint32_t acc = 0;
  int bits = 0;
  for (const char *p = in; *p && *p != '='; p++) {
    const char *q = strchr(T, *p);
    if (!q) return false;
    acc = (acc << 6) | (uint32_t)(q - T);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push_back((char)((acc >> bits) & 0xFF)); }
  }
  return true;
}

bool authorised(const Request &req) {
  if (g_password.empty()) return true;
  if (!req.authorization || strncmp(req.authorization, "Basic ", 6)) return false;
  std::string dec;
  if (!base64_decode(req.authorization + 6, dec)) return false;
  size_t c = dec.find(':');
  std::string pw = c == std::string::npos ? dec : dec.substr(c + 1);
  return pw == g_password;
}

void post(Command::Type t, const char *a = "", const std::string &b = "") {
  Command c;
  c.type = t;
  snprintf(c.a, sizeof c.a, "%s", a ? a : "");
  if (!b.empty()) { c.b = (char *)malloc(b.size() + 1); memcpy(c.b, b.data(), b.size() + 1); }
  lock();
  if (g_mailbox.size() < 16) g_mailbox.push_back(c); else free(c.b);
  unlock();
}

bool has_key(JsonObjectConst o, const char *key) {
  for (JsonPairConst p : o) if (!strcmp(p.key().c_str(), key)) return true;
  return false;
}

bool parse_body(const Request &req, JsonDocument &doc) {
  if (!req.body || !req.body_len) return false;
  return deserializeJson(doc, req.body, req.body_len) == DeserializationError::Ok;
}

// Validate a settings patch against the app's schema (SPEC §5). Secrets: "" = keep, null = clear.
bool validate_settings(JsonArrayConst schema, JsonObjectConst values, JsonDocument &out, std::string &err) {
  JsonObject o = out.to<JsonObject>();
  for (JsonObjectConst def : schema) {
    std::string keys = def["key"] | "";
    const char *key = keys.c_str();
    const char *type = def["type"] | "string";
    JsonVariantConst v = values[key];
    if (!has_key(values, key)) continue;
    if (!strcmp(type, "secret")) {
      if (v.isNull()) { o[keys] = nullptr; continue; }
      if (!v.is<const char *>()) { err = std::string(key) + " must be a string"; return false; }
      if (*v.as<const char *>() == 0) continue;   // unchanged
      o[keys] = v.as<const char *>();
    } else if (!strcmp(type, "string") || !strcmp(type, "url")) {
      if (v.isNull()) { o[keys] = ""; continue; }
      if (!v.is<const char *>()) { err = std::string(key) + " must be a string"; return false; }
      std::string s = v.as<const char *>();
      if (!strcmp(type, "url") && !s.empty() && s.compare(0, 7, "http://") && s.compare(0, 8, "https://")) { err = std::string(key) + " must start with http:// or https://"; return false; }
      while (!s.empty() && (s.back() == ' ' || s.back() == '/')) s.pop_back();
      o[keys] = s;
    } else if (!strcmp(type, "number")) {
      if (v.isNull()) { o[keys] = nullptr; continue; }
      double d;
      if (v.is<double>() || v.is<long long>()) d = v.as<double>();
      else if (v.is<const char *>() && *v.as<const char *>()) { char *e; d = strtod(v.as<const char *>(), &e); if (*e) { err = std::string(key) + " must be a number"; return false; } }
      else { err = std::string(key) + " must be a number"; return false; }
      if (def["min"].is<double>() && d < def["min"].as<double>()) { err = std::string(key) + " is below the minimum"; return false; }
      if (def["max"].is<double>() && d > def["max"].as<double>()) { err = std::string(key) + " is above the maximum"; return false; }
      o[keys] = d;
    } else if (!strcmp(type, "bool")) {
      if (v.is<bool>()) o[keys] = v.as<bool>();
      else if (v.is<const char *>()) o[keys] = !strcmp(v.as<const char *>(), "true") || !strcmp(v.as<const char *>(), "1") || !strcmp(v.as<const char *>(), "on");
      else { err = std::string(key) + " must be true or false"; return false; }
    } else if (!strcmp(type, "select")) {
      if (!v.is<const char *>()) { err = std::string(key) + " must be a string"; return false; }
      bool ok = false;
      for (JsonVariantConst opt : def["options"].as<JsonArrayConst>()) {
        const char *ov = opt["value"] | (opt.is<const char *>() ? opt.as<const char *>() : "");
        if (!strcmp(ov, v.as<const char *>())) ok = true;
      }
      if (!ok) { err = std::string(key) + " is not one of the options"; return false; }
      o[keys] = v.as<const char *>();
    } else if (!strcmp(type, "list")) {
      if (!v.is<JsonArrayConst>()) { err = std::string(key) + " must be a list"; return false; }
      int max = def["max"] | 16;
      if (max > 16) max = 16;
      if ((int)v.size() > max) { err = std::string(key) + " has more than " + std::to_string(max) + " rows"; return false; }
      JsonArray rows = o[keys].to<JsonArray>();
      for (JsonVariantConst rv : v.as<JsonArrayConst>()) {
        if (!rv.is<JsonObjectConst>()) { err = std::string(key) + " rows must be objects"; return false; }
        JsonObject row = rows.add<JsonObject>();
        for (JsonObjectConst f : def["item"].as<JsonArrayConst>()) {
          std::string fk = f["key"] | "";
          const char *ft = f["type"] | "string";
          JsonVariantConst fv = rv[fk.c_str()];
          if (fv.isNull()) { if (f["required"] | false) { err = std::string(key) + ": " + fk + " is required"; return false; } continue; }
          if (!strcmp(ft, "number")) row[fk] = fv.as<double>();
          else if (!strcmp(ft, "bool")) row[fk] = fv.as<bool>();
          else row[fk] = fv.is<const char *>() ? fv.as<const char *>() : "";
        }
      }
    }
  }
  std::string s;
  serializeJson(out, s);
  if (s.size() > 2048) { err = "settings exceed 2 kB"; return false; }
  return true;
}
}  // namespace

void publish(const char *state_json, const char *schemas_json) {
  lock();
  g_state = state_json ? state_json : "{}";
  g_schemas.clear();
  if (schemas_json) deserializeJson(g_schemas, schemas_json);
  g_password = prefs::web_password();
  unlock();
}

bool take_command(Command &out) {
  lock();
  if (g_mailbox.empty()) { unlock(); return false; }
  out = g_mailbox.front();
  g_mailbox.pop_front();
  unlock();
  return true;
}
void free_command(Command &c) { free(c.b); c.b = nullptr; }

void release(Response &res) {
  if (res.must_free && res.body) free((void *)res.body);
  res.body = nullptr; res.len = 0; res.must_free = false;
}

Response handle(const Request &req) {
  const char *path = req.path ? req.path : "/os";
  if (strncmp(path, "/os", 3) != 0) return text(404, "text/plain", "not found");
  if (!authorised(req)) return text(401, "text/plain", "Authentication required", "WWW-Authenticate: Basic realm=\"QuireOS\"");
  bool is_get = !strcmp(req.method, "GET");
  bool is_post = !strcmp(req.method, "POST");
  if (!strcmp(path, "/os") || !strcmp(path, "/os/")) {
    Response r;
    r.status = 200;
    r.content_type = "text/html; charset=utf-8";
    r.body = WWW_SETTINGS_GZ;
    r.len = WWW_SETTINGS_GZ_LEN;
    r.gzip = true;
    return r;
  }
  if (!strcmp(path, "/os/api/state")) {
    if (!is_get) return json_error(405, "GET only");
    lock();
    std::string s = g_state;
    unlock();
    return text(200, "application/json", s);
  }
  if (!is_post) return json_error(405, "POST only");
  JsonDocument body;
  parse_body(req, body);
  if (!strcmp(path, "/os/api/store")) {
    const char *u = body["store_url"] | (body["url"] | (const char *)nullptr);
    if (!u) return json_error(400, "store_url required");
    if (*u && strncmp(u, "http://", 7) && strncmp(u, "https://", 8)) return json_error(400, "store_url must be absolute");
    post(Command::STORE_URL, u);
    return json_ok();
  }
  if (!strcmp(path, "/os/api/app/install")) {
    const char *u = body["manifest_url"] | (const char *)nullptr;
    if (!u || (strncmp(u, "http://", 7) && strncmp(u, "https://", 8))) return json_error(400, "manifest_url must be absolute");
    post(Command::INSTALL, u);
    return json_ok();
  }
  if (!strcmp(path, "/os/api/pair")) { post(Command::PAIR); return json_ok(); }
  if (!strcmp(path, "/os/api/refresh")) { post(Command::REFRESH); return json_ok(); }
  if (!strcmp(path, "/os/api/reboot")) { post(Command::REBOOT); return json_ok(); }
  if (!strcmp(path, "/os/api/home")) { post(Command::HOME); return json_ok(); }
  if (!strcmp(path, "/os/api/updates")) { post(Command::CHECK_UPDATES); return json_ok(); }
  if (!strcmp(path, "/os/api/wifi/forget")) { post(Command::WIFI_FORGET); return json_ok(); }
  if (!strcmp(path, "/os/api/prefs")) {
    if (!body.is<JsonObject>()) return json_error(400, "JSON object required");
    JsonDocument clean;
    JsonObject o = clean.to<JsonObject>();
    if (body["tz"].is<const char *>()) o["tz"] = body["tz"].as<const char *>();
    if (body["sleep_s"].is<long long>() || body["sleep_s"].is<double>()) o["sleep_s"] = (int)body["sleep_s"].as<double>();
    if (body["frontlight"].is<long long>() || body["frontlight"].is<double>()) o["frontlight"] = (int)body["frontlight"].as<double>();
    if (body["refresh_policy"].is<long long>() || body["refresh_policy"].is<double>()) o["refresh_policy"] = (int)body["refresh_policy"].as<double>();
    if (body["name"].is<const char *>()) o["name"] = body["name"].as<const char *>();
    if (body["web_password"].is<const char *>()) o["web_password"] = body["web_password"].as<const char *>();
    std::string s;
    serializeJson(clean, s);
    post(Command::PREFS, "", s);
    return json_ok();
  }
  // /os/api/app/<id>/(settings|uninstall|open)
  if (!strncmp(path, "/os/api/app/", 12)) {
    std::string rest = path + 12;
    size_t sl = rest.find('/');
    if (sl == std::string::npos) return json_error(404, "unknown endpoint");
    std::string id = rest.substr(0, sl), op = rest.substr(sl + 1);
    if (!rt::valid_id(id.c_str(), true)) return json_error(400, "bad app id");
    if (op == "uninstall") { post(Command::UNINSTALL, id.c_str()); return json_ok(); }
    if (op == "open") { post(Command::OPEN_APP, id.c_str()); return json_ok(); }
    if (op == "settings") {
      JsonObjectConst values = body["values"].is<JsonObjectConst>() ? body["values"].as<JsonObjectConst>() : body.as<JsonObjectConst>();
      if (values.isNull()) return json_error(400, "JSON object required");
      lock();
      JsonArrayConst schema = g_schemas[id.c_str()].as<JsonArrayConst>();
      if (schema.isNull()) { unlock(); return json_error(404, "app not installed"); }
      JsonDocument clean;
      std::string err;
      bool ok = validate_settings(schema, values, clean, err);
      unlock();
      if (!ok) return json_error(400, err);
      std::string s;
      serializeJson(clean, s);
      post(Command::APP_SETTINGS, id.c_str(), s);
      return json_ok();
    }
  }
  return json_error(404, "unknown endpoint");
}

}  // namespace web
}  // namespace os
}  // namespace quire
