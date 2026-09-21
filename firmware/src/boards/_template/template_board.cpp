// QuireOS board template. Copy this directory to src/boards/<name>/, fill in every TODO, add a
// PlatformIO env with -DQUIREOS_BOARD_<NAME> (see docs/porting.md). Nothing outside src/boards may
// include vendor headers; everything the OS needs is behind hal.h.
#include "../../hal/hal.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

namespace quire {
namespace hal {

// ------------------------------------------------------------------------------- display ---
class TemplateDisplay : public Display {
 public:
  const DisplayCaps &caps() const override { return caps_; }
  bool begin(Rotation rot) override {
    // TODO: fill caps_ (native_w/h, bpp 1|2|4, greys 2|4|16, dpi, partial_update, fast_update,
    //       full_ms, partial_ms, rotations) and initialise the panel driver.
    caps_.native_w = 800; caps_.native_h = 480; caps_.bpp = 1; caps_.greys = 2; caps_.dpi = 125;
    return set_rotation(rot);
  }
  bool set_rotation(Rotation rot) override {
    rot_ = rot;
    bool swap = rot == Rotation::R90 || rot == Rotation::R270;
    w_ = swap ? caps_.native_h : caps_.native_w;
    h_ = swap ? caps_.native_w : caps_.native_h;
    return true;
  }
  Rotation rotation() const override { return rot_; }
  uint16_t width() const override { return w_; }
  uint16_t height() const override { return h_; }
  void present(const Framebuffer &fb, Rect region, UpdateMode mode) override {
    // TODO: quantise the 4-bit logical framebuffer to the panel depth, map logical (x, y) to native
    //       coordinates for rot_, and push `region` (or everything when partial updates are not
    //       supported). Blocking. 16 -> 4 greys: 0-3 -> 0, 4-7 -> 5, 8-11 -> 10, 12-15 -> 15;
    //       16 -> 2 greys: 0-7 -> 0, 8-15 -> 15 (SPEC §1).
    (void)fb; (void)region; (void)mode;
  }
  void power_off() override { /* TODO: panel rails off; the image must persist */ }
 private:
  DisplayCaps caps_;
  Rotation rot_ = Rotation::R0;
  uint16_t w_ = 0, h_ = 0;
};

// --------------------------------------------------------------------------------- input ---
class TemplateInput : public Input {
 public:
  const InputCaps &caps() const override { return caps_; }
  bool begin() override {
    // TODO: touch controller / buttons. Buttons are reported by id with short/long/double gestures.
    return true;
  }
  void set_rotation(Rotation rot) override { (void)rot; /* TODO: map touch coordinates to the logical screen */ }
  bool poll(Event &out) override { (void)out; return false; /* TODO: non-blocking */ }
 private:
  InputCaps caps_;
};

// --------------------------------------------------------------------------------- power ---
class TemplatePower : public Power {
 public:
  const PowerCaps &caps() const override { return caps_; }
  // TODO: battery_percent(), charging(), voltage_mv(), frontlight(level) when caps_ says so.
  void sleep(const WakeSources &w) override {
    // TODO: configure wake sources (touch interrupt, button GPIO, timer_ms) and enter deep sleep.
    //       On most boards this never returns: the OS restarts and reads wake_cause().
    (void)w;
  }
  WakeCause wake_cause() override { return WakeCause::POWER_ON; /* TODO */ }
 private:
  PowerCaps caps_;
};

// --------------------------------------------------------------------------------- clock ---
class TemplateClock : public Clock {
 public:
  int64_t now() override { return 0; /* TODO: RTC or system time (epoch seconds); 0 when unknown */ }
  void set(int64_t epoch) override { (void)epoch; /* TODO: after SNTP */ }
  bool valid() override { return false; }
};

// ------------------------------------------------------------------------------- storage ---
class TemplateStorage : public Storage {
 public:
  bool begin() override { return false; /* TODO: mount the filesystem, open NVS */ }
  // kv: values are NUL-terminated strings up to 2 kB. NVS limits keys to 15 characters; hash or
  // shorten longer keys (the OS uses "cfg/<app id>").
  bool kv_get(const char *key, char *buf, size_t len) override { (void)key; (void)buf; (void)len; return false; }
  bool kv_set(const char *key, const char *value) override { (void)key; (void)value; return false; }
  bool kv_remove(const char *key) override { (void)key; return false; }
  // files: absolute paths within the OS filesystem ("/apps/<id>/manifest.json").
  bool file_read(const char *path, uint8_t **data, size_t *len) override { (void)path; (void)data; (void)len; return false; }
  void file_free(uint8_t *data) override { free(data); }
  bool file_write(const char *path, const uint8_t *data, size_t len) override { (void)path; (void)data; (void)len; return false; }
  bool file_remove(const char *path) override { (void)path; return false; }   // directories recursively
  bool file_exists(const char *path) override { (void)path; return false; }
  bool file_mkdir(const char *path) override { (void)path; return false; }
  int file_list(const char *dir, ListFn fn, void *ctx) override { (void)dir; (void)fn; (void)ctx; return -1; }
  size_t free_bytes() override { return 0; }
};

// ----------------------------------------------------------------------------------- net ---
class TemplateNet : public Net {
 public:
  bool begin() override { return false; }
  bool connected() override { return false; }
  int rssi() override { return 0; }
  const char *ssid() override { return ""; }
  const char *ip() override { return ""; }
  bool has_credentials() override { return false; }
  bool connect(uint32_t timeout_ms) override { (void)timeout_ms; return false; }
  void forget() override {}
  void provision() override { /* TODO: captive portal; blocking; return when credentials are stored */ }
  // Blocking HTTP(S): no redirects, validate TLS against a CA bundle, honour req.max_bytes (fail
  // with HTTP_ERR_TOO_BIG), fill status/etag/content_type, NUL-terminate the body.
  bool http(const HttpRequest &req, HttpResponse &out) override { (void)req; out.error = HTTP_ERR_OFFLINE; return false; }
  void http_free(uint8_t *body) override { free(body); }
};

// --------------------------------------------------------------------------------- board ---
static TemplateDisplay g_display;
static TemplateInput g_input;
static TemplatePower g_power;
static TemplateClock g_clock;
static TemplateStorage g_storage;
static TemplateNet g_net;
static Board g_board;

Board &board() {
  if (!g_board.display) {
    g_board.name = "template";          // TODO
    g_board.profile = "t5pro";          // TODO: key into spec/fonts.json + spec/icons.json
    g_board.os_version = "0.1.0";       // use QUIREOS_VERSION from os/os.h
    g_board.default_rotation = Rotation::R0;
    g_board.display = &g_display; g_board.input = &g_input; g_board.power = &g_power;
    g_board.clock = &g_clock; g_board.storage = &g_storage; g_board.net = &g_net;
  }
  return g_board;
}
const char *device_hw_id() { return "000000000000"; /* TODO: 12 lowercase hex chars from the MAC */ }

// ------------------------------------------------------------------------ system functions ---
bool thread_start(const char *name, ThreadFn fn, void *arg, size_t stack_bytes, int priority) {
  (void)name; (void)fn; (void)arg; (void)stack_bytes; (void)priority;
  return false;   // TODO: xTaskCreatePinnedToCore or std::thread
}
void *mutex_create() { return nullptr; }     // TODO
void mutex_lock(void *m) { (void)m; }
void mutex_unlock(void *m) { (void)m; }
uint32_t millis() { return 0; }              // TODO
void delay_ms(uint32_t ms) { (void)ms; }
void yield() {}
uint32_t random_u32() { return 4; }          // TODO: esp_random()
void *alloc_big(size_t bytes) { return malloc(bytes); }   // TODO: PSRAM when available
void free_big(void *p) { free(p); }
void log(LogLevel level, const char *tag, const char *fmt, ...) {
  (void)level;
  va_list ap;
  va_start(ap, fmt);
  printf("[%s] ", tag);
  vprintf(fmt, ap);
  printf("\n");
  va_end(ap);
}
void reboot() { /* TODO: esp_restart() */ }

}  // namespace hal
}  // namespace quire
