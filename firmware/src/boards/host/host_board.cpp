// Host implementations of every hal.h interface.
#include "host_board.h"
#include <curl/curl.h>
#include <dirent.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <chrono>
#include <deque>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

namespace quire {
namespace host {

using namespace quire::hal;

static const Preset PRESETS[] = {
  {"t5pro", "LilyGo T5 E-Paper S3 Pro", 960, 540, 16, 4, 235, true, true, Rotation::R90},
  {"trmnl", "TRMNL 7.5\"", 800, 480, 2, 1, 125, false, false, Rotation::R0},
};
static const Preset *g_preset = &PRESETS[0];
static std::string g_data_dir = "emu/data";
static void (*g_reboot)() = nullptr;
static LogLevel g_log_level = LOG_INFO;
static uint32_t g_frame_version = 0;
static bool g_asleep = false;
static uint32_t g_sleep_deadline = 0;
static WakeCause g_wake = WakeCause::POWER_ON;

const Preset *find_preset(const char *name) {
  for (const Preset &p : PRESETS) if (name && !strcmp(p.name, name)) return &p;
  return nullptr;
}
const Preset *current_preset() { return g_preset; }
const std::string &data_dir() { return g_data_dir; }
void set_reboot_handler(void (*fn)()) { g_reboot = fn; }
void set_log_level(LogLevel l) { g_log_level = l; }

// ------------------------------------------------------------------------------- display ---
class HostDisplay : public Display {
 public:
  const DisplayCaps &caps() const override { return caps_; }
  bool begin(Rotation rot) override {
    caps_.native_w = g_preset->native_w; caps_.native_h = g_preset->native_h;
    caps_.greys = g_preset->greys; caps_.bpp = g_preset->bpp; caps_.dpi = g_preset->dpi;
    caps_.partial_update = g_preset->partial; caps_.fast_update = g_preset->partial;
    caps_.full_ms = 1200; caps_.partial_ms = 350;
    set_rotation(rot);
    return true;
  }
  bool set_rotation(Rotation rot) override {
    rot_ = rot;
    bool swap = rot == Rotation::R90 || rot == Rotation::R270;
    uint16_t w = swap ? caps_.native_h : caps_.native_w;
    uint16_t h = swap ? caps_.native_w : caps_.native_h;
    if (panel_.data) free(panel_.data);
    panel_.w = w; panel_.h = h;
    panel_.data = (uint8_t *)malloc(panel_.bytes());
    panel_.fill(15);
    g_frame_version++;
    return true;
  }
  Rotation rotation() const override { return rot_; }
  uint16_t width() const override { return panel_.w; }
  uint16_t height() const override { return panel_.h; }
  void present(const Framebuffer &fb, Rect region, UpdateMode mode) override {
    Rect full; full.w = (int16_t)panel_.w; full.h = (int16_t)panel_.h;
    Rect r = (caps_.partial_update && mode != UpdateMode::FULL) ? region.clipped(full) : full;
    if (r.empty() || fb.w != panel_.w || fb.h != panel_.h) { if (fb.w != panel_.w) fprintf(stderr, "[host] present: framebuffer size mismatch\n"); return; }
    for (int y = r.y; y < r.y + r.h; y++)
      for (int x = r.x; x < r.x + r.w; x++) panel_.set(x, y, quantise(fb.get(x, y)));
    g_frame_version++;
    presents_++;
    fprintf(stderr, "[host] present %s %d,%d %dx%d (frame %u)\n",
            mode == UpdateMode::FULL ? "FULL" : mode == UpdateMode::PARTIAL ? "PARTIAL" : "FAST", r.x, r.y, r.w, r.h, g_frame_version);
  }
  void power_off() override {}
  const Framebuffer &panel() const { return panel_; }

