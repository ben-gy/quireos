#ifndef PROBE
// Hacker News reader for the LilyGo T5 E-Paper S3 Pro.
//   tap        — the whole UI
//   BOOT       — short: next page, long: previous page, double: back
//   hold BOOT at power-on for 3 s — Wi-Fi setup
#include "app.h"
#include <Wire.h>
#include <WiFi.h>
#include <esp_sleep.h>

// The JSON parser recurses once per nesting level and deep HN threads need
// ~128 levels; the default 8 KB loop stack is not enough.
SET_LOOP_TASK_STACK_SIZE(32 * 1024);

namespace touch { bool begin(); bool poll(int &x, int &y); }

namespace light {
static const uint8_t LEVELS[4] = {0, 50, 130, 255};   // off, low, mid, high
void set(int level) {
    static bool up = false;
    if (!up) { ledcSetup(0, 1000, 8); ledcAttachPin(PIN_BL_EN, 0); up = true; }
    if (level < 0) level = 0;
    if (level > 3) level = 3;
    ledcWrite(0, LEVELS[level]);
}
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\nHN reader starting");
    setCpuFrequencyMhz(240);

    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);          // before the panel driver: they share this bus
    if (!gfx::begin()) {
        Serial.println("FATAL: panel/framebuffer init failed");
        while (true) delay(1000);
    }
    touch::begin();
    store::begin();
    gfx::setDark(store::dark());
    light::set(store::frontlight());

    int cause = esp_sleep_get_wakeup_cause();
    bool woke = cause == ESP_SLEEP_WAKEUP_EXT0 || cause == ESP_SLEEP_WAKEUP_EXT1;
    bool wantPortal = !woke && button::heldAtBoot(3000);
    if (wantPortal || !net::haveCreds()) net::runPortal();

    net::connect(15000);
    net::syncTime();
    ui::begin();
}

void loop() {
    int x, y;
    if (touch::poll(x, y)) {
        if (millis() > 1500) ui::tap(x, y);        // the tap that woke us is not a command
    }
    ui::tick();
    delay(5);
}

#endif  // PROBE
