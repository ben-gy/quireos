#pragma once
// LilyGo T5 E-Paper S3 Pro — from LilyGo's pin map (docs/pinmap.md upstream).
#define PIN_I2C_SDA    39
#define PIN_I2C_SCL    40
#define PIN_TOUCH_INT  3      // RTC-capable: wakes the device on a tap
#define PIN_TOUCH_RST  9
#define PIN_BL_EN      11     // frontlight, PWM <= 1 kHz
#define PIN_PCA_INT    38
#define BUTTON_1       0      // BOOT; the case button sits on the I/O expander
