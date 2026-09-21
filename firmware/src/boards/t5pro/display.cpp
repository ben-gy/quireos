// hal::Display for the T5 E-Paper S3 Pro over epdiy (epd_board_v7 + ED047TC1), the driver and board
// definition LilyGo's factory firmware uses. The OS draws into its logical 4-bit framebuffer; present()
// copies the requested region into epdiy's native 960x540 front buffer with the rotation applied and
// lets the highlevel API's diff drive only the pixels that changed.
//
// Rotation mapping (hal -> epdiy):
//   R0   -> EPD_ROT_LANDSCAPE           960x540, native
//   R90  -> EPD_ROT_INVERTED_PORTRAIT   540x960, the phone's "up" (what the factory UI uses)
//   R180 -> EPD_ROT_INVERTED_LANDSCAPE  960x540
//   R270 -> EPD_ROT_PORTRAIT            540x960, upside down relative to R90
//
// Pixel formats: the hal framebuffer and epdiy's are both 4 bpp, low nibble = even x, 0 = black,
// 15 = white, so nibbles copy across unchanged (the 0x00..0xFF colour values are only for epdiy's
// drawing helpers, which we do not use).
#include <Arduino.h>
#include <LittleFS.h>
#include <string.h>

#include "board_t5pro.h"
#include "pins.h"

extern "C" {
#include <driver/i2c.h>

#include "board/tps65185.h"
#include "epd_highlevel.h"
#include "epdiy.h"
}

namespace quire {
namespace t5pro {
namespace {

constexpr int NW = T5PRO_PANEL_W;
constexpr int NH = T5PRO_PANEL_H;
constexpr size_t NSTRIDE = NW / 2;
constexpr size_t NBYTES = NSTRIDE * NH;
const char *const TAG = "display";
const char *const GLASS_DIR = "/.sys";
const char *const GLASS_PATH = "/.sys/glass.rle";
constexpr uint32_t TEMP_PERIOD_MS = 60000;

hal::Rect clip_rect(hal::Rect r, int w, int h) {
  int x0 = r.x < 0 ? 0 : r.x;
  int y0 = r.y < 0 ? 0 : r.y;
  int x1 = r.x + r.w > w ? w : r.x + r.w;
  int y1 = r.y + r.h > h ? h : r.y + r.h;
  hal::Rect o;
  o.x = (int16_t)x0;
  o.y = (int16_t)y0;
  o.w = (int16_t)(x1 > x0 ? x1 - x0 : 0);
  o.h = (int16_t)(y1 > y0 ? y1 - y0 : 0);
  return o;
}

enum EpdRotation to_epd(hal::Rotation r) {
  switch (r) {
    case hal::Rotation::R0: return EPD_ROT_LANDSCAPE;
    case hal::Rotation::R90: return EPD_ROT_INVERTED_PORTRAIT;
    case hal::Rotation::R180: return EPD_ROT_INVERTED_LANDSCAPE;
    default: return EPD_ROT_PORTRAIT;
  }
}

// Logical -> native pixel, the same transform as epdiy's _rotate() in epdiy.c.
template <int ROT>
inline void to_native(int lx, int ly, int &nx, int &ny) {
  if (ROT == EPD_ROT_LANDSCAPE) {
    nx = lx; ny = ly;
  } else if (ROT == EPD_ROT_PORTRAIT) {
    nx = NW - 1 - ly; ny = lx;
  } else if (ROT == EPD_ROT_INVERTED_LANDSCAPE) {
    nx = NW - 1 - lx; ny = NH - 1 - ly;
  } else {
    nx = ly; ny = NH - 1 - lx;
  }
}

template <int ROT>
EpdRect native_rect(hal::Rect r) {
  int ax, ay, bx, by;
  to_native<ROT>(r.x, r.y, ax, ay);
  to_native<ROT>(r.x + r.w - 1, r.y + r.h - 1, bx, by);
  EpdRect o;
  o.x = ax < bx ? ax : bx;
  o.y = ay < by ? ay : by;
  o.width = (ax < bx ? bx - ax : ax - bx) + 1;
  o.height = (ay < by ? by - ay : ay - by) + 1;
  return o;
}

template <int ROT>
void copy_region(const hal::Framebuffer &fb, hal::Rect r, uint8_t *dst) {
  const size_t ss = fb.stride();
  if (ROT == EPD_ROT_LANDSCAPE && !(r.x & 1) && !(r.w & 1)) {
    for (int y = r.y; y < r.y + r.h; y++)
      memcpy(dst + (size_t)y * NSTRIDE + r.x / 2, fb.data + (size_t)y * ss + r.x / 2, (size_t)r.w / 2);
    return;
  }
  for (int y = r.y; y < r.y + r.h; y++) {
    const uint8_t *row = fb.data + (size_t)y * ss;
    for (int x = r.x; x < r.x + r.w; x++) {
      uint8_t v = (x & 1) ? (uint8_t)(row[x >> 1] >> 4) : (uint8_t)(row[x >> 1] & 0x0F);
      int nx, ny;
      to_native<ROT>(x, y, nx, ny);
      uint8_t *p = dst + (size_t)ny * NSTRIDE + (nx >> 1);
      *p = (nx & 1) ? (uint8_t)((*p & 0x0F) | (v << 4)) : (uint8_t)((*p & 0xF0) | v);
    }
  }
}

class T5Display : public hal::Display {
 public:
  T5Display() {
    caps_.native_w = NW;
    caps_.native_h = NH;
    caps_.bpp = 4;
    caps_.greys = 16;
    caps_.dpi = T5PRO_PANEL_DPI;
    caps_.partial_update = true;
    caps_.fast_update = true;
    caps_.full_ms = 1200;     // estimates until measured on glass, see spec/NOTES-t5pro.md
    caps_.partial_ms = 400;
    caps_.rotations = 0x0F;
  }

