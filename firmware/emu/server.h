#pragma once
#include "../src/hal/hal.h"

namespace emu {
struct ServerHooks {
  void (*restart)(const char *preset) = nullptr;
  void (*wake)(quire::hal::WakeCause cause) = nullptr;
};
bool start(int port, const ServerHooks &hooks);
void poll_once(int timeout_ms);
}  // namespace emu