 private:
  uint8_t quantise(uint8_t v) const {
    switch (caps_.greys) {
      case 16: return v;
      case 4: return v < 4 ? 0 : v < 8 ? 5 : v < 12 ? 10 : 15;
      default: return v < 8 ? 0 : 15;
    }
  }
  DisplayCaps caps_;
  Rotation rot_ = Rotation::R0;
  Framebuffer panel_;
  int presents_ = 0;
};

// --------------------------------------------------------------------------------- input ---
static const ButtonInfo BUTTONS[] = {{1, "S3"}, {2, "BOOT"}};
class HostInput : public Input {
 public:
  const InputCaps &caps() const override { return caps_; }
  bool begin() override {
    caps_.touch = g_preset->touch; caps_.touch_points = g_preset->touch ? 5 : 0;
    caps_.button_count = 2; caps_.buttons = BUTTONS;
    return true;
  }
  void set_rotation(Rotation) override {}
  bool poll(Event &out) override {
    std::lock_guard<std::mutex> g(m_);
    if (q_.empty()) return false;
    out = q_.front(); q_.pop_front();
    return true;
  }
  void push(const Event &e) { std::lock_guard<std::mutex> g(m_); q_.push_back(e); }
 private:
  InputCaps caps_;
  std::mutex m_;
  std::deque<Event> q_;
};

// --------------------------------------------------------------------------------- power ---
class HostPower : public Power {
 public:
  const PowerCaps &caps() const override { return caps_; }
  int battery_percent() override { return 72; }
  int voltage_mv() override { return 3950; }
  bool charging() override { return false; }
  void frontlight(uint8_t level) override { fprintf(stderr, "[host] frontlight %u\n", level); }
  void sleep(const WakeSources &w) override {
    fprintf(stderr, "[host] sleep (touch=%d button=%d timer=%u ms) - next tap wakes\n", w.touch, w.button, w.timer_ms);
    g_asleep = true;
    g_sleep_deadline = w.timer_ms ? millis() + w.timer_ms : 0;
  }
  WakeCause wake_cause() override { return g_wake; }
  size_t free_heap() override { return 200 * 1024; }
  size_t free_psram() override { return 4 * 1024 * 1024; }
 private:
  PowerCaps caps_ = {true, true, true, true};
};

// --------------------------------------------------------------------------------- clock ---
class HostClock : public Clock {
 public:
  int64_t now() override { return (int64_t)time(nullptr) + offset_; }
  void set(int64_t epoch) override { offset_ = epoch - (int64_t)time(nullptr); }
  bool valid() override { return true; }
 private:
  int64_t offset_ = 0;
};

// ------------------------------------------------------------------------------- storage ---
static std::string json_escape(const std::string &s) {
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o.push_back('\\'); o.push_back((char)c); }
    else if (c == '\n') o += "\\n";
    else if (c == '\r') o += "\\r";
    else if (c == '\t') o += "\\t";
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o.push_back((char)c);
  }
  return o;
}
static bool json_unescape(const char *&p, std::string &out) {
  if (*p != '"') return false;
  p++;
  while (*p && *p != '"') {
    if (*p == '\\') {
      p++;
      switch (*p) {
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': { unsigned v = 0; sscanf(p + 1, "%4x", &v); if (v < 0x80) out.push_back((char)v); else { out.push_back((char)(0xC0 | (v >> 6))); out.push_back((char)(0x80 | (v & 0x3F))); } p += 4; break; }
        default: out.push_back(*p); break;
      }
      p++;
    } else out.push_back(*p++);
  }
  if (*p == '"') p++;
  return true;
}
static void mkdir_p(const std::string &path) {
  std::string cur;
  for (size_t i = 0; i < path.size(); i++) {
    cur.push_back(path[i]);
    if (path[i] == '/' && cur.size() > 1) mkdir(cur.c_str(), 0755);
  }
  mkdir(path.c_str(), 0755);
}

