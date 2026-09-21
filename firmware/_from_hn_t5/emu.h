#pragma once
#include "app.h"
// Cross-module glue for the host emulator.
void emu_pushGesture(Gesture g);
void emu_pushTap(int x, int y);
bool emu_popTap(int &x, int &y);
extern volatile int emu_frameVersion;       // bumped on every present()
extern bool         emu_asleep;
void gfx_host_setSize(int w, int h);
