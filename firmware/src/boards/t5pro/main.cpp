// QuireOS on the LilyGo T5 E-Paper S3 Pro: Arduino entry points. Everything else is the OS core.
//   BOOT held for 3 s at power-on: forget Wi-Fi so the OS enters provisioning.
#include <Arduino.h>
#include <Wire.h>
#include <esp_sleep.h>

#include "board_t5pro.h"
#include "os/os.h"
#include "pins.h"

// The OS parses JSON recursively and renders deep widget trees; 8 kB is not enough.
SET_LOOP_TASK_STACK_SIZE(32 * 1024);

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);   // never block on logging when no host is attached
#endif
  delay(200);
  setCpuFrequencyMhz(240);

  // The shared bus must be up before the panel driver (see display.cpp).
  Wire.begin(T5PRO_I2C_SDA, T5PRO_I2C_SCL, T5PRO_I2C_HZ);

  quire::hal::Board &b = quire::hal::board();
  quire::hal::log(quire::hal::LOG_INFO, "main", "QuireOS %s on %s, hw id %s", b.os_version, b.name, quire::hal::device_hw_id());

  bool woke = esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_UNDEFINED;
  if (!woke && quire::t5pro::boot_button_held(3000)) {
    quire::hal::log(quire::hal::LOG_INFO, "main", "BOOT held: forgetting Wi-Fi");
    b.net->forget();
  }

  quire::os::setup();
}

void loop() {
  quire::hal::Board &b = quire::hal::board();
  b.net->poll();
  quire::os::loop();
  delay(2);
}