class HostStorage : public Storage {
 public:
  bool begin() override {
    mkdir_p(g_data_dir);
    mkdir_p(g_data_dir + "/fs");
    load();
    return true;
  }
  bool kv_get(const char *key, char *buf, size_t len) override {
    std::lock_guard<std::mutex> g(m_);
    auto it = kv_.find(key);
    if (it == kv_.end()) return false;
    snprintf(buf, len, "%s", it->second.c_str());
    return true;
  }
  bool kv_set(const char *key, const char *value) override {
    std::lock_guard<std::mutex> g(m_);
    kv_[key] = value ? value : "";
    save();
    return true;
  }
  bool kv_remove(const char *key) override {
    std::lock_guard<std::mutex> g(m_);
    kv_.erase(key);
    save();
    return true;
  }
  bool file_read(const char *path, uint8_t **data, size_t *len) override {
    FILE *f = fopen(fs(path).c_str(), "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *b = (uint8_t *)malloc((size_t)n + 1);
    if (!b) { fclose(f); return false; }
    size_t got = fread(b, 1, (size_t)n, f);
    fclose(f);
    b[got] = 0;
    *data = b; *len = got;
    return true;
  }
  void file_free(uint8_t *data) override { free(data); }
  bool file_write(const char *path, const uint8_t *data, size_t len) override {
    std::string p = fs(path);
    size_t sl = p.rfind('/');
    if (sl != std::string::npos) mkdir_p(p.substr(0, sl));
    FILE *f = fopen(p.c_str(), "wb");
    if (!f) return false;
    bool ok = fwrite(data, 1, len, f) == len;
    fclose(f);
    return ok;
  }
  bool file_remove(const char *path) override {
    std::string p = fs(path);
    struct stat st;
    if (stat(p.c_str(), &st) != 0) return false;
    if (S_ISDIR(st.st_mode)) {
      DIR *d = opendir(p.c_str());
      if (d) { dirent *e; while ((e = readdir(d))) { if (strcmp(e->d_name, ".") && strcmp(e->d_name, "..")) file_remove((std::string(path) + "/" + e->d_name).c_str()); } closedir(d); }
      return rmdir(p.c_str()) == 0;
    }
    return unlink(p.c_str()) == 0;
  }
  bool file_exists(const char *path) override { struct stat st; return stat(fs(path).c_str(), &st) == 0; }
  bool file_mkdir(const char *path) override { mkdir_p(fs(path)); return true; }
  int file_list(const char *dir, ListFn fn, void *ctx) override {
    DIR *d = opendir(fs(dir).c_str());
    if (!d) return -1;
    int n = 0;
    dirent *e;
    while ((e = readdir(d))) {
      if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
      struct stat st;
      std::string full = fs((std::string(dir) + "/" + e->d_name).c_str());
      stat(full.c_str(), &st);
      fn(e->d_name, (size_t)st.st_size, S_ISDIR(st.st_mode), ctx);
      n++;
    }
    closedir(d);
    return n;
  }
  size_t free_bytes() override { return 8 * 1024 * 1024; }

 private:
  std::string fs(const char *path) const { return g_data_dir + "/fs" + (path && path[0] == '/' ? "" : "/") + (path ? path : ""); }
  void load() {
    kv_.clear();
    FILE *f = fopen((g_data_dir + "/kv.json").c_str(), "rb");
    if (!f) return;
    std::string s;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) s.append(buf, n);
    fclose(f);
    const char *p = s.c_str();
    while (*p && *p != '{') p++;
    if (*p) p++;
    while (*p) {
      while (*p && *p != '"' && *p != '}') p++;
      if (*p != '"') break;
      std::string k, v;
      json_unescape(p, k);
      while (*p && *p != ':') p++;
      if (*p) p++;
      while (*p == ' ' || *p == '\n') p++;
      if (!json_unescape(p, v)) break;
      kv_[k] = v;
      while (*p && *p != ',' && *p != '}') p++;
      if (*p == ',') p++;
    }
  }
  void save() {
    std::string tmp = g_data_dir + "/kv.json.tmp";
    FILE *f = fopen(tmp.c_str(), "wb");
    if (!f) return;
    fprintf(f, "{\n");
    bool first = true;
    for (auto &kv : kv_) {
      fprintf(f, "%s  \"%s\": \"%s\"", first ? "" : ",\n", json_escape(kv.first).c_str(), json_escape(kv.second).c_str());
      first = false;
    }
    fprintf(f, "\n}\n");
    fclose(f);
    rename(tmp.c_str(), (g_data_dir + "/kv.json").c_str());
  }
  std::mutex m_;
  std::map<std::string, std::string> kv_;
};

