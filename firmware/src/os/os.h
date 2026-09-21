// QuireOS core entry points. A board's main.cpp (or the host emulator) calls these.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifndef QUIREOS_VERSION
#define QUIREOS_VERSION "0.1.0"
#endif

namespace quire {
namespace os {

// Called once after hal::board() devices exist. Brings up storage, display, input, network, and
// shows the first screen. Never blocks for longer than a display refresh except during Wi-Fi
// provisioning, which is explicit.
void setup();

// Called continuously. Runs one iteration of the OS loop: input, timers, network responses,
// at most one display update. Returns quickly (< 5 ms) unless a refresh happens.
void loop();

// Requests from the outside (board buttons wired to OS actions, or the emulator).
void request_home();
void request_full_redraw();

}  // namespace os
}  // namespace quire
