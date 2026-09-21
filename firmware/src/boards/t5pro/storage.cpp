// hal::Storage for the T5 E-Paper S3 Pro: key/value pairs in NVS (Preferences namespace "quireos"),
// files in LittleFS on the "spiffs" partition of partitions.csv.
#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <string.h>

#include "board_t5pro.h"

namespace quire {
namespace t5pro {
namespace {

const char *const TAG = "storage";
const char *const NVS_NS = "quireos";
constexpr size_t NVS_KEY_MAX = 15;   // NVS limit

bool g_fs_ok = false, g_fs_tried = false;

// NVS keys are at most 15 characters; longer OS keys are folded to 7 chars + '~' + 7 hex of FNV-1a.
const char *nvs_key(const char *key, char *buf, size_t len) {
  size_t n = strlen(key);
  if (n <= NVS_KEY_MAX) return key;
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < n; i++) {
    h ^= (uint8_t)key[i];
    h *= 16777619u;
  }
  snprintf(buf, len, "%.7s~%07lx", key, (unsigned long)(h & 0x0FFFFFFF));
  return buf;
}

bool mkdir_p(const char *path) {
  char tmp[128];
  strlcpy(tmp, path, sizeof(tmp));
  for (char *p = tmp + 1; *p; p++) {
    if (*p == '/') {
      *p = 0;
      if (!LittleFS.exists(tmp) && !LittleFS.mkdir(tmp)) return false;
      *p = '/';
    }
  }
  return true;
}

class T5Storage : public hal::Storage {
 public:
  bool begin() override {
    prefs_ok_ = prefs_.begin(NVS_NS, false);
    if (!prefs_ok_) hal::log(hal::LOG_ERROR, TAG, "NVS namespace %s failed", NVS_NS);
    bool fs = fs_mounted();
    if (fs)
      hal::log(hal::LOG_INFO, TAG, "LittleFS %u kB used of %u kB", (unsigned)(LittleFS.usedBytes() / 1024),
               (unsigned)(LittleFS.totalBytes() / 1024));
    return prefs_ok_ && fs;
  }

  bool kv_get(const char *key, char *buf, size_t len) override {
    if (!prefs_ok_ || !buf || !len) return false;
    char kb[NVS_KEY_MAX + 1];
    const char *k = nvs_key(key, kb, sizeof(kb));
    if (!prefs_.isKey(k)) return false;
    buf[0] = 0;
    size_t n = prefs_.getString(k, buf, len);
    if (n == 0) {
      hal::log(hal::LOG_WARN, TAG, "kv_get %s: buffer of %u too small", key, (unsigned)len);
      return false;
    }
    return true;
  }

  bool kv_set(const char *key, const char *value) override {
    if (!prefs_ok_) return false;
    char kb[NVS_KEY_MAX + 1];
    const char *k = nvs_key(key, kb, sizeof(kb));
    return prefs_.putString(k, value ? value : "") > 0 || (value && !*value);
  }

  bool kv_remove(const char *key) override {
    if (!prefs_ok_) return false;
    char kb[NVS_KEY_MAX + 1];
    return prefs_.remove(nvs_key(key, kb, sizeof(kb)));
  }

  bool file_read(const char *path, uint8_t **data, size_t *len) override {
    *data = nullptr;
    *len = 0;
    if (!fs_mounted()) return false;
    File f = LittleFS.open(path, "r");
    if (!f || f.isDirectory()) return false;
    size_t n = f.size();
    uint8_t *buf = (uint8_t *)hal::alloc_big(n + 1);
    if (!buf) {
      f.close();
      return false;
    }
    size_t got = n ? f.read(buf, n) : 0;
    f.close();
    if (got != n) {
      hal::free_big(buf);
      return false;
    }
    buf[n] = 0;
    *data = buf;
    *len = n;
    return true;
  }

  void file_free(uint8_t *data) override { hal::free_big(data); }

  bool file_write(const char *path, const uint8_t *data, size_t len) override {
    if (!fs_mounted()) return false;
    mkdir_p(path);
    File f = LittleFS.open(path, "w");
    if (!f) return false;
    size_t put = len ? f.write(data, len) : 0;
    f.close();
    if (put != len) {
      hal::log(hal::LOG_ERROR, TAG, "short write %s (%u of %u)", path, (unsigned)put, (unsigned)len);
      LittleFS.remove(path);
      return false;
    }
    return true;
  }

  bool file_remove(const char *path) override {
    if (!fs_mounted()) return false;
    File f = LittleFS.open(path, "r");
    bool dir = f && f.isDirectory();
    if (f) f.close();
    return dir ? LittleFS.rmdir(path) : LittleFS.remove(path);
  }

  bool file_exists(const char *path) override { return fs_mounted() && LittleFS.exists(path); }

  bool file_mkdir(const char *path) override {
    if (!fs_mounted()) return false;
    if (LittleFS.exists(path)) return true;
    char tmp[128];
    snprintf(tmp, sizeof(tmp), "%s/", path);
    return mkdir_p(tmp);
  }

  int file_list(const char *dir, ListFn fn, void *ctx) override {
    if (!fs_mounted()) return -1;
    File d = LittleFS.open(dir);
    if (!d || !d.isDirectory()) return -1;
    int n = 0;
    for (File f = d.openNextFile(); f; f = d.openNextFile()) {
      if (fn) fn(f.name(), f.size(), f.isDirectory(), ctx);
      n++;
    }
    d.close();
    return n;
  }

  size_t free_bytes() override {
    if (!fs_mounted()) return 0;
    size_t total = LittleFS.totalBytes(), used = LittleFS.usedBytes();
    return total > used ? total - used : 0;
  }

 private:
  Preferences prefs_;
  bool prefs_ok_ = false;
};

T5Storage &instance() {
  static T5Storage s;
  return s;
}

}  // namespace

bool fs_mounted() {
  if (g_fs_tried) return g_fs_ok;
  g_fs_tried = true;
  g_fs_ok = LittleFS.begin(true, "/littlefs", 10, "spiffs");
  if (!g_fs_ok) hal::log(hal::LOG_ERROR, TAG, "LittleFS mount failed");
  return g_fs_ok;
}

hal::Storage *make_storage() { return &instance(); }

}  // namespace t5pro
}  // namespace quire
