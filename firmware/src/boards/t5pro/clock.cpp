// hal::Clock for the T5 E-Paper S3 Pro: PCF8563 RTC via SensorLib. The RTC seeds the system clock
// once per boot; now() then answers from the system clock (TLS and the OS both read it constantly)
// and set() writes both.
#include <Arduino.h>
#include <SensorPCF8563.hpp>
#include <Wire.h>
#include <sys/time.h>
#include <time.h>

#include "board_t5pro.h"
#include "pins.h"

namespace quire {
namespace t5pro {
namespace {

const char *const TAG = "clock";
constexpr int64_t MIN_EPOCH = 1735689600;   // 2025-01-01: anything earlier is an unset clock

int64_t days_from_civil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

int64_t to_epoch(const RTC_DateTime &t) {
  return days_from_civil(t.year, t.month, t.day) * 86400 + (int64_t)t.hour * 3600 + (int64_t)t.minute * 60 + t.second;
}

bool sane(const RTC_DateTime &t) {
  return t.available && t.year >= 2025 && t.year <= 2099 && t.month >= 1 && t.month <= 12 && t.day >= 1 && t.day <= 31 &&
         t.hour <= 23 && t.minute <= 59 && t.second <= 59;
}

class T5Clock : public hal::Clock {
 public:
  int64_t now() override {
    time_t sys = time(nullptr);
    if (sys > MIN_EPOCH) return (int64_t)sys;
    if (!begin_once()) return 0;
    RTC_DateTime dt = rtc_.getDateTime();
    if (!sane(dt)) return 0;
    int64_t e = to_epoch(dt);
    struct timeval tv = {(time_t)e, 0};
    settimeofday(&tv, nullptr);
    hal::log(hal::LOG_INFO, TAG, "system clock seeded from RTC: %lld", (long long)e);
    return e;
  }

  void set(int64_t epoch) override {
    struct timeval tv = {(time_t)epoch, 0};
    settimeofday(&tv, nullptr);
    if (!begin_once()) return;
    time_t t = (time_t)epoch;
    struct tm g;
    gmtime_r(&t, &g);
    rtc_.setDateTime((uint16_t)(g.tm_year + 1900), (uint8_t)(g.tm_mon + 1), (uint8_t)g.tm_mday, (uint8_t)g.tm_hour,
                     (uint8_t)g.tm_min, (uint8_t)g.tm_sec);
    hal::log(hal::LOG_INFO, TAG, "RTC set to %04d-%02d-%02d %02d:%02d:%02d UTC", g.tm_year + 1900, g.tm_mon + 1, g.tm_mday,
             g.tm_hour, g.tm_min, g.tm_sec);
  }

  bool valid() override { return now() > MIN_EPOCH; }

 private:
  bool begin_once() {
    if (tried_) return ok_;
    tried_ = true;
    ok_ = rtc_.init(Wire, T5PRO_I2C_SDA, T5PRO_I2C_SCL);
    if (!ok_) hal::log(hal::LOG_ERROR, TAG, "PCF8563 not found");
    return ok_;
  }

  SensorPCF8563 rtc_;
  bool tried_ = false, ok_ = false;
};

T5Clock &instance() {
  static T5Clock c;
  return c;
}

}  // namespace

hal::Clock *make_clock() { return &instance(); }

}  // namespace t5pro
}  // namespace quire
