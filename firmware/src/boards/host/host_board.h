// Host (macOS) board: a fake panel, input queue, storage on disk and libcurl. The emulator's HTTP
// server drives it through these hooks; the OS only ever sees hal.h.
#pragma once
#include <stdint.h>
#include <string>
#include "../../hal/hal.h"

namespace quire {
namespace host {

struct Preset {
  const char *name, *title;
  uint16_t native_w, native_h;
  uint8_t greys, bpp;
  uint16_t dpi;
  bool partial, touch;
  hal::Rotation default_rotation;
};
const Preset *find_preset(const char *name);
const Preset *current_preset();

// Creates the devices. `data_dir` holds kv.json and the file store. Call once before os::setup().
void init(const char *preset_name, const std::string &data_dir, const char *os_version);
void push_tap(int x, int y, bool hold);
void push_button(uint8_t id, hal::Gesture g);
uint32_t frame_version();
const hal::Framebuffer &panel();          // quantised copy of what is "on glass", logical orientation
bool asleep();
uint32_t sleep_deadline_ms();             // millis() at which a timer wake is due, 0 = none
void wake(hal::WakeCause cause);
const std::string &data_dir();
// Set by the emulator so hal::reboot() can restart the process.
void set_reboot_handler(void (*fn)());
void set_log_level(hal::LogLevel level);

}  // namespace host
}  // namespace quire
