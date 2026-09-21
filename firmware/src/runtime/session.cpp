#include "session.h"
#include <stdio.h>
#include <string.h>
#include "url.h"

namespace quire {
namespace rt {

namespace {
const char *TAG = "app";
const int BACKOFF_S[] = {10, 30, 60};

bool due(uint32_t now, uint32_t at) { return at != 0 && (int32_t)(now - at) >= 0; }

uint64_t fnv(uint64_t h, const void *p, size_t n) {
  const uint8_t *b = (const uint8_t *)p;
  for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 1099511628211ull; }
  return h;
}
uint64_t fnv_str(uint64_t h, const char *s) { return fnv(fnv(h, s, strlen(s)), "\x1f", 1); }

bool value_empty(JsonVariantConst v) {
  if (v.isNull()) return true;
  if (v.is<const char *>()) return *v.as<const char *>() == 0;
  if (v.is<JsonArrayConst>()) return v.size() == 0;
  return false;
}
}  // namespace

AppSession::AppSession() {}
AppSession::~AppSession() { close(); }

const WidgetTree &AppSession::tree() const {
  if (screen_) return screen_->tree;
  if (!empty_.valid()) empty_.init();
  return empty_;
}
WidgetTree &AppSession::tree() {
  if (screen_) return screen_->tree;
  if (!empty_.valid()) empty_.init();
  return empty_;
}
const ScreenMeta &AppSession::meta() const {
  static ScreenMeta none;
  return screen_ ? screen_->meta : none;
}

void AppSession::close() {
  delete screen_; screen_ = nullptr;
  delete pending_; pending_ = nullptr;
  screen_loaded_ = false;
  clear_data();
  clear_images();
  history_.clear();
  outbox_.clear();
  state_ = State::IDLE;
  gen_++;
  then_ = Then();
  http_inflight_ = screen_inflight_ = false;
}

// ------------------------------------------------------------------------------ opening ---

bool AppSession::open(Fetcher *fetcher, const std::string &manifest_url, const std::string &install_id,
                      const char *settings_json, const DeviceInfo &dev) {
  close();
  fetcher_ = fetcher;
  manifest_url_ = manifest_url;
  install_id_ = install_id;
  app_origin_ = url::origin(manifest_url);
  set_device(dev);
  tz::parse(dev.tz.c_str(), zone_);

  settings_all_.clear();
  if (settings_json && *settings_json) deserializeJson(settings_all_, settings_json);
  if (!settings_all_.is<JsonObject>()) settings_all_.to<JsonObject>();
  JsonObject all = settings_all_.as<JsonObject>();
  missing_.clear();
  // Note: char[N] keys must be passed as const char*; ArduinoJson treats a char array as a
  // fixed-length literal (N-1 bytes) and the lookup silently misses.
  for (const SettingDef &d : manifest.settings) {
    const char *key = d.key;
    if (value_empty(all[key]) && !d.def.isNull() && d.type != SType::SECRET) all[std::string(key)] = d.def;
    if (d.required && value_empty(all[key])) missing_.push_back(key);
  }
  settings_public_.clear();
  settings_public_.set(settings_all_);
  JsonObject pub = settings_public_.as<JsonObject>();
  for (const SettingDef &d : manifest.settings) if (d.type == SType::SECRET) pub.remove((const char *)d.key);
  std::string pub_json;
  serializeJson(settings_public_, pub_json);
  settings_header_ = url::encode(pub_json);
  if (settings_header_.size() > 2048) { hal::log(hal::LOG_WARN, TAG, "X-App-Settings over 2 kB, omitted"); settings_header_.clear(); }
  if (pub_json == "{}") settings_header_.clear();

  compute_allowed();
  if (!missing_.empty()) { state_ = State::NEEDS_SETUP; return false; }
  if (app_origin_.empty()) { set_error("manifest", "Manifest URL is not absolute"); return false; }
  history_.clear();
  std::string err;
  std::string entry = url::resolve(app_origin_, manifest.entry);
  if (entry.empty()) { set_error("manifest", "Entry URL is not valid"); return false; }
  load_screen(entry, LoadMode::OPEN);
  return true;
}

void AppSession::compute_allowed() {
  allowed_.clear();
  app_origin_in_hosts_ = false;
  if (!app_origin_.empty()) allowed_.push_back(app_origin_);
  for (const std::string &h : manifest.hosts) {
    std::string o;
    size_t b = h.find("{{");
    if (b != std::string::npos) {
      size_t e = h.find("}}", b);
      if (e == std::string::npos) continue;
      std::string inner = h.substr(b + 2, e - b - 2);
      size_t s = inner.find_first_not_of(" \t"), t = inner.find_last_not_of(" \t");
      if (s == std::string::npos) continue;
      inner = inner.substr(s, t - s + 1);
      if (inner.compare(0, 9, "settings.") != 0) continue;
      std::string key = inner.substr(9);
      const SettingDef *d = manifest.setting(key.c_str());
      if (!d || d->type != SType::URL) { hal::log(hal::LOG_WARN, TAG, "hosts entry '%s' is not a url setting", h.c_str()); continue; }
      const char *v = settings_all_[key.c_str()] | (const char *)nullptr;
      if (!v || !*v) continue;
      o = url::origin(v);
    } else {
      o = url::origin(h);
    }
    if (o.empty()) { hal::log(hal::LOG_WARN, TAG, "hosts entry '%s' ignored", h.c_str()); continue; }
    if (o == app_origin_) app_origin_in_hosts_ = true;
    bool dup = false;
    for (const std::string &a : allowed_) if (a == o) dup = true;
    if (!dup) allowed_.push_back(o);
  }
}

bool AppSession::origin_allowed(const std::string &o) const {
  for (const std::string &a : allowed_) if (a == o) return true;
  return false;
}

void AppSession::set_device(const DeviceInfo &dev) {
  dev_ = dev;
  update_device_doc(epoch_);
}

void AppSession::update_device_doc(int64_t epoch) {
  device_.clear();
  JsonObject d = device_.to<JsonObject>();
  d["time"] = epoch;
  d["tz"] = dev_.tz;
  d["battery"] = dev_.battery;
  d["charging"] = dev_.charging;
  d["rssi"] = dev_.rssi;
  d["name"] = dev_.name;
  d["online"] = dev_.online;
  d["w"] = dev_.w;
  d["h"] = dev_.h;
  d["greys"] = dev_.greys;
  d["dpi"] = dev_.dpi;
}

// ----------------------------------------------------------------------------- resolver ---

JsonVariantConst AppSession::root(const char *name) {
  if (!strcmp(name, "settings")) return secret_mode_ == SecretMode::ALLOWED ? settings_all_.as<JsonVariantConst>() : settings_public_.as<JsonVariantConst>();
  if (!strcmp(name, "vars")) return vars_.as<JsonVariantConst>();
  if (!strcmp(name, "device")) return device_.as<JsonVariantConst>();
  if (screen_) {
    for (int i = 0; i < screen_->meta.data_count; i++)
      if (!strcmp(screen_->meta.data[i].id, name)) return data_[i].doc.as<JsonVariantConst>();
  }
  return JsonVariantConst();
}

void AppSession::note_settings_ref(const char *key) {
  const SettingDef *d = manifest.setting(key);
  if (d && d->type == SType::SECRET && secret_mode_ != SecretMode::ALLOWED) secret_refused_ = true;
}

// ----------------------------------------------------------------------------- requests ---

std::string AppSession::screen_origin() const {
  if (!screen_url_.empty()) { std::string o = url::origin(screen_url_); if (!o.empty()) return o; }
  return app_origin_;
}

std::string AppSession::resolve_url(const std::string &u, std::string &err) const {
  std::string r = url::resolve(screen_origin(), u);
  if (r.empty()) err = "URL must be absolute or start with /";
  return r;
}

void AppSession::render_json(JsonVariantConst src, JsonVariant dst) {
  if (src.is<JsonObjectConst>()) {
    JsonObject o = dst.to<JsonObject>();
    for (JsonPairConst p : src.as<JsonObjectConst>()) render_json(p.value(), o[std::string(p.key().c_str())].to<JsonVariant>());
  } else if (src.is<JsonArrayConst>()) {
    JsonArray a = dst.to<JsonArray>();
    for (JsonVariantConst v : src.as<JsonArrayConst>()) render_json(v, a.add<JsonVariant>());
  } else if (src.is<const char *>()) {
    dst.set(expr::render_template(src.as<const char *>(), *this));
  } else {
    dst.set(src);
  }
}

bool AppSession::build_request(const std::string &url_tpl_in, JsonVariantConst headers, JsonVariantConst body, bool body_raw,
                               const char *method, FetchRequest &out, std::string &err) {
  std::string tpl = url_tpl_in;
  size_t s = tpl.find_first_not_of(" \t\r\n");
  if (s == std::string::npos) { err = "empty URL"; return false; }
  tpl = tpl.substr(s);
  std::string origin, base;
  if (tpl.compare(0, 2, "{{") == 0) {
    size_t e = tpl.find("}}");
    if (e == std::string::npos) { err = "bad template in URL"; return false; }
    std::string inner = tpl.substr(2, e - 2);
    size_t a = inner.find_first_not_of(" \t"), b = inner.find_last_not_of(" \t");
    inner = a == std::string::npos ? "" : inner.substr(a, b - a + 1);
    if (inner.compare(0, 9, "settings.") != 0) { err = "only {{settings.<url key>}} may start a URL"; return false; }
    std::string key = inner.substr(9);
    const SettingDef *d = manifest.setting(key.c_str());
    if (!d || d->type != SType::URL) { err = "setting '" + key + "' is not a url setting"; return false; }
    const char *v = settings_all_[key.c_str()] | (const char *)nullptr;
    if (!v || !*v) { err = "setting '" + key + "' is not set"; return false; }
    origin = url::origin(v);
    if (origin.empty()) { err = "setting '" + key + "' is not a valid URL"; return false; }
  } else {
    size_t b = tpl.find("{{");
    std::string literal = b == std::string::npos ? tpl : tpl.substr(0, b);
    if (!literal.empty() && literal[0] == '/') { base = screen_origin(); origin = base; }
    else {
      origin = url::origin(literal);
      if (origin.empty()) { err = "URL origin is not a literal"; return false; }
    }
  }
  if (!origin_allowed(origin)) { err = "origin not allowed: " + origin; hal::log(hal::LOG_WARN, TAG, "refused %s", origin.c_str()); return false; }
  url::Parts op = url::parse(origin);
  if (op.scheme == "http" && !url::is_private_host(op.host)) { err = "plain http only to LAN hosts"; return false; }

  secret_mode_ = (origin != app_origin_ || app_origin_in_hosts_) ? SecretMode::ALLOWED : SecretMode::REFUSE;
  secret_refused_ = false;
  std::string u = expr::render_template(tpl.c_str(), tpl.size(), *this);
  if (!base.empty()) u = base + u;
  out.url = u;
  out.method = method ? method : "GET";
  out.headers.clear();
  out.body.clear();
  if (headers.is<JsonObjectConst>()) {
    for (JsonPairConst p : headers.as<JsonObjectConst>()) {
      std::string v = p.value().is<const char *>() ? expr::render_template(p.value().as<const char *>(), *this) : expr::to_string(expr::eval_value(p.value(), *this));
      out.headers.push_back(std::string(p.key().c_str()) + ": " + v);
    }
  }
  if (body.is<const char *>()) {
    out.body = body_raw ? body.as<const char *>() : expr::render_template(body.as<const char *>(), *this);
  } else if (body.is<JsonObjectConst>() || body.is<JsonArrayConst>()) {
    JsonDocument tmp;
    if (body_raw) tmp.set(body); else render_json(body, tmp.as<JsonVariant>());
    serializeJson(tmp, out.body);
    out.headers.push_back("Content-Type: application/json");
  }
  secret_mode_ = SecretMode::HIDDEN;
  if (secret_refused_) { err = "secret settings may not be sent to " + origin; hal::log(hal::LOG_WARN, TAG, "%s", err.c_str()); return false; }
  return true;
}

bool AppSession::add_screen_headers(FetchRequest &req, const std::string &u, const std::string &etag) {
  req.headers.push_back("X-Install-Id: " + install_id_);
  req.headers.push_back(std::string("X-App-Id: ") + manifest.id);
  req.headers.push_back("X-App-Version: " + manifest.version);
  if (!settings_header_.empty() && url::origin(u) == app_origin_) req.headers.push_back("X-App-Settings: " + settings_header_);
  if (!etag.empty()) req.headers.push_back("If-None-Match: " + etag);
  return true;
}

bool AppSession::enqueue(FetchRequest &req) {
  outbox_.push_back(req);
  pump_outbox();
  return true;
}

void AppSession::pump_outbox() {
  while (!outbox_.empty() && fetcher_ && fetcher_->fetch(outbox_.front())) outbox_.erase(outbox_.begin());
}

// -------------------------------------------------------------------------------- screens ---

void AppSession::load_screen(const std::string &u, LoadMode mode, const std::string &post_body) {
  FetchRequest req;
  std::string err;
  const char *method = mode == LoadMode::SUBMIT ? "POST" : "GET";
  if (!build_request(u, JsonVariantConst(), JsonVariantConst(), true, method, req, err)) {
    if (foreground(mode)) { error_url_ = u; error_mode_ = mode; set_error("policy", err); }
    else alert(err);
    return;
  }
  if (mode == LoadMode::SUBMIT) { req.body = post_body; req.headers.push_back("Content-Type: application/json"); }
  bool reuse_etag = (mode == LoadMode::REFRESH || mode == LoadMode::BACKGROUND) && req.url == screen_url_;
  add_screen_headers(req, req.url, reuse_etag ? screen_etag_ : "");
  if (foreground(mode)) gen_++;
  req.tag = make_tag(mode == LoadMode::SUBMIT ? K_SUBMIT : K_SCREEN, 0);
  req.max_bytes = SCREEN_MAX_BYTES + 1;
  pending_url_ = req.url;
  pending_mode_ = mode;
  screen_inflight_ = true;
  if (foreground(mode)) state_ = State::LOADING;
  enqueue(req);
}

void AppSession::on_response(const FetchResult &res) {
  uint32_t kind = res.tag >> 24, gen = (res.tag >> 8) & 0xFFFF, idx = res.tag & 0xFF;
  if (gen != (gen_ & 0xFFFF)) { hal::log(hal::LOG_DEBUG, TAG, "dropped stale response (gen %u)", gen); return; }
  switch (kind) {
    case K_SCREEN: handle_screen_response(res); break;
    case K_SUBMIT: handle_submit_response(res); break;
    case K_DATA: handle_data_response((int)idx, res); break;
    case K_IMAGE: handle_image_response((int)idx, res); break;
    case K_HTTP: handle_http_response(res); break;
    default: break;
  }
  pump_outbox();
}

void AppSession::handle_screen_response(const FetchResult &res) {
  screen_inflight_ = false;
  LoadMode mode = pending_mode_;
  bool fg = foreground(mode);
  auto failed = [&](const char *code, const std::string &msg) {
    if (fg) { error_url_ = pending_url_; error_mode_ = mode; set_error(code, msg); }
    else { alert(msg); arm_backoff(); background_failed_ = true; }
  };
  if (res.error) {
    failed("network", res.error == hal::HTTP_ERR_OFFLINE ? "Offline" : res.error == hal::HTTP_ERR_TIMEOUT ? "Timed out" : "Could not connect");
    return;
  }
  if (res.status == 304) {
    if (screen_) screen_due_ms_ = screen_->meta.ttl ? now_ms_ + (uint32_t)screen_->meta.ttl * 1000u : 0;
    backoff_idx_ = 0;
    background_failed_ = false;
    if (mode == LoadMode::REFRESH && screen_ && screen_->meta.data_count == 0) { init_vars(); rebind(false); }
    if (fg) state_ = State::READY;
    return;
  }
  if (res.status >= 400) {
    std::string code, msg;
    if (!parse_error_body((const char *)res.body, res.len, code, msg) || msg.empty()) {
      char b[40]; snprintf(b, sizeof b, "App error %d", res.status); msg = b;
    }
    failed(code.empty() ? "http" : code.c_str(), msg);
    return;
  }
  if (res.status != 200 || !res.body) { failed("http", "Unexpected response"); return; }
  if (!pending_) pending_ = new ParsedScreen();
  ParseResult pr = parse_screen((const char *)res.body, res.len, *pending_);
  if (pr.status == ParseStatus::UPDATE_OS) { state_ = State::UPDATE_OS; error_ = pr.error; return; }
  if (!pr.ok()) { failed("invalid", pr.error); return; }
  adopt_screen(pending_url_, res.etag ? res.etag : "", mode);
}

void AppSession::handle_submit_response(const FetchResult &res) {
  screen_inflight_ = false;
  if (res.error) { alert("Could not reach the app"); return; }
  if (res.status == 204) { if (then_.armed && then_.wait) { then_.wait = false; then_.at_ms = now_ms_ + (uint32_t)then_.after * 1000u; } return; }
  if (res.status >= 400) {
    std::string code, msg;
    if (!parse_error_body((const char *)res.body, res.len, code, msg) || msg.empty()) { char b[40]; snprintf(b, sizeof b, "App error %d", res.status); msg = b; }
    alert(msg);
    return;
  }
  if (res.status == 200 && res.body && res.len) {
    if (!pending_) pending_ = new ParsedScreen();
    ParseResult pr = parse_screen((const char *)res.body, res.len, *pending_);
    if (pr.status == ParseStatus::UPDATE_OS) { state_ = State::UPDATE_OS; error_ = pr.error; return; }
    if (!pr.ok()) { alert(pr.error); return; }
    adopt_screen(pending_url_, res.etag ? res.etag : "", LoadMode::SUBMIT);
  }
  if (then_.armed && then_.wait) { then_.wait = false; then_.at_ms = now_ms_ + (uint32_t)then_.after * 1000u; }
}

void AppSession::adopt_screen(const std::string &fetched_url, const std::string &etag, LoadMode mode) {
  delete screen_;
  screen_ = pending_;
  pending_ = nullptr;
  screen_loaded_ = true;
  // Canonical URL for ttl re-fetches.
  std::string canon = fetched_url;
  if (mode == LoadMode::SUBMIT) canon = screen_url_.empty() ? url::resolve(app_origin_, manifest.entry) : screen_url_;
  if (!screen_->meta.url.empty()) {
    std::string base = url::origin(fetched_url);
    if (base.empty()) base = app_origin_;
    std::string r = url::resolve(base, screen_->meta.url);
    if (!r.empty()) canon = r;
  }
  screen_url_ = canon;
  screen_etag_ = etag;
  switch (mode) {
    case LoadMode::OPEN: case LoadMode::HOME: history_.clear(); history_.push_back({screen_url_}); break;
    case LoadMode::NAVIGATE_PUSH:
      if (history_.size() >= (size_t)MAX_HISTORY) history_.erase(history_.begin());
      history_.push_back({screen_url_});
      break;
    case LoadMode::NAVIGATE_REPLACE:
      if (history_.empty()) history_.push_back({screen_url_}); else history_.back().url = screen_url_;
      break;
    case LoadMode::BACK:
      if (history_.empty()) history_.push_back({screen_url_}); else history_.back().url = screen_url_;
      break;
    default: break;
  }
  clear_data();
  clear_images();
  backoff_idx_ = 0;
  background_failed_ = false;
  screen_due_ms_ = screen_->meta.ttl ? now_ms_ + (uint32_t)screen_->meta.ttl * 1000u : 0;
  error_.clear();
  first_render_pending_ = true;
  awaiting_data_ = screen_->meta.data_count;
  if (awaiting_data_ == 0) finalize_first_render();
  else start_data_fetches(true);
}

void AppSession::finalize_first_render() {
  first_render_pending_ = false;
  init_vars();
  rebind(true);
  plan_.hint = screen_ ? screen_->meta.refresh : Refresh::AUTO;
  state_ = State::READY;
  last_minute_ = epoch_ / 60;
  fetch_images(true);
}

// ----------------------------------------------------------------------------------- data ---

void AppSession::clear_data() {
  for (int i = 0; i < MAX_DATA; i++) { data_[i].doc.clear(); data_[i].etag.clear(); data_[i].due_ms = 0; data_[i].loaded = data_[i].failed = data_[i].inflight = false; data_[i].backoff = 0; }
}

void AppSession::start_data_fetches(bool force) {
  if (!screen_) return;
  for (int i = 0; i < screen_->meta.data_count; i++) if (force || !data_[i].loaded) fetch_data(i);
}

void AppSession::fetch_data(int i) {
  if (!screen_ || i >= screen_->meta.data_count) return;
  const DataSource &ds = screen_->meta.data[i];
  DataState &st = data_[i];
  FetchRequest req;
  std::string err;
  std::string tpl = ds.url.is<const char *>() ? ds.url.as<const char *>() : expr::to_string(expr::eval_value(ds.url, *this));
  if (!build_request(tpl, ds.headers, ds.body, ds.body_raw, ds.post ? "POST" : "GET", req, err)) {
    hal::log(hal::LOG_WARN, TAG, "data '%s': %s", ds.id, err.c_str());
    st.doc.clear(); st.failed = true; st.loaded = true; st.inflight = false;
    st.due_ms = 0;
    if (first_render_pending_) { if (ds.required) { set_error("data", "Data source '" + std::string(ds.id) + "' refused: " + err); return; } if (--awaiting_data_ <= 0) finalize_first_render(); }
    return;
  }
  add_screen_headers(req, req.url, st.etag);
  req.tag = make_tag(K_DATA, i);
  req.max_bytes = DATA_MAX_BYTES + 1;
  st.inflight = true;
  st.due_ms = 0;
  enqueue(req);
}

void AppSession::handle_data_response(int i, const FetchResult &res) {
  if (!screen_ || i >= screen_->meta.data_count) return;
  const DataSource &ds = screen_->meta.data[i];
  DataState &st = data_[i];
  st.inflight = false;
  bool first = !st.loaded;
  bool ok = false;
  if (!res.error && res.status == 304) { ok = true; }
  else if (!res.error && res.status == 200) {
    st.doc.clear();
    if (res.len > DATA_MAX_BYTES) hal::log(hal::LOG_WARN, TAG, "data '%s' over 16 kB, ignored", ds.id);
    else if (res.body && deserializeJson(st.doc, (const char *)res.body, res.len) == DeserializationError::Ok &&
             (st.doc.is<JsonObjectConst>() || st.doc.is<JsonArrayConst>())) { /* fine */ }
    else { st.doc.clear(); hal::log(hal::LOG_WARN, TAG, "data '%s' is not JSON", ds.id); }
    st.etag = res.etag ? res.etag : "";
    ok = true;
  }
  if (ok) {
    st.loaded = true; st.failed = false; st.backoff = 0;
    st.due_ms = ds.ttl ? now_ms_ + (uint32_t)ds.ttl * 1000u : 0;
    bool any_failed = false;
    for (int k = 0; k < screen_->meta.data_count; k++) if (data_[k].failed) any_failed = true;
    if (!any_failed && !screen_inflight_) background_failed_ = false;
  } else {
    hal::log(hal::LOG_WARN, TAG, "data '%s' failed: status %d error %d", ds.id, res.status, res.error);
    if (first && ds.required && first_render_pending_) {
      set_error("data", "Could not load '" + std::string(ds.id) + "'");
      return;
    }
    if (first) st.doc.clear();
    st.loaded = true; st.failed = true;
    int bi = st.backoff < 3 ? st.backoff : 3;
    int delay = bi < 3 ? BACKOFF_S[bi] : (ds.ttl ? ds.ttl : 0);
    st.backoff++;
    st.due_ms = delay ? now_ms_ + (uint32_t)delay * 1000u : 0;
    if (!first_render_pending_) { alert_pending_ = "Data unavailable"; background_failed_ = true; }
  }
  if (first_render_pending_) {
    if (--awaiting_data_ <= 0) finalize_first_render();
  } else if (res.status == 200) {
    init_vars();
    rebind(false);
    fetch_images(false);
  }
}

// --------------------------------------------------------------------------------- images ---

void AppSession::clear_images() {
  for (int i = 0; i < MAX_IMAGES; i++) { image_free(images_[i].buf); images_[i].url.clear(); images_[i].etag.clear(); images_[i].due_ms = 0; images_[i].inflight = false; render_images_.slots[i] = nullptr; }
}

void AppSession::fetch_images(bool force) {
  if (!screen_) return;
  for (int i = 0; i < screen_->meta.image_count; i++) {
    const ImageSlot &slot = screen_->meta.images[i];
    if (slot.widget < 0 || slot.widget >= screen_->tree.count()) continue;
    const Widget &w = screen_->tree[slot.widget];
    ImageState &st = images_[i];
    if (st.inflight) continue;
    const char *tpl = w.src_src.is<const char *>() ? w.src_src.as<const char *>() : nullptr;
    std::string tpl_s = tpl ? tpl : expr::to_string(expr::eval_value(w.src_src, *this));
    FetchRequest req;
    std::string err;
    if (!build_request(tpl_s, JsonVariantConst(), JsonVariantConst(), true, "GET", req, err)) {
      hal::log(hal::LOG_WARN, TAG, "image %d: %s", i, err.c_str());
      if (st.buf.data) { image_free(st.buf); render_images_.slots[i] = nullptr; plan_.add(w.r); plan_dirty_ = true; }
      st.url.clear();
      continue;
    }
    bool changed = req.url != st.url;
    if (!force && !changed && !due(now_ms_, st.due_ms)) continue;
    if (changed) { st.etag.clear(); }
    st.url = req.url;
    add_screen_headers(req, req.url, st.etag);
    req.tag = make_tag(K_IMAGE, i);
    req.max_bytes = IMAGE_MAX_BYTES + 1;
    req.accept = "image/png";
    st.inflight = true;
    st.due_ms = 0;
    enqueue(req);
  }
}

void AppSession::handle_image_response(int i, const FetchResult &res) {
  if (!screen_ || i >= screen_->meta.image_count) return;
  const ImageSlot &slot = screen_->meta.images[i];
  ImageState &st = images_[i];
  st.inflight = false;
  const Widget &w = screen_->tree[slot.widget];
  int ttl = slot.ttl_set ? slot.ttl : screen_->meta.ttl;
  if (!res.error && res.status == 200 && res.body) {
    if (res.len > IMAGE_MAX_BYTES) hal::log(hal::LOG_WARN, TAG, "image %d over 256 kB", i);
    else if (png_decode(res.body, res.len, w.r.w, w.r.h, st.buf)) {
      render_images_.slots[i] = &st.buf;
      st.etag = res.etag ? res.etag : "";
      plan_.add(w.r);
      plan_dirty_ = true;
    }
    st.due_ms = ttl ? now_ms_ + (uint32_t)ttl * 1000u : 0;
  } else if (!res.error && res.status == 304) {
    st.due_ms = ttl ? now_ms_ + (uint32_t)ttl * 1000u : 0;
  } else {
    hal::log(hal::LOG_WARN, TAG, "image %d failed: status %d error %d", i, res.status, res.error);
    st.due_ms = now_ms_ + 30000;
  }
}

// ----------------------------------------------------------------------------------- vars ---

void AppSession::init_vars() {
  vars_.clear();
  vars_.to<JsonObject>();
  if (!screen_) return;
  JsonObject v = vars_.as<JsonObject>();
  for (int i = 0; i < screen_->meta.var_count; i++) {
    const VarDef &vd = screen_->meta.vars[i];
    expr::Value val = expr::eval_value(vd.value, *this);
    std::string k(vd.name);   // keys must be copied: ArduinoJson links const char* by pointer
    switch (val.type) {
      case expr::Value::NUM: v[k] = val.num; break;
      case expr::Value::BOOL: v[k] = val.b; break;
      case expr::Value::STR: v[k] = val.str; break;
      default: v[k] = ""; break;
    }
  }
}

void AppSession::apply_set(JsonVariantConst set) {
  if (!set.is<JsonObjectConst>()) return;
  if (!vars_.is<JsonObject>()) vars_.to<JsonObject>();
  JsonObject v = vars_.as<JsonObject>();
  for (JsonPairConst p : set.as<JsonObjectConst>()) {
    expr::Value val = expr::eval_value(p.value(), *this);
    std::string k(p.key().c_str());
    switch (val.type) {
      case expr::Value::NUM: v[k] = val.num; break;
      case expr::Value::BOOL: v[k] = val.b; break;
      case expr::Value::STR: v[k] = val.str; break;
      default: v[k] = ""; break;
    }
  }
}

// --------------------------------------------------------------------------------- rebind ---

void AppSession::rebind(bool force_full) {
  if (!screen_) return;
  WidgetTree &t = screen_->tree;
  t.reset_dyn();
  bool image_src_changed = false;
  for (int i = 0; i < t.count(); i++) {
    Widget &w = t[i];
    if (!w.src_when.isNull()) {
      w.visible = w.src_when.is<const char *>() ? expr::eval_cond(w.src_when.as<const char *>(), *this) : expr::truthy(expr::eval_value(w.src_when, *this));
    }
    if (!w.src_disabled.isNull()) {
      w.disabled = w.src_disabled.is<const char *>() ? expr::eval_cond(w.src_disabled.as<const char *>(), *this) : expr::truthy(expr::eval_value(w.src_disabled, *this));
    }
    std::string text, sub, src;
    if (!w.src_text.isNull()) { text = expr::to_string(expr::eval_value(w.src_text, *this)); w.text = t.add_dyn(text.c_str(), text.size()); }
    if (!w.src_sub.isNull()) { sub = expr::to_string(expr::eval_value(w.src_sub, *this)); w.sub = t.add_dyn(sub.c_str(), sub.size()); }
    if (!w.src_src.isNull()) {
      src = expr::to_string(expr::eval_value(w.src_src, *this));
      const char *old = t.str(w.src);
      if (strcmp(old, src.c_str()) != 0) image_src_changed = true;
      w.src = t.add_dyn(src.c_str(), src.size());
    }
    int v;
    if (!w.src_fill.isNull()) w.fill = expr::eval_int(w.src_fill, *this, v) ? (int8_t)(v < 0 ? 0 : v > 15 ? 15 : v) : -1;
    if (!w.src_stroke.isNull()) w.stroke = expr::eval_int(w.src_stroke, *this, v) ? (int8_t)(v < 0 ? 0 : v > 15 ? 15 : v) : -1;
    if (!w.src_color.isNull()) w.color = expr::eval_int(w.src_color, *this, v) ? (int8_t)(v < 0 ? 0 : v > 15 ? 15 : v) : (w.type == WType::BUTTON ? -1 : 0);
    if (!w.src_icon.isNull()) {
      std::string name = expr::to_string(expr::eval_value(w.src_icon, *this));
      w.icon = (int16_t)icons::index_of(name.c_str());
    }
    uint64_t h = 1469598103934665603ull;
    h = fnv(h, &w.visible, 1);
    h = fnv(h, &w.disabled, 1);
    h = fnv_str(h, t.str(w.text));
    h = fnv_str(h, t.str(w.sub));
    h = fnv_str(h, t.str(w.src));
    h = fnv(h, &w.fill, 1); h = fnv(h, &w.stroke, 1); h = fnv(h, &w.color, 1); h = fnv(h, &w.icon, 2);
    if (!force_full && h != w.hash) plan_.add(w.r);
    w.hash = h;
  }
  if (force_full) { plan_.full = true; plan_.count = 0; }
  plan_dirty_ = plan_.full || plan_.count > 0 || plan_dirty_;
  if (image_src_changed && !first_render_pending_) fetch_images(false);
}

bool AppSession::take_render(RenderPlan &plan) {
  if (!screen_ || !plan_dirty_) return false;
  WidgetTree &t = screen_->tree;
  for (int i = 0; i < t.count(); i++) {
    if (t[i].pressed) { if (!plan_.full) plan_.add(t[i].r); t[i].pressed = false; }
  }
  plan = plan_;
  plan_ = RenderPlan();
  plan_dirty_ = false;
  return true;
}

// -------------------------------------------------------------------------------- actions ---

void AppSession::tap(int x, int y, bool hold, int64_t epoch) {
  if (!screen_ || state_ != State::READY) return;
  int idx = screen_->tree.hit_test(x, y);
  if (idx < 0) return;
  Widget &w = screen_->tree[idx];
  JsonVariantConst action = hold && !w.on_hold.isNull() ? w.on_hold : w.on_tap;
  if (action.isNull()) return;
  run_action(action, idx, x, y, epoch);
}

bool AppSession::run_key(bool double_press, int64_t epoch) {
  if (!screen_ || state_ != State::READY) return false;
  JsonVariantConst action = double_press ? screen_->meta.key_double : screen_->meta.key_short;
  if (action.isNull()) return false;
  run_action(action, -1, 0, 0, epoch);
  return true;
}

void AppSession::arm_then(JsonVariantConst action, bool wait) {
  const char *then = action["then"] | "none";
  int after = action["after"] | 0;
  if (!strcmp(then, "none")) { then_ = Then(); return; }
  then_.armed = true;
  then_.wait = wait;
  then_.type = then;
  then_.url = action["url"] | "";
  if (!strcmp(then, "navigate")) then_.url = action["then_url"] | (action["url"] | "");
  then_.after = after < 0 ? 0 : after;
  then_.at_ms = now_ms_ + (uint32_t)then_.after * 1000u;
}

void AppSession::run_action(JsonVariantConst action, int widget_index, int x, int y, int64_t epoch) {
  const char *type = action["type"] | "";
  if (!strcmp(type, "navigate")) {
    const char *u = action["url"] | (const char *)nullptr;
    if (!u) { hal::log(hal::LOG_WARN, TAG, "navigate without url"); return; }
    bool replace = action["replace"] | false;
    load_screen(u, replace ? LoadMode::NAVIGATE_REPLACE : LoadMode::NAVIGATE_PUSH);
  } else if (!strcmp(type, "submit")) {
    const char *ev = action["event"] | (const char *)nullptr;
    if (!ev) { hal::log(hal::LOG_WARN, TAG, "submit without event"); return; }
    if (manifest.event.empty()) { hal::log(hal::LOG_INFO, TAG, "submit '%s' ignored: manifest has no event url", ev); return; }
    if (!action["set"].isNull()) { apply_set(action["set"]); rebind(false); }
    JsonDocument body;
    body["spec_version"] = 1;
    body["event"] = ev;
    body["screen"] = screen_ ? screen_->meta.id : "";
    if (widget_index >= 0 && widget_index < screen_->tree.count()) {
      const Widget &w = screen_->tree[widget_index];
      if (w.id) body["widget"] = screen_->tree.str(w.id);
      else { char b[16]; snprintf(b, sizeof b, "#%d", w.json_index); body["widget"] = b; }
    } else {
      body["widget"] = "#key";
    }
    JsonObject args = body["args"].to<JsonObject>();
    for (JsonPairConst p : action["args"].as<JsonObjectConst>()) args[std::string(p.key().c_str())] = expr::to_string(expr::eval_value(p.value(), *this));
    JsonObject vars = body["vars"].to<JsonObject>();
    for (JsonPairConst p : vars_.as<JsonObjectConst>()) vars[std::string(p.key().c_str())] = expr::to_string(expr::eval_value(p.value(), *this));
    body["x"] = x; body["y"] = y; body["ts"] = epoch;
    std::string s;
    serializeJson(body, s);
    std::string ev_url = url::resolve(app_origin_, manifest.event);
    arm_then(action, true);
    load_screen(ev_url, LoadMode::SUBMIT, s);
  } else if (!strcmp(type, "http")) {
    const char *u = action["url"] | (const char *)nullptr;
    if (!u) { hal::log(hal::LOG_WARN, TAG, "http without url"); return; }
    if (!action["set"].isNull()) { apply_set(action["set"]); rebind(false); }
    FetchRequest req;
    std::string err;
    const char *method = action["method"] | "GET";
    if (strcmp(method, "GET") && strcmp(method, "POST") && strcmp(method, "PUT") && strcmp(method, "DELETE")) method = "GET";
    if (!build_request(u, action["headers"], action["body"], action["body_raw"] | false, method, req, err)) { alert(err); return; }
    req.headers.push_back("X-Install-Id: " + install_id_);
    req.headers.push_back(std::string("X-App-Id: ") + manifest.id);
    req.headers.push_back("X-App-Version: " + manifest.version);
    req.tag = make_tag(K_HTTP, 0);
    req.max_bytes = DATA_MAX_BYTES;
    arm_then(action, true);
    http_inflight_ = true;
    enqueue(req);
  } else if (!strcmp(type, "set")) {
    apply_set(action["vars"].isNull() ? action["set"] : action["vars"]);
    rebind(false);
    arm_then(action, false);
  } else if (!strcmp(type, "refresh")) {
    refresh();
  } else if (!strcmp(type, "back")) {
    back();
  } else if (!strcmp(type, "home")) {
    home();
  } else {
    hal::log(hal::LOG_WARN, TAG, "unknown action type '%s'", type);
  }
}

void AppSession::handle_http_response(const FetchResult &res) {
  http_inflight_ = false;
  if (res.error || res.status >= 400) {
    std::string code, msg;
    if (res.error) msg = res.error == hal::HTTP_ERR_OFFLINE ? "Offline" : "Request failed";
    else if (!parse_error_body((const char *)res.body, res.len, code, msg) || msg.empty()) { char b[40]; snprintf(b, sizeof b, "Request failed (%d)", res.status); msg = b; }
    alert(msg);
    then_ = Then();
    return;
  }
  if (then_.armed && then_.wait) { then_.wait = false; then_.at_ms = now_ms_ + (uint32_t)then_.after * 1000u; }
}

void AppSession::run_then(const Then &t) {
  if (t.type == "refresh") refresh();
  else if (t.type == "back") back();
  else if (t.type == "home") home();
  else if (t.type == "navigate" && !t.url.empty()) load_screen(t.url, LoadMode::NAVIGATE_PUSH);
}

void AppSession::refresh() {
  if (!screen_) { home(); return; }
  for (int i = 0; i < screen_->meta.data_count; i++) if (!data_[i].inflight) fetch_data(i);
  if (!screen_inflight_) load_screen(screen_url_, LoadMode::REFRESH);
  fetch_images(true);
}

void AppSession::back() {
  if (history_.size() <= 1) { home(); return; }
  history_.pop_back();
  load_screen(history_.back().url, LoadMode::BACK);
}

void AppSession::home() {
  history_.clear();
  std::string entry = url::resolve(app_origin_, manifest.entry);
  load_screen(entry, LoadMode::HOME);
}

void AppSession::retry() {
  if (state_ != State::ERROR) return;
  if (error_url_.empty()) { home(); return; }
  load_screen(error_url_, error_mode_ == LoadMode::BACKGROUND || error_mode_ == LoadMode::REFRESH ? LoadMode::OPEN : error_mode_);
}

// --------------------------------------------------------------------------------- timers ---

void AppSession::arm_backoff() {
  int delay = backoff_idx_ < 3 ? BACKOFF_S[backoff_idx_] : (screen_ ? screen_->meta.ttl : 60);
  if (backoff_idx_ < 3) backoff_idx_++;
  screen_due_ms_ = delay ? now_ms_ + (uint32_t)delay * 1000u : 0;
}

void AppSession::tick(uint32_t now_ms, int64_t epoch) {
  now_ms_ = now_ms;
  epoch_ = epoch;
  pump_outbox();
  if (!alert_pending_.empty()) { alert(alert_pending_); alert_pending_.clear(); }
  if (epoch / 60 != last_minute_ && (state_ != State::READY || !screen_)) { last_minute_ = epoch / 60; update_device_doc(epoch); }
  if (state_ != State::READY || !screen_) return;
  if (!screen_inflight_ && due(now_ms, screen_due_ms_)) { screen_due_ms_ = 0; load_screen(screen_url_, LoadMode::BACKGROUND); }
  for (int i = 0; i < screen_->meta.data_count; i++) if (!data_[i].inflight && due(now_ms, data_[i].due_ms)) fetch_data(i);
  for (int i = 0; i < screen_->meta.image_count; i++) if (!images_[i].inflight && due(now_ms, images_[i].due_ms)) { fetch_images(false); break; }
  if (then_.armed && !then_.wait && due(now_ms, then_.at_ms)) { Then t = then_; then_ = Then(); run_then(t); }
  if (screen_->meta.uses_device_time && epoch / 60 != last_minute_) {
    last_minute_ = epoch / 60;
    update_device_doc(epoch);
    rebind(false);
  } else if (epoch / 60 != last_minute_) {
    last_minute_ = epoch / 60;
    update_device_doc(epoch);
  }
}

uint32_t AppSession::next_timer_ms(uint32_t now) const {
  uint32_t best = 0xFFFFFFFFu;
  auto consider = [&](uint32_t at) { if (!at) return; int32_t d = (int32_t)(at - now); uint32_t dd = d < 0 ? 0 : (uint32_t)d; if (dd < best) best = dd; };
  consider(screen_due_ms_);
  if (screen_) {
    for (int i = 0; i < screen_->meta.data_count; i++) consider(data_[i].due_ms);
    for (int i = 0; i < screen_->meta.image_count; i++) consider(images_[i].due_ms);
    if (screen_->meta.uses_device_time) consider(now + (uint32_t)(60 - (epoch_ % 60)) * 1000u);
  }
  if (then_.armed && !then_.wait) consider(then_.at_ms);
  return best;
}

// --------------------------------------------------------------------------------- errors ---

void AppSession::set_error(const char *code, const std::string &message) {
  state_ = State::ERROR;
  error_code_ = code ? code : "";
  error_ = message;
  hal::log(hal::LOG_WARN, TAG, "error [%s]: %s", error_code_.c_str(), error_.c_str());
}

void AppSession::alert(const std::string &message) {
  alert_ = message;
  hal::log(hal::LOG_INFO, TAG, "alert: %s", message.c_str());
}

const char *AppSession::take_alert() {
  static std::string last;
  if (alert_.empty()) return "";
  last = alert_;
  alert_.clear();
  return last.c_str();
}

}  // namespace rt
}  // namespace quire