  const hal::DisplayCaps &caps() const override { return caps_; }

  bool begin(hal::Rotation rot) override {
    if (!up_) {
      // Wire is already up on the shared bus: epdiy's own i2c_driver_install() then fails harmlessly
      // and its PCA9535/TPS65185 transactions go through the driver Wire installed, which is what
      // the factory firmware relies on too.
      epd_init(&epd_board_v7, &ED047TC1, EPD_LUT_64K);
      hl_ = epd_hl_init(EPD_BUILTIN_WAVEFORM);
      up_ = true;
    }
    set_rotation(rot);
    bool restored = restore_glass();
    if (!restored) {
      memset(hl_.front_fb, 0xFF, NBYTES);
      memset(hl_.back_fb, 0xFF, NBYTES);
      uint32_t t0 = ::millis();
      epd_poweron();
      epd_clear();
      epd_poweroff();
      hal::log(hal::LOG_INFO, TAG, "panel cleared in %lu ms", (unsigned long)(::millis() - t0));
    }
    hal::log(hal::LOG_INFO, TAG, "epdiy up: native %dx%d, logical %ux%u, %s", NW, NH, width(), height(),
             restored ? "previous image restored" : "cleared");
    return true;
  }

  bool set_rotation(hal::Rotation rot) override {
    rot_ = rot;
    epd_set_rotation(to_epd(rot));
    return true;
  }
  hal::Rotation rotation() const override { return rot_; }
  uint16_t width() const override { return portrait() ? NH : NW; }
  uint16_t height() const override { return portrait() ? NW : NH; }

