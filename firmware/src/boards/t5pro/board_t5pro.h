// Internal header of the t5pro board layer: shared-bus helpers and the hooks the devices need from
// one another. Only src/boards/t5pro/ and src/probe/ include this; the OS core sees hal.h alone.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "hal/hal.h"

#ifndef QUIREOS_VERSION
#define QUIREOS_VERSION "0.1.0"
#endif

namespace quire {
namespace t5pro {

// Register helpers over Arduino Wire on the shared bus. Return false on NACK / timeout.
bool i2c_read(uint8_t addr, uint8_t reg, uint8_t *buf, size_t n);
bool i2c_read16(uint8_t addr, uint8_t reg, uint16_t &v);   // little-endian word
bool i2c_write(uint8_t addr, uint8_t reg, uint8_t v);

// display.cpp
void display_save_glass();      // persist the panel image so the next boot resumes without a flash
void display_prepare_sleep();   // save, rails off, epdiy deinit (this also deletes the I2C driver)

// input.cpp
int  touch_wake_level();        // 1: GT911 INT rests low and rises on touch, 0: rests high and falls,
                                // -1: touch controller not initialised
bool boot_button_held(uint32_t ms);   // true when BOOT stays pressed for `ms`

// storage.cpp
bool fs_mounted();              // mounts LittleFS on first use

// web_server.cpp
void web_server_start();
void web_server_stop();
void web_server_poll();

// Device factories (each returns a process-wide singleton).
hal::Display *make_display();
hal::Input *make_input();
hal::Power *make_power();
hal::Clock *make_clock();
hal::Storage *make_storage();
hal::Net *make_net();

}  // namespace t5pro
}  // namespace quire
