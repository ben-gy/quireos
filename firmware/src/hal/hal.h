// QuireOS hardware abstraction layer.
//
// Everything under firmware/src/os and firmware/src/runtime includes ONLY this header (and the
// standard library). Board implementations live under firmware/src/boards/<name>/ and provide
// quire::hal::board(). No pin numbers, bus addresses, vendor drivers or RTOS calls outside a board.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace quire {
namespace hal {

// ----------------------------------------------------------------------------- geometry ---
struct Rect {
  int16_t x = 0, y = 0, w = 0, h = 0;
  bool contains(int px, int py) const { return px >= x && py >= y && px < x + w && py < y + h; }
  bool intersects(const Rect &o) const {
    return !(o.x >= x + w || o.x + o.w <= x || o.y >= y + h || o.y + o.h <= y);
  }
  Rect united(const Rect &o) const;
  Rect clipped(const Rect &o) const;
  bool empty() const { return w <= 0 || h <= 0; }
};

// Rotation of the logical screen relative to the panel's native orientation.
enum class Rotation : uint8_t { R0 = 0, R90 = 1, R180 = 2, R270 = 3 };

// --------------------------------------------------------------------------- framebuffer ---
// The OS renders into ONE logical framebuffer, always 4 bits per pixel, two pixels per byte,
// LOW nibble = left pixel (even x), HIGH nibble = right pixel (odd x). 0 = black .. 15 = white.
// Row stride is (w + 1) / 2 bytes, origin top-left, in the logical (rotated) orientation.
// Boards quantise to their native depth inside present().
struct Framebuffer {
  uint8_t *data = nullptr;
  uint16_t w = 0, h = 0;

  size_t stride() const { return (size_t)(w + 1) / 2; }
  size_t bytes() const { return stride() * h; }
  inline uint8_t get(int x, int y) const {
    if (x < 0 || y < 0 || x >= w || y >= h) return 15;
    uint8_t b = data[(size_t)y * stride() + (size_t)x / 2];
    return (x & 1) ? (b >> 4) : (b & 0x0F);
  }
  inline void set(int x, int y, uint8_t v) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    uint8_t *p = &data[(size_t)y * stride() + (size_t)x / 2];
    if (x & 1) *p = (uint8_t)((*p & 0x0F) | ((v & 0x0F) << 4));
    else       *p = (uint8_t)((*p & 0xF0) | (v & 0x0F));
  }
  void fill(uint8_t v);
  void fill_rect(Rect r, uint8_t v);
  void invert_rect(Rect r);
};

// ------------------------------------------------------------------------------- display ---
enum class UpdateMode : uint8_t {
  FULL,     // clean refresh (flash); clears ghosting
  PARTIAL,  // update only changed pixels in `region`, no flash; may ghost slightly
  FAST,     // fastest available mode for feedback (e.g. tap invert); may be 1-bit
};

struct DisplayCaps {
  uint16_t native_w = 0, native_h = 0;
  uint8_t bpp = 4;          // native bits per pixel: 1, 2 or 4
  uint8_t greys = 16;       // 2, 4 or 16
  uint16_t dpi = 150;
  bool partial_update = false;
  bool fast_update = false;
  uint16_t full_ms = 1500;  // typical durations, informational
  uint16_t partial_ms = 300;
  uint8_t rotations = 0x0F; // bitmask: bit n set => Rotation(n) supported
};

class Display {
 public:
  virtual ~Display() = default;
  virtual const DisplayCaps &caps() const = 0;
  virtual bool begin(Rotation rot) = 0;
  virtual bool set_rotation(Rotation rot) = 0;
  virtual Rotation rotation() const = 0;
  virtual uint16_t width() const = 0;   // logical, after rotation
  virtual uint16_t height() const = 0;
  // Push `region` of the logical framebuffer to glass. Blocking. `region` is clipped by the board.
  // Boards without partial support treat every mode as FULL.
  virtual void present(const Framebuffer &fb, Rect region, UpdateMode mode) = 0;
  virtual void power_off() = 0;         // panel rails off; the image persists
  virtual float temperature_c() { return 20.0f; }
};

// --------------------------------------------------------------------------------- input ---
struct ButtonInfo { uint8_t id; const char *label; };
struct InputCaps {
  bool touch = false;
  uint8_t touch_points = 0;
  uint8_t button_count = 0;
  const ButtonInfo *buttons = nullptr;
};
enum class Gesture : uint8_t { SHORT, LONG, DOUBLE };
struct Event {
  enum Kind : uint8_t { NONE, TAP, HOLD, BUTTON } kind = NONE;
  int16_t x = 0, y = 0;         // TAP/HOLD, logical coordinates
  uint8_t button = 0;           // BUTTON
  Gesture gesture = Gesture::SHORT;
};

class Input {
 public:
  virtual ~Input() = default;
  virtual const InputCaps &caps() const = 0;
  virtual bool begin() = 0;
  virtual void set_rotation(Rotation rot) = 0;   // touch coordinates follow the logical screen
  virtual bool poll(Event &out) = 0;             // non-blocking; true when an event is produced
};

// --------------------------------------------------------------------------------- power ---
struct WakeSources { bool touch = false; bool button = false; uint32_t timer_ms = 0; };
enum class WakeCause : uint8_t { POWER_ON, TOUCH, BUTTON, TIMER, OTHER };
struct PowerCaps { bool battery = false; bool charging = false; bool frontlight = false; bool deep_sleep = false; };