  void present(const hal::Framebuffer &fb, hal::Rect region, hal::UpdateMode mode) override {
    if (!up_ || !fb.data) return;
    int w = fb.w < width() ? fb.w : width();
    int h = fb.h < height() ? fb.h : height();
    if (fb.w != width() || fb.h != height())
      hal::log(hal::LOG_WARN, TAG, "framebuffer %ux%u does not match logical %ux%u", fb.w, fb.h, width(), height());
    hal::Rect r = clip_rect(region, w, h);
    if (r.empty()) return;

    uint32_t t0 = ::millis();
    copy(fb, r);
    EpdRect n = native_area(r);
    if (!lines_differ(n)) {
      hal::log(hal::LOG_DEBUG, TAG, "present: no change in %dx%d@%d,%d", r.w, r.h, r.x, r.y);
      return;
    }
    uint32_t t1 = ::millis();

    enum EpdDrawMode m;
    const char *mname;
    switch (mode) {
      case hal::UpdateMode::FULL: m = MODE_GC16; mname = "GC16"; break;
      case hal::UpdateMode::PARTIAL: m = MODE_GL16; mname = "GL16"; break;
      default: m = du_ok_ ? MODE_DU : MODE_GL16; mname = du_ok_ ? "DU" : "GL16"; break;
    }
    // epd_hl_update_area() takes the area in rotated (logical) coordinates and inverse-rotates it.
    EpdRect area = {r.x, r.y, r.w, r.h};
    epd_poweron();
    read_temperature();
    enum EpdDrawError e = epd_hl_update_area(&hl_, m, (int)temp_c_, area);
    if (e == EPD_DRAW_MODE_NOT_FOUND && m == MODE_DU) {
      du_ok_ = false;
      mname = "GL16";
      e = epd_hl_update_area(&hl_, MODE_GL16, (int)temp_c_, area);
    }
    if (e == EPD_DRAW_SUCCESS) sync_back(n);
    epd_poweroff();
    uint32_t t2 = ::millis();
    hal::log(e == EPD_DRAW_SUCCESS ? hal::LOG_DEBUG : hal::LOG_ERROR, TAG,
             "%s %dx%d@%d,%d: copy %lu ms, update %lu ms%s (err 0x%x)", mname, r.w, r.h, r.x, r.y,
             (unsigned long)(t1 - t0), (unsigned long)(t2 - t1), e == EPD_DRAW_SUCCESS ? "" : " FAILED", (unsigned)e);
  }

  void power_off() override {
    if (up_) epd_poweroff();
  }

  float temperature_c() override { return temp_c_; }

  // Persist the native front buffer (== the glass after the last update) as a byte RLE file so the
  // next boot can seed epdiy's buffers instead of flashing the panel white.
  void save_glass() {
    if (!up_ || !fs_mounted()) return;
    uint32_t t0 = ::millis();
    LittleFS.mkdir(GLASS_DIR);
    File f = LittleFS.open(GLASS_PATH, "w");
    if (!f) {
      hal::log(hal::LOG_WARN, TAG, "cannot write %s", GLASS_PATH);
      return;
    }
    const uint8_t *src = hl_.front_fb;
    static uint8_t out[2048];
    size_t o = 0, i = 0, total = 4;
    f.write((const uint8_t *)"QGL1", 4);
    while (i < NBYTES) {
      uint8_t v = src[i];
      size_t n = 1;
      while (i + n < NBYTES && src[i + n] == v && n < 255) n++;
      out[o++] = (uint8_t)n;
      out[o++] = v;
      i += n;
      if (o >= sizeof(out) - 2) {
        f.write(out, o);
        total += o;
        o = 0;
      }
    }
    if (o) {
      f.write(out, o);
      total += o;
    }
    f.close();
    hal::log(hal::LOG_INFO, TAG, "glass image saved: %u bytes in %lu ms", (unsigned)total, (unsigned long)(::millis() - t0));
  }

  void prepare_sleep() {
    if (!up_) return;
    save_glass();
    epd_poweroff();
    epd_deinit();   // shuts the TPS65185 down; also deletes the shared I2C driver
    up_ = false;
  }

 private:
  bool portrait() const { return rot_ == hal::Rotation::R90 || rot_ == hal::Rotation::R270; }

  EpdRect native_area(hal::Rect r) const {
    switch (to_epd(rot_)) {
      case EPD_ROT_LANDSCAPE: return native_rect<EPD_ROT_LANDSCAPE>(r);
      case EPD_ROT_PORTRAIT: return native_rect<EPD_ROT_PORTRAIT>(r);
      case EPD_ROT_INVERTED_LANDSCAPE: return native_rect<EPD_ROT_INVERTED_LANDSCAPE>(r);
      default: return native_rect<EPD_ROT_INVERTED_PORTRAIT>(r);
    }
  }

