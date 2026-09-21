// hal::Power for the T5 E-Paper S3 Pro: BQ27220 fuel gauge and BQ25896 charger on the shared bus,
// frontlight PWM on GPIO11, deep sleep with touch / BOOT / timer wake.
#include <Arduino.h>
#include <WiFi.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>

#include "board_t5pro.h"
#include "pins.h"

namespace quire {
namespace t5pro {
namespace {

const char *const TAG = "power";
constexpr uint32_t CACHE_MS = 2000;

// BQ27220 standard commands
constexpr uint8_t BQ27220_VOLTAGE = 0x08;   // mV
constexpr uint8_t BQ27220_SOC = 0x2C;       // %
// BQ25896 status register
constexpr uint8_t BQ25896_REG0B = 0x0B;     // VBUS_STAT[7:5] CHRG_STAT[4:3] PG_STAT[2]

// Resting LiPo curve, used when the gauge is absent or unconfigured (reports 0).
int estimate_percent(int mv) {
  static const struct { int mv, pct; } T[] = {
      {4200, 100}, {4100, 90}, {4000, 78}, {3900, 60}, {3800, 42}, {3700, 22}, {3600, 8}, {3500, 3}, {3300, 0}};
  if (mv >= T[0].mv) return 100;
  for (size_t i = 1; i < sizeof(T) / sizeof(T[0]); i++) {
    if (mv >= T[i].mv) {
      int span = T[i - 1].mv - T[i].mv;
      return T[i].pct + (T[i - 1].pct - T[i].pct) * (mv - T[i].mv) / span;
    }
  }
  return 0;
}

class T5Power : public hal::Power {
 public:
  T5Power() {
    caps_.battery = true;
    caps_.charging = true;
    caps_.frontlight = true;
    caps_.deep_sleep = true;
  }

  const hal::PowerCaps &caps() const override { return caps_; }
  int battery_percent() override { refresh(); return pct_; }
  int voltage_mv() override { refresh(); return mv_; }
  bool charging() override { refresh(); return chg_; }

  void frontlight(uint8_t level) override {
    if (!fl_up_) {
      ledcSetup(T5PRO_LEDC_CHANNEL, 1000, 8);
      ledcAttachPin(T5PRO_FRONTLIGHT, T5PRO_LEDC_CHANNEL);
      fl_up_ = true;
    }
    ledcWrite(T5PRO_LEDC_CHANNEL, level);
  }

  void sleep(const hal::WakeSources &w) override {
    hal::log(hal::LOG_INFO, TAG, "deep sleep: touch=%d button=%d timer=%lu ms", (int)w.touch, (int)w.button,
             (unsigned long)w.timer_ms);
    frontlight(0);
    int level = touch_wake_level();   // read before the display deinit takes the I2C driver down
    WiFi.disconnect(true, false);
    WiFi.mode(WIFI_OFF);
    display_prepare_sleep();

    uint64_t low_mask = 0;
    if (w.touch) {
      if (level == 1) {
        // INT rests low and pulses high on a touch: only ext0 can wake on a high level here.
        esp_sleep_enable_ext0_wakeup((gpio_num_t)T5PRO_TOUCH_INT, 1);
      } else {
        low_mask |= 1ULL << T5PRO_TOUCH_INT;
      }
    }
    if (w.button) low_mask |= 1ULL << T5PRO_BOOT_BUTTON;   // S3 sits behind the expander: cannot wake
    if (low_mask) esp_sleep_enable_ext1_wakeup(low_mask, ESP_EXT1_WAKEUP_ANY_LOW);
    if (w.timer_ms) esp_sleep_enable_timer_wakeup((uint64_t)w.timer_ms * 1000ULL);
    Serial.flush();
    esp_deep_sleep_start();
  }

  hal::WakeCause wake_cause() override {
    switch (esp_sleep_get_wakeup_cause()) {
      case ESP_SLEEP_WAKEUP_EXT0: return hal::WakeCause::TOUCH;
      case ESP_SLEEP_WAKEUP_EXT1: {
        uint64_t m = esp_sleep_get_ext1_wakeup_status();
        if (m & (1ULL << T5PRO_TOUCH_INT)) return hal::WakeCause::TOUCH;
        if (m & (1ULL << T5PRO_BOOT_BUTTON)) return hal::WakeCause::BUTTON;
        return hal::WakeCause::OTHER;
      }
      case ESP_SLEEP_WAKEUP_TIMER: return hal::WakeCause::TIMER;
      case ESP_SLEEP_WAKEUP_UNDEFINED: return hal::WakeCause::POWER_ON;
      default: return hal::WakeCause::OTHER;
    }
  }

  size_t free_heap() override { return ESP.getFreeHeap(); }
  size_t free_psram() override { return ESP.getFreePsram(); }

 private:
  void refresh() {
    uint32_t now = ::millis();
    if (t_cache_ && now - t_cache_ < CACHE_MS) return;
    t_cache_ = now ? now : 1;

    uint16_t v = 0;
    mv_ = i2c_read16(T5PRO_ADDR_BQ27220, BQ27220_VOLTAGE, v) ? (int)v : 0;
    if (i2c_read16(T5PRO_ADDR_BQ27220, BQ27220_SOC, v) && v <= 100) pct_ = (int)v;
    else pct_ = -1;
    if (pct_ <= 0 && mv_ > 2500) pct_ = estimate_percent(mv_);

    uint8_t s = 0;
    if (i2c_read(T5PRO_ADDR_BQ25896, BQ25896_REG0B, &s, 1)) {
      uint8_t st = (s >> 3) & 0x03;   // 0 idle, 1 pre-charge, 2 fast charge, 3 done
      chg_ = st == 1 || st == 2;
    } else {
      chg_ = false;
    }
  }

  hal::PowerCaps caps_;
  uint32_t t_cache_ = 0;
  int pct_ = -1, mv_ = 0;
  bool chg_ = false, fl_up_ = false;
};

T5Power &instance() {
  static T5Power p;
  return p;
}

}  // namespace

hal::Power *make_power() { return &instance(); }

}  // namespace t5pro
}  // namespace quire
