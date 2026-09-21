// hal::Input for the T5 E-Paper S3 Pro: GT911 touch on the shared bus (SensorLib brings it up, the
// point registers are polled directly so press and release are unambiguous), the S3 function button
// on the PCA9535 expander and BOOT on GPIO0, both with the hn-t5 gesture state machine.
#include <Arduino.h>
#include <TouchDrvGT911.hpp>
#include <Wire.h>

#include "board_t5pro.h"
#include "pins.h"

namespace quire {
namespace t5pro {
namespace {

const char *const TAG = "input";
const hal::ButtonInfo BUTTONS[2] = {{1, "S3"}, {2, "BOOT"}};

constexpr int NW = T5PRO_PANEL_W;
constexpr int NH = T5PRO_PANEL_H;
constexpr uint32_t TAP_MAX_MS = 700;         // released before this: TAP
constexpr uint32_t HOLD_MIN_MS = 800;        // still down at this: HOLD (once)
constexpr uint32_t RELEASE_TIMEOUT_MS = 250; // no report for this long: treat as released
constexpr uint32_t TOUCH_POLL_MS = 10;
constexpr uint32_t BUTTON_POLL_MS = 20;      // ~50 Hz
constexpr uint16_t GT_STATUS = 0x814E;
constexpr uint16_t GT_POINT1 = 0x814F;

// Debounced short / long / double gesture detector (from hn-t5 button.cpp).
struct ButtonSM {
  static constexpr uint32_t DEBOUNCE_MS = 25, LONG_MS = 600, DOUBLE_MS = 320;
  enum St { IDLE, DOWN1, WAIT2, DOWN2 } st = IDLE;
  uint32_t t_down = 0, t_up = 0, t_change = 0;
  bool raw_up = true, stable_up = true, long_fired = false;