  void copy(const hal::Framebuffer &fb, hal::Rect r) {
    uint8_t *dst = hl_.front_fb;
    switch (to_epd(rot_)) {
      case EPD_ROT_LANDSCAPE: copy_region<EPD_ROT_LANDSCAPE>(fb, r, dst); break;
      case EPD_ROT_PORTRAIT: copy_region<EPD_ROT_PORTRAIT>(fb, r, dst); break;
      case EPD_ROT_INVERTED_LANDSCAPE: copy_region<EPD_ROT_INVERTED_LANDSCAPE>(fb, r, dst); break;
      default: copy_region<EPD_ROT_INVERTED_PORTRAIT>(fb, r, dst); break;
    }
  }

  // epdiy diffs whole native lines, so compare whole lines: skips the panel power cycle when the
  // region did not change.
  bool lines_differ(EpdRect n) const {
    for (int l = n.y; l < n.y + n.height; l++)
      if (memcmp(hl_.front_fb + (size_t)l * NSTRIDE, hl_.back_fb + (size_t)l * NSTRIDE, NSTRIDE) != 0) return true;
    return false;
  }

  // After a successful update the glass equals the front buffer on every line the diff covered.
  // epdiy's own back-buffer sync misses the last pixel column of each line, so redo it here.
  void sync_back(EpdRect n) {
    for (int l = n.y; l < n.y + n.height; l++)
      memcpy(hl_.back_fb + (size_t)l * NSTRIDE, hl_.front_fb + (size_t)l * NSTRIDE, NSTRIDE);
  }

  // epd_board_v7 reports a constant 20 C; the TPS65185 has a thermistor input we can read while the
  // panel is powered. Sanity-checked because the thermistor may not be populated.
  void read_temperature() {
    uint32_t now = ::millis();
    if (t_temp_ && now - t_temp_ < TEMP_PERIOD_MS) return;
    t_temp_ = now ? now : 1;
    int8_t t = tps_read_thermistor(I2C_NUM_0);
    if (t >= 5 && t <= 45) temp_c_ = (float)t;
    else hal::log(hal::LOG_DEBUG, TAG, "thermistor read %d C ignored", (int)t);
  }

  bool restore_glass() {
    if (!fs_mounted() || !LittleFS.exists(GLASS_PATH)) return false;
    bool ok = false;
    File f = LittleFS.open(GLASS_PATH, "r");
    if (f) {
      uint8_t hdr[4];
      if (f.read(hdr, 4) == 4 && memcmp(hdr, "QGL1", 4) == 0) {
        static uint8_t in[2048];
        uint8_t *front = hl_.front_fb;
        size_t i = 0;
        ok = true;
        while (i < NBYTES) {
          int got = f.read(in, sizeof(in));
          if (got <= 0) { ok = false; break; }
          for (int k = 0; k + 1 < got && i < NBYTES; k += 2) {
            size_t n = in[k];
            if (i + n > NBYTES) n = NBYTES - i;
            memset(front + i, in[k + 1], n);
            i += n;
          }
        }
        if (i != NBYTES) ok = false;
        if (ok) memcpy(hl_.back_fb, front, NBYTES);
      }
      f.close();
    }
    LittleFS.remove(GLASS_PATH);   // one-shot: a crash mid-session must not resume a stale image
    if (!ok) hal::log(hal::LOG_WARN, TAG, "glass image unusable, clearing panel");
    return ok;
  }

  hal::DisplayCaps caps_;
  hal::Rotation rot_ = hal::Rotation::R90;
  EpdiyHighlevelState hl_{};
  bool up_ = false;
  bool du_ok_ = true;
  float temp_c_ = 20.0f;
  uint32_t t_temp_ = 0;
};

T5Display &instance() {
  static T5Display d;
  return d;
}

}  // namespace

hal::Display *make_display() { return &instance(); }
void display_save_glass() { instance().save_glass(); }
void display_prepare_sleep() { instance().prepare_sleep(); }

}  // namespace t5pro
}  // namespace quire
