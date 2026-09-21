// GT911 touch on the shared I2C bus, as the factory firmware drives it. A tap
// is reported once, on release, if the finger was down briefly.
#include "app.h"
#include <Wire.h>
#include <TouchDrvGT911.hpp>

namespace touch {

static TouchDrvGT911 gt;
static bool ok = false, down = false;
static int lastX = 0, lastY = 0;
static uint32_t tDown = 0;

bool begin() {
    gt.setPins(PIN_TOUCH_RST, PIN_TOUCH_INT);
    ok = gt.begin(Wire, GT911_SLAVE_ADDRESS_L, PIN_I2C_SDA, PIN_I2C_SCL);
    if (ok) log_i("GT911 up, %d points", gt.getSupportTouchPoint());
    else    log_e("GT911 not found");
    return ok;
}

// The controller is configured for the panel's portrait orientation, the same
// one the factory UI uses, so raw coordinates map onto the framebuffer directly.
bool poll(int &x, int &y) {
    if (!ok) return false;
    if (gt.isPressed()) {
        int16_t px[1], py[1];
        if (gt.getPoint(px, py, 1) > 0) {
            lastX = px[0]; lastY = py[0];
            if (!down) { down = true; tDown = millis(); }
        }
        return false;
    }
    if (down) {
        down = false;
        if (millis() - tDown < 700) { x = lastX; y = lastY; return true; }
    }
    return false;
}

}  // namespace touch
