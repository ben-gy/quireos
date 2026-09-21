// Host input: gestures and taps arrive from the web page and are queued here.
#include "emu.h"
#include <deque>

static std::deque<Gesture> gestures;
static std::deque<std::pair<int, int>> taps;

void emu_pushGesture(Gesture g) { gestures.push_back(g); }
void emu_pushTap(int x, int y) { taps.push_back({x, y}); }
bool emu_popTap(int &x, int &y) {
    if (taps.empty()) return false;
    x = taps.front().first; y = taps.front().second; taps.pop_front();
    return true;
}

namespace button {
void begin() {}
bool heldAtBoot(uint32_t) { return false; }
Gesture poll() {
    if (gestures.empty()) return G_NONE;
    Gesture g = gestures.front();
    gestures.pop_front();
    return g;
}
}
