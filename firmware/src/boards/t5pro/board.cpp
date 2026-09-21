// The t5pro board singleton and the shared-bus register helpers.
#include <Arduino.h>
#include <Wire.h>

#include "board_t5pro.h"
#include "pins.h"

namespace quire {
namespace t5pro {

bool i2c_read(uint8_t addr, uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = (uint8_t)Wire.read();
  return true;
}

bool i2c_read16(uint8_t addr, uint8_t reg, uint16_t &v) {
  uint8_t b[2];
  if (!i2c_read(addr, reg, b, 2)) return false;
  v = (uint16_t)(b[0] | (b[1] << 8));
  return true;
}

bool i2c_write(uint8_t addr, uint8_t reg, uint8_t v) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

}  // namespace t5pro

namespace hal {

Board &board() {
  static Board b = [] {
    Board x;
    x.name = "t5pro";
    x.profile = "t5pro";
    x.os_version = QUIREOS_VERSION;
    x.default_rotation = Rotation::R90;   // portrait, the phone's "up"
    x.display = t5pro::make_display();
    x.input = t5pro::make_input();
    x.power = t5pro::make_power();
    x.clock = t5pro::make_clock();
    x.storage = t5pro::make_storage();
    x.net = t5pro::make_net();
    return x;
  }();
  return b;
}

}  // namespace hal
}  // namespace quire
