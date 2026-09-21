#include "app.h"

namespace button {

static const int PIN = BUTTON_1;          // GPIO21, active LOW (only user button)
static const uint32_t DEBOUNCE_MS = 25;
static const uint32_t LONG_MS     = 600;
static const uint32_t DOUBLE_MS   = 320;

enum St { IDLE, DOWN1, WAIT2, DOWN2 };
static St st = IDLE;
static uint32_t tDown = 0, tUp = 0, tChange = 0;
static bool rawUp = true, stableUp = true, longFired = false;

void begin() { pinMode(PIN, INPUT_PULLUP); }

bool heldAtBoot(uint32_t ms) {
    pinMode(PIN, INPUT_PULLUP);
    uint32_t t0 = millis();
    while (millis() - t0 < ms)
        if (digitalRead(PIN) == HIGH) return false;
        else delay(20);
    return true;
}

Gesture poll() {
    uint32_t now = millis();
    bool up = digitalRead(PIN) == HIGH;
    if (up != rawUp) { rawUp = up; tChange = now; }
    if (now - tChange > DEBOUNCE_MS) stableUp = rawUp;
    bool down = !stableUp;

    switch (st) {
        case IDLE:
            if (down) { st = DOWN1; tDown = now; longFired = false; }
            break;
        case DOWN1:
            if (!down) {
                if (longFired) st = IDLE;
                else { st = WAIT2; tUp = now; }
            } else if (!longFired && now - tDown >= LONG_MS) {
                longFired = true;
                return G_LONG;
            }
            break;
        case WAIT2:
            if (down) { st = DOWN2; tDown = now; }
            else if (now - tUp >= DOUBLE_MS) { st = IDLE; return G_SHORT; }
            break;
        case DOWN2:
            if (!down) { st = IDLE; return G_DOUBLE; }
            if (now - tDown >= LONG_MS) { st = DOWN1; longFired = true; return G_LONG; }
            break;
    }
    return G_NONE;
}

}  // namespace button