// ----------------------------------------------------------------------------------- net ---
struct CurlBuf { uint8_t *p = nullptr; size_t len = 0, cap = 0, max = 0; bool over = false; };
static size_t on_body(char *d, size_t sz, size_t nm, void *ud) {
  CurlBuf *b = (CurlBuf *)ud;
  size_t n = sz * nm;
  if (b->len + n > b->max) { b->over = true; return 0; }
  if (b->len + n + 1 > b->cap) {
    size_t nc = b->cap ? b->cap * 2 : 16384;
    while (nc < b->len + n + 1) nc *= 2;
    b->p = (uint8_t *)realloc(b->p, nc);
    b->cap = nc;
  }
  memcpy(b->p + b->len, d, n);
  b->len += n;
  b->p[b->len] = 0;
  return n;
}
static size_t on_header(char *d, size_t sz, size_t nm, void *ud) {
  HttpResponse *r = (HttpResponse *)ud;
  size_t n = sz * nm;
  std::string line(d, n);
  while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
  size_t c = line.find(':');
  if (c == std::string::npos) return n;
  std::string name = line.substr(0, c), value = line.substr(c + 1);
  for (char &ch : name) if (ch >= 'A' && ch <= 'Z') ch = (char)(ch + 32);
  size_t s = value.find_first_not_of(" \t");
  value = s == std::string::npos ? "" : value.substr(s);
  if (name == "etag") snprintf(r->etag, sizeof r->etag, "%s", value.c_str());
  else if (name == "content-type") snprintf(r->content_type, sizeof r->content_type, "%s", value.c_str());
  return n;
}

class HostNet : public Net {
 public:
  bool begin() override { static bool inited = false; if (!inited) { curl_global_init(CURL_GLOBAL_DEFAULT); inited = true; } return true; }
  bool connected() override { return true; }
  int rssi() override { return -55; }
  const char *ssid() override { return "host"; }
  const char *ip() override { return "127.0.0.1"; }
  bool has_credentials() override { return true; }
  bool connect(uint32_t) override { return true; }
  void forget() override { fprintf(stderr, "[host] wifi forget (no-op)\n"); }
  void provision() override { fprintf(stderr, "[host] provisioning portal is not applicable on the host\n"); }
  bool http(const HttpRequest &req, HttpResponse &out) override {
    out = HttpResponse();
    auto t0 = std::chrono::steady_clock::now();
    CURL *c = curl_easy_init();
    if (!c) { out.error = HTTP_ERR_PROTOCOL; return false; }
    CurlBuf b; b.max = req.max_bytes;
    curl_slist *hdrs = nullptr;
    for (size_t i = 0; i < req.header_count; i++) hdrs = curl_slist_append(hdrs, req.headers[i]);
    hdrs = curl_slist_append(hdrs, "Accept-Encoding: identity");
    curl_easy_setopt(c, CURLOPT_URL, req.url);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, (long)req.timeout_ms);
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT_MS, 5000L);
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &b);
    curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(c, CURLOPT_HEADERDATA, &out);
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_CUSTOMREQUEST, req.method);
    if (req.body && req.body_len) {
      curl_easy_setopt(c, CURLOPT_POSTFIELDS, req.body);
      curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, (long)req.body_len);
    }
    CURLcode rc = curl_easy_perform(c);
    long code = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(hdrs);
    curl_easy_cleanup(c);
    out.elapsed_ms = (uint32_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    out.status = (int)code;
    if (b.over) { free(b.p); out.error = HTTP_ERR_TOO_BIG; }
    else if (rc == CURLE_OPERATION_TIMEDOUT) { free(b.p); out.error = HTTP_ERR_TIMEOUT; }
    else if (rc == CURLE_COULDNT_CONNECT || rc == CURLE_COULDNT_RESOLVE_HOST) { free(b.p); out.error = HTTP_ERR_CONNECT; }
    else if (rc == CURLE_SSL_CONNECT_ERROR || rc == CURLE_PEER_FAILED_VERIFICATION) { free(b.p); out.error = HTTP_ERR_TLS; }
    else if (rc != CURLE_OK) { free(b.p); out.error = HTTP_ERR_PROTOCOL; }
    else {
      if (!b.p) { b.p = (uint8_t *)malloc(1); b.p[0] = 0; }
      out.body = b.p; out.len = b.len;
    }
    fprintf(stderr, "[http] %s %s -> %d%s %zu B %u ms\n", req.method, req.url, out.status,
            out.error ? " (error)" : "", out.len, out.elapsed_ms);
    return out.error == 0;
  }
  void http_free(uint8_t *body) override { free(body); }
};