  bool feed(bool up, uint32_t now, hal::Gesture &g) {
    if (up != raw_up) {
      raw_up = up;
      t_change = now;
    }
    if (now - t_change > DEBOUNCE_MS) stable_up = raw_up;
    bool down = !stable_up;
    switch (st) {
      case IDLE:
        if (down) { st = DOWN1; t_down = now; long_fired = false; }
        break;
      case DOWN1:
        if (!down) {
          if (long_fired) st = IDLE;
          else { st = WAIT2; t_up = now; }
        } else if (!long_fired && now - t_down >= LONG_MS) {
          long_fired = true;
          g = hal::Gesture::LONG;
          return true;
        }
        break;
      case WAIT2:
        if (down) { st = DOWN2; t_down = now; }
        else if (now - t_up >= DOUBLE_MS) { st = IDLE; g = hal::Gesture::SHORT; return true; }
        break;
      case DOWN2:
        if (!down) { st = IDLE; g = hal::Gesture::DOUBLE; return true; }
        if (now - t_down >= LONG_MS) { st = DOWN1; long_fired = true; g = hal::Gesture::LONG; return true; }
        break;
    }
    return false;
  }
};

// GT911 register access: 16-bit big-endian register address, repeated start for reads.
bool gt_read(uint16_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(T5PRO_ADDR_GT911);
  Wire.write((uint8_t)(reg >> 8));
  Wire.write((uint8_t)reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)T5PRO_ADDR_GT911, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = (uint8_t)Wire.read();
  return true;
}

bool gt_write(uint16_t reg, uint8_t v) {
  Wire.beginTransmission(T5PRO_ADDR_GT911);
  Wire.write((uint8_t)(reg >> 8));
  Wire.write((uint8_t)reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

class T5Input : public hal::Input {
 public:
  T5Input() {
    caps_.touch = true;
    caps_.touch_points = 5;
    caps_.button_count = 2;
    caps_.buttons = BUTTONS;
  }

  const hal::InputCaps &caps() const override { return caps_; }

  bool begin() override {
    pinMode(T5PRO_BOOT_BUTTON, INPUT_PULLUP);

    gt_.setPins(T5PRO_TOUCH_RST, T5PRO_TOUCH_INT);
    touch_ok_ = gt_.begin(Wire, GT911_SLAVE_ADDRESS_L, T5PRO_I2C_SDA, T5PRO_I2C_SCL);
    if (touch_ok_) {
      irq_mode_ = gt_.getInterruptMode();
      int16_t xr = 0, yr = 0;
      gt_.getResolution(&xr, &yr);
      raw_portrait_ = !(xr > yr);
      hal::log(hal::LOG_INFO, TAG, "GT911 up: %d points, resolution %dx%d (%s raw), INT mode %d", gt_.getSupportTouchPoint(), xr, yr,
               raw_portrait_ ? "portrait" : "landscape", irq_mode_);
    } else {
      hal::log(hal::LOG_ERROR, TAG, "GT911 not found");
    }

    uint8_t v = 0;
    s3_ok_ = i2c_read(T5PRO_ADDR_PCA9535, T5PRO_PCA_BTN_REG, &v, 1);
    if (s3_ok_) hal::log(hal::LOG_INFO, TAG, "PCA9535 input port 1 = 0x%02x (S3 mask 0x%02x)", v, T5PRO_PCA_BTN_MASK);
    else hal::log(hal::LOG_ERROR, TAG, "PCA9535 not readable, S3 button disabled");
    return touch_ok_;
  }

  void set_rotation(hal::Rotation rot) override { rot_ = rot; }

  bool poll(hal::Event &out) override {
    uint32_t now = ::millis();
    poll_touch(now);
    poll_buttons(now);
    if (!qn_) return false;
    out = q_[qh_];
    qh_ = (uint8_t)((qh_ + 1) % QN);
    qn_--;
    return true;
  }

  int wake_level() const {
    if (irq_mode_ < 0) return -1;
    return (irq_mode_ == 0 || irq_mode_ == 3) ? 1 : 0;   // 0 rising / 3 high-level: rests low
  }

 private:
  static constexpr uint8_t QN = 4;

  void push(const hal::Event &e) {
    if (qn_ >= QN) return;
    q_[(qh_ + qn_) % QN] = e;
    qn_++;
  }

  void poll_touch(uint32_t now) {
    if (!touch_ok_ || now - t_touch_ < TOUCH_POLL_MS) return;
    t_touch_ = now;
    bool released = false;
    uint8_t st = 0;
    if (gt_read(GT_STATUS, &st, 1) && (st & 0x80)) {
      int n = st & 0x0F;
      if (n > 0) {
        uint8_t p[8];
        if (gt_read(GT_POINT1, p, sizeof(p))) {
          int rx = p[1] | (p[2] << 8), ry = p[3] | (p[4] << 8);
          map_touch(rx, ry, x_, y_);
          if (!down_) {
            down_ = true;
            hold_sent_ = false;
            t_down_ = now;
          }
          t_last_ = now;
        }
      } else if (down_) {
        released = true;
      }
      gt_write(GT_STATUS, 0);
    }
    if (down_ && !released && now - t_last_ > RELEASE_TIMEOUT_MS) released = true;
    if (down_ && !released && !hold_sent_ && now - t_down_ >= HOLD_MIN_MS) {
      hold_sent_ = true;
      hal::Event e;
      e.kind = hal::Event::HOLD;
      e.x = x_;
      e.y = y_;
      push(e);
    }
    if (released) {
      down_ = false;
      if (!hold_sent_ && now - t_down_ < TAP_MAX_MS) {
        hal::Event e;
        e.kind = hal::Event::TAP;
        e.x = x_;
        e.y = y_;
        push(e);
      }
    }
  }

  // Raw controller coordinates -> native panel -> logical screen for the current rotation.
  void map_touch(int rx, int ry, int16_t &lx, int16_t &ly) const {
    int rw = raw_portrait_ ? NH : NW, rh = raw_portrait_ ? NW : NH;
    if (T5PRO_TOUCH_FLIP_X) rx = rw - 1 - rx;
    if (T5PRO_TOUCH_FLIP_Y) ry = rh - 1 - ry;
    int nx, ny;
    if (raw_portrait_) { nx = ry; ny = NH - 1 - rx; }   // raw is the R90 (inverted portrait) space
    else { nx = rx; ny = ry; }
    if (nx < 0) nx = 0;
    if (nx >= NW) nx = NW - 1;
    if (ny < 0) ny = 0;
    if (ny >= NH) ny = NH - 1;
    int x, y;
    switch (rot_) {
      case hal::Rotation::R0: x = nx; y = ny; break;
      case hal::Rotation::R90: x = NH - 1 - ny; y = nx; break;
      case hal::Rotation::R180: x = NW - 1 - nx; y = NH - 1 - ny; break;
      default: x = ny; y = NW - 1 - nx; break;
    }
    lx = (int16_t)x;
    ly = (int16_t)y;
  }

  void poll_buttons(uint32_t now) {
    if (now - t_btn_ < BUTTON_POLL_MS) return;
    t_btn_ = now;
    hal::Gesture g;
    if (s3_ok_) {
      uint8_t v = 0;
      if (i2c_read(T5PRO_ADDR_PCA9535, T5PRO_PCA_BTN_REG, &v, 1)) {
        bool pressed = T5PRO_PCA_BTN_ACTIVE_LOW ? !(v & T5PRO_PCA_BTN_MASK) : !!(v & T5PRO_PCA_BTN_MASK);
        if (s3_.feed(!pressed, now, g)) push_button(1, g);
      }
    }
    if (boot_.feed(digitalRead(T5PRO_BOOT_BUTTON) == HIGH, now, g)) push_button(2, g);
  }

  void push_button(uint8_t id, hal::Gesture g) {
    hal::Event e;
    e.kind = hal::Event::BUTTON;
    e.button = id;
    e.gesture = g;
    push(e);
  }

  hal::InputCaps caps_;
  TouchDrvGT911 gt_;
  bool touch_ok_ = false;
  int irq_mode_ = -1;
  bool raw_portrait_ = true;
  hal::Rotation rot_ = hal::Rotation::R90;
  bool down_ = false, hold_sent_ = false;
  uint32_t t_down_ = 0, t_last_ = 0, t_touch_ = 0, t_btn_ = 0;
  int16_t x_ = 0, y_ = 0;
  ButtonSM s3_, boot_;
  bool s3_ok_ = false;
  hal::Event q_[QN];
  uint8_t qh_ = 0, qn_ = 0;
};

T5Input &instance() {
  static T5Input i;
  return i;
}

}  // namespace

hal::Input *make_input() { return &instance(); }
int touch_wake_level() { return instance().wake_level(); }

bool boot_button_held(uint32_t ms) {
  pinMode(T5PRO_BOOT_BUTTON, INPUT_PULLUP);
  uint32_t t0 = ::millis();
  while (::millis() - t0 < ms) {
    if (digitalRead(T5PRO_BOOT_BUTTON) == HIGH) return false;
    ::delay(20);
  }
  return true;
}

}  // namespace t5pro
}  // namespace quire
