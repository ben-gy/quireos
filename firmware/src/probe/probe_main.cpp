// QuireOS t5pro board probe: exercises the board layer on hardware without the OS core.
//   boot      draws a 16-step grey ramp and a grid (FULL), prints the bus scan, caps and status
//   tap       inverts a 120x120 square around the tap with PARTIAL (GL16)
//   hold      inverts a 200x200 square with FAST (DU)
//   S3 short  toggles the frontlight        S3 long   redraws the pattern (FULL)
//   S3 double / BOOT double  deep sleep with touch + BOOT + 60 s timer wake
//   BOOT short  prints status               BOOT long  clears with a FULL white
// Build: pio run -e probe -t upload && pio device monitor
#include <Arduino.h>
#include <Wire.h>
#include <string.h>
#include <time.h>

#include "boards/t5pro/board_t5pro.h"
#include "boards/t5pro/pins.h"

namespace hal = quire::hal;

SET_LOOP_TASK_STACK_SIZE(16 * 1024);

static hal::Framebuffer fb;
static uint32_t t_status = 0;
static bool frontlight_on = false;

static hal::Rect R(int x, int y, int w, int h) {
  hal::Rect r;
  r.x = (int16_t)x;
  r.y = (int16_t)y;
  r.w = (int16_t)w;
  r.h = (int16_t)h;
  return r;
}

static hal::Rect clip(hal::Rect r) {
  int x0 = r.x < 0 ? 0 : r.x, y0 = r.y < 0 ? 0 : r.y;
  int x1 = r.x + r.w > fb.w ? fb.w : r.x + r.w, y1 = r.y + r.h > fb.h ? fb.h : r.y + r.h;
  return R(x0, y0, x1 > x0 ? x1 - x0 : 0, y1 > y0 ? y1 - y0 : 0);
}

static void fill_rect(hal::Rect r, uint8_t v) {
  r = clip(r);
  for (int y = r.y; y < r.y + r.h; y++)
    for (int x = r.x; x < r.x + r.w; x++) fb.set(x, y, v);
}

static void invert_rect(hal::Rect r) {
  r = clip(r);
  for (int y = r.y; y < r.y + r.h; y++)
    for (int x = r.x; x < r.x + r.w; x++) fb.set(x, y, (uint8_t)(15 - fb.get(x, y)));
}

static void draw_pattern() {
  const int W = fb.w, H = fb.h;
  fill_rect(R(0, 0, W, H), 15);
  // 16-step ramp, black on the left, across the top third
  int band = H / 3, step = W / 16;
  for (int i = 0; i < 16; i++) fill_rect(R(i * step, 0, step, band), (uint8_t)i);
  // 60 px grid below it
  for (int y = band; y < H; y += 60) fill_rect(R(0, y, W, 1), 0);
  for (int x = 0; x < W; x += 60) fill_rect(R(x, band, 1, H - band), 0);
  // orientation markers: solid square top-left of the grid, hollow square bottom-right
  fill_rect(R(4, band + 4, 40, 40), 0);
  fill_rect(R(W - 44, H - 44, 40, 40), 0);
  fill_rect(R(W - 34, H - 34, 20, 20), 15);
}

static void present(hal::Rect r, hal::UpdateMode m, const char *what) {
  uint32_t t0 = millis();
  hal::board().display->present(fb, r, m);
  Serial.printf("[probe] %s %s %dx%d@%d,%d: %lu ms\n", what,
                m == hal::UpdateMode::FULL ? "FULL" : m == hal::UpdateMode::PARTIAL ? "PARTIAL" : "FAST", r.w, r.h, r.x, r.y,
                (unsigned long)(millis() - t0));
}

static void print_status() {
  hal::Board &b = hal::board();
  int64_t now = b.clock->now();
  char ts[32] = "unset";
  if (now > 0) {
    time_t t = (time_t)now;
    struct tm g;
    gmtime_r(&t, &g);
    strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S UTC", &g);
  }
  Serial.printf("[probe] battery %d%% %d mV %s | rtc %s (%s) | heap %u free, psram %u free | panel %.0f C | wifi %s\n",
                b.power->battery_percent(), b.power->voltage_mv(), b.power->charging() ? "charging" : "not charging", ts,
                b.clock->valid() ? "valid" : "invalid", (unsigned)b.power->free_heap(), (unsigned)b.power->free_psram(),
                b.display->temperature_c(), b.net->connected() ? b.net->ip() : "off");
}