// --------------------------------------------------------------------------------- board ---
static HostDisplay g_display;
static HostInput g_input;
static HostPower g_power;
static HostClock g_clock;
static HostStorage g_storage;
static HostNet g_net;
static Board g_board;
static char g_hw_id[13] = "000000000000";

void init(const char *preset_name, const std::string &data_dir, const char *os_version) {
  const Preset *p = find_preset(preset_name);
  if (p) g_preset = p;
  g_data_dir = data_dir;
  g_board.name = "host";
  g_board.profile = g_preset->name;
  g_board.os_version = os_version;
  g_board.default_rotation = g_preset->default_rotation;
  g_board.display = &g_display;
  g_board.input = &g_input;
  g_board.power = &g_power;
  g_board.clock = &g_clock;
  g_board.storage = &g_storage;
  g_board.net = &g_net;
  char hn[256] = "host";
  gethostname(hn, sizeof hn);
  uint64_t h = 1469598103934665603ull;
  for (const char *c = hn; *c; c++) { h ^= (uint8_t)*c; h *= 1099511628211ull; }
  for (const char *c = g_preset->name; *c; c++) { h ^= (uint8_t)*c; h *= 1099511628211ull; }
  snprintf(g_hw_id, sizeof g_hw_id, "%012llx", (unsigned long long)(h & 0xFFFFFFFFFFFFull));
  g_asleep = false;
  g_wake = WakeCause::POWER_ON;
}

void push_tap(int x, int y, bool hold) {
  Event e; e.kind = hold ? Event::HOLD : Event::TAP; e.x = (int16_t)x; e.y = (int16_t)y;
  g_input.push(e);
}
void push_button(uint8_t id, Gesture g) {
  Event e; e.kind = Event::BUTTON; e.button = id; e.gesture = g;
  g_input.push(e);
}
uint32_t frame_version() { return g_frame_version; }
const Framebuffer &panel() { return g_display.panel(); }
bool asleep() { return g_asleep; }
uint32_t sleep_deadline_ms() { return g_sleep_deadline; }
void wake(WakeCause cause) { g_asleep = false; g_sleep_deadline = 0; g_wake = cause; }

}  // namespace host

// ------------------------------------------------------------------------ hal free funcs ---
namespace hal {

Board &board() { return host::g_board; }
const char *device_hw_id() { return host::g_hw_id; }

bool thread_start(const char *, ThreadFn fn, void *arg, size_t, int) {
  std::thread t([fn, arg]() { fn(arg); });
  t.detach();
  return true;
}
void *mutex_create() { return new std::mutex(); }
void mutex_lock(void *m) { ((std::mutex *)m)->lock(); }
void mutex_unlock(void *m) { ((std::mutex *)m)->unlock(); }
uint32_t millis() {
  static auto t0 = std::chrono::steady_clock::now();
  return (uint32_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
}
void delay_ms(uint32_t ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }
void yield() {}
uint32_t random_u32() { return arc4random(); }
void *alloc_big(size_t bytes) { return malloc(bytes); }
void free_big(void *p) { free(p); }
void log(LogLevel level, const char *tag, const char *fmt, ...) {
  if (level > host::g_log_level) return;
  static const char *L[] = {"E", "W", "I", "D"};
  fprintf(stderr, "[%s][%s] ", L[level & 3], tag);
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  va_end(ap);
  fputc('\n', stderr);
}
void reboot() {
  fprintf(stderr, "[host] reboot requested\n");
  if (host::g_reboot) host::g_reboot();
}

}  // namespace hal
}  // namespace quire