class Power {
 public:
  virtual ~Power() = default;
  virtual const PowerCaps &caps() const = 0;
  virtual int battery_percent() { return -1; }   // -1 = unknown
  virtual int voltage_mv() { return 0; }
  virtual bool charging() { return false; }
  virtual void frontlight(uint8_t level) { (void)level; }   // 0..255
  virtual void sleep(const WakeSources &w) = 0;  // deep sleep; on most boards never returns
  virtual WakeCause wake_cause() = 0;
  virtual size_t free_heap() { return 0; }
  virtual size_t free_psram() { return 0; }
};

// --------------------------------------------------------------------------------- clock ---
class Clock {
 public:
  virtual ~Clock() = default;
  virtual int64_t now() = 0;          // epoch seconds; 0 when unknown
  virtual void set(int64_t epoch) = 0;
  virtual bool valid() = 0;
};

// ------------------------------------------------------------------------------- storage ---
class Storage {
 public:
  virtual ~Storage() = default;
  virtual bool begin() = 0;
  // Small persistent key/value pairs (NVS on ESP32). Values are NUL-terminated strings ≤ 2 kB.
  virtual bool kv_get(const char *key, char *buf, size_t len) = 0;   // false when missing
  virtual bool kv_set(const char *key, const char *value) = 0;
  virtual bool kv_remove(const char *key) = 0;
  // Files for larger blobs. Paths are absolute within the OS filesystem, e.g. "/apps/hn/manifest.json".
  // file_read allocates (PSRAM when available); free with file_free.
  virtual bool file_read(const char *path, uint8_t **data, size_t *len) = 0;
  virtual void file_free(uint8_t *data) = 0;
  virtual bool file_write(const char *path, const uint8_t *data, size_t len) = 0;
  virtual bool file_remove(const char *path) = 0;
  virtual bool file_exists(const char *path) = 0;
  virtual bool file_mkdir(const char *path) = 0;
  typedef void (*ListFn)(const char *name, size_t size, bool is_dir, void *ctx);
  virtual int file_list(const char *dir, ListFn fn, void *ctx) = 0;   // number of entries or -1
  virtual size_t free_bytes() = 0;
};

// ----------------------------------------------------------------------------------- net ---
struct HttpRequest {
  const char *method = "GET";
  const char *url = nullptr;
  const uint8_t *body = nullptr;
  size_t body_len = 0;
  const char *const *headers = nullptr;   // "Name: value" strings
  size_t header_count = 0;
  uint32_t timeout_ms = 10000;
  size_t max_bytes = 32 * 1024;           // response bodies above this fail with error TOO_BIG
};
struct HttpResponse {
  int status = 0;
  int error = 0;            // 0 ok; negative HttpError otherwise
  uint8_t *body = nullptr;  // NUL-terminated for convenience; free with Net::http_free
  size_t len = 0;
  char etag[96] = {0};
  char content_type[64] = {0};
  uint32_t elapsed_ms = 0;
};
enum HttpError : int { HTTP_OK = 0, HTTP_ERR_OFFLINE = -1, HTTP_ERR_CONNECT = -2, HTTP_ERR_TLS = -3,
                       HTTP_ERR_TIMEOUT = -4, HTTP_ERR_TOO_BIG = -5, HTTP_ERR_PROTOCOL = -6, HTTP_ERR_REFUSED = -7 };

class Net {
 public:
  virtual ~Net() = default;
  virtual bool begin() = 0;
  virtual bool connected() = 0;
  virtual int rssi() = 0;
  virtual const char *ssid() = 0;
  virtual const char *ip() = 0;
  virtual bool has_credentials() = 0;
  virtual bool connect(uint32_t timeout_ms) = 0;
  virtual void forget() = 0;
  virtual void provision() = 0;   // blocking captive portal on Wi-Fi boards; no-op on host
  // Blocking HTTP(S). The OS calls this from its network task, never from the UI loop.
  virtual bool http(const HttpRequest &req, HttpResponse &out) = 0;
  virtual void http_free(uint8_t *body) = 0;
  virtual void poll() {}
};

// -------------------------------------------------------------------------------- system ---
// Minimal threading so the OS can run its network task on any RTOS or on a host thread.
typedef void (*ThreadFn)(void *arg);
bool thread_start(const char *name, ThreadFn fn, void *arg, size_t stack_bytes, int priority);
void *mutex_create();
void mutex_lock(void *m);
void mutex_unlock(void *m);
uint32_t millis();
void delay_ms(uint32_t ms);
void yield();                                  // feed watchdogs / service background work
uint32_t random_u32();
void *alloc_big(size_t bytes);                 // PSRAM when available, else heap
void free_big(void *p);
enum LogLevel : uint8_t { LOG_ERROR = 0, LOG_WARN, LOG_INFO, LOG_DEBUG };
void log(LogLevel level, const char *tag, const char *fmt, ...);
void reboot();

// --------------------------------------------------------------------------------- board ---
struct Board {
  const char *name = "unknown";       // e.g. "t5pro"
  const char *profile = "unknown";    // key into spec/fonts.json + icons.json
  const char *os_version = "0.0.0";
  Rotation default_rotation = Rotation::R0;
  Display *display = nullptr;
  Input *input = nullptr;
  Power *power = nullptr;
  Clock *clock = nullptr;
  Storage *storage = nullptr;
  Net *net = nullptr;
};

// Provided by the selected board implementation. Must be callable before begin() of any device.
Board &board();
// Convenience: "540x960x16@235" for the current logical orientation.
const char *screen_string(char *buf, size_t len);
// Stable hardware id, 12 lowercase hex chars (derived from MAC or host name).
const char *device_hw_id();

}  // namespace hal
}  // namespace quire