static void scan_bus() {
  Serial.print("[probe] i2c devices:");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) Serial.printf(" 0x%02x", a);
  }
  Serial.println();
}

static const char *gesture_name(hal::Gesture g) {
  return g == hal::Gesture::SHORT ? "short" : g == hal::Gesture::LONG ? "long" : "double";
}

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);
#endif
  delay(300);
  Serial.println("\n[probe] QuireOS t5pro board probe");
  setCpuFrequencyMhz(240);

  Wire.begin(T5PRO_I2C_SDA, T5PRO_I2C_SCL, T5PRO_I2C_HZ);
  scan_bus();

  hal::Board &b = hal::board();
  Serial.printf("[probe] board %s, hw id %s, wake cause %d, os %s\n", b.name, hal::device_hw_id(), (int)b.power->wake_cause(),
                b.os_version);

  b.storage->begin();
  b.display->begin(b.default_rotation);
  b.input->begin();
  b.input->set_rotation(b.default_rotation);
  const hal::DisplayCaps &c = b.display->caps();
  Serial.printf("[probe] display native %ux%u, logical %ux%u, %u greys, %u dpi, partial %d fast %d\n", c.native_w, c.native_h,
                b.display->width(), b.display->height(), c.greys, c.dpi, (int)c.partial_update, (int)c.fast_update);

  fb.w = b.display->width();
  fb.h = b.display->height();
  fb.data = (uint8_t *)hal::alloc_big(fb.bytes());
  if (!fb.data) {
    Serial.println("[probe] FATAL: no framebuffer");
    while (true) delay(1000);
  }
  draw_pattern();
  present(R(0, 0, fb.w, fb.h), hal::UpdateMode::FULL, "pattern");
  b.power->frontlight(0);
  print_status();
  Serial.println("[probe] ready: tap = PARTIAL invert, hold = FAST invert, S3 short = frontlight, S3 long = redraw, double = sleep");
}

void loop() {
  hal::Board &b = hal::board();
  b.net->poll();

  hal::Event e;
  while (b.input->poll(e)) {
    switch (e.kind) {
      case hal::Event::TAP: {
        Serial.printf("[probe] TAP %d,%d\n", e.x, e.y);
        hal::Rect r = clip(R(e.x - 60, e.y - 60, 120, 120));
        invert_rect(r);
        present(r, hal::UpdateMode::PARTIAL, "tap");
        break;
      }
      case hal::Event::HOLD: {
        Serial.printf("[probe] HOLD %d,%d\n", e.x, e.y);
        hal::Rect r = clip(R(e.x - 100, e.y - 100, 200, 200));
        invert_rect(r);
        present(r, hal::UpdateMode::FAST, "hold");
        break;
      }
      case hal::Event::BUTTON: {
        Serial.printf("[probe] BUTTON %d (%s) %s\n", e.button, e.button == 1 ? "S3" : "BOOT", gesture_name(e.gesture));
        if (e.gesture == hal::Gesture::DOUBLE) {
          Serial.println("[probe] sleeping: touch, BOOT or 60 s timer wakes");
          hal::WakeSources w;
          w.touch = true;
          w.button = true;
          w.timer_ms = 60000;
          b.power->sleep(w);
        } else if (e.button == 1 && e.gesture == hal::Gesture::SHORT) {
          frontlight_on = !frontlight_on;
          b.power->frontlight(frontlight_on ? 120 : 0);
        } else if (e.button == 1 && e.gesture == hal::Gesture::LONG) {
          draw_pattern();
          present(R(0, 0, fb.w, fb.h), hal::UpdateMode::FULL, "pattern");
        } else if (e.button == 2 && e.gesture == hal::Gesture::SHORT) {
          print_status();
        } else if (e.button == 2 && e.gesture == hal::Gesture::LONG) {
          fill_rect(R(0, 0, fb.w, fb.h), 15);
          present(R(0, 0, fb.w, fb.h), hal::UpdateMode::FULL, "clear");
        }
        break;
      }
      default: break;
    }
  }

  if (millis() - t_status > 10000) {
    t_status = millis();
    print_status();
  }
  delay(2);
}
