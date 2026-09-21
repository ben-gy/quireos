// LilyGo T5 E-Paper S3 Pro (H752-01) — pins and bus addresses, from LilyGo's docs/pinmap.md.
// Only files under src/boards/t5pro/ and src/probe/ include this.
#pragma once

// Shared I2C bus: GT911, PCF8563, BQ25896, BQ27220, TPS65185 and the PCA9535 all sit on it. epdiy's
// epd_board_v7 drives the expander and the TPS through the IDF driver on I2C port 0; Wire uses the
// same port, so Wire.begin() must run before epd_init() (see display.cpp).
#define T5PRO_I2C_SDA          39
#define T5PRO_I2C_SCL          40
#define T5PRO_I2C_HZ           100000

#define T5PRO_TOUCH_INT        3      // RTC-capable GPIO: deep-sleep wake on touch
#define T5PRO_TOUCH_RST        9
#define T5PRO_FRONTLIGHT       11     // PWM, <= 1 kHz
#define T5PRO_PCA_INT          38     // PCA9535 INT (epdiy uses it for the TPS65185 interrupt)
#define T5PRO_BOOT_BUTTON      0      // BOOT, active low, RTC-capable
#define T5PRO_RTC_INT          2      // PCF8563 INT, unused

#define T5PRO_ADDR_GT911       0x5D
#define T5PRO_ADDR_PCF8563     0x51
#define T5PRO_ADDR_BQ25896     0x6B
#define T5PRO_ADDR_BQ27220     0x55
#define T5PRO_ADDR_TPS65185    0x68
#define T5PRO_ADDR_PCA9535     0x20

// Function button S3 is on the PCA9535, IO1_2 (input port 1, bit 2). epdiy's v7 board definition
// leaves that bit configured as an input (it is the unused STV line of the reference design).
#define T5PRO_PCA_BTN_REG      0x01   // input port 1 register
#define T5PRO_PCA_BTN_MASK     0x04
#define T5PRO_PCA_BTN_ACTIVE_LOW 1    // flip after checking the raw value the probe prints

// Touch: the GT911 reports in the orientation LilyGo configured it for. input.cpp reads the
// controller's resolution to decide between portrait (540x960) and native landscape (960x540) raw
// coordinates; set these if the probe shows mirrored axes.
#define T5PRO_TOUCH_FLIP_X     0
#define T5PRO_TOUCH_FLIP_Y     0

// Panel (ED047TC1)
#define T5PRO_PANEL_W          960
#define T5PRO_PANEL_H          540
#define T5PRO_PANEL_DPI        235

#define T5PRO_LEDC_CHANNEL     6      // frontlight PWM channel (epdiy does not use LEDC on the S3)
