# t5pro board layer — notes

Working notes for `firmware/src/boards/t5pro/` (LilyGo T5 E-Paper S3 Pro, pinmap branch H752-01).
Written while porting without hardware attached; every number marked *estimate* must be replaced by
a measurement from the probe (`pio run -e probe -t upload`, then `pio device monitor`).

## Files

| File | What |
|---|---|
| `pins.h` | GPIOs, I2C addresses, expander bit of the S3 button, panel size, tunables (`T5PRO_PCA_BTN_ACTIVE_LOW`, `T5PRO_TOUCH_FLIP_X/Y`). |
| `board_t5pro.h` / `board.cpp` | `hal::board()` singleton, Wire register helpers, cross-device hooks. |
| `display.cpp` | `hal::Display` over epdiy `epd_board_v7` + `ED047TC1`, highlevel diff updates, glass-image save/restore. |
| `input.cpp` | GT911 touch (TAP/HOLD), S3 on the PCA9535, BOOT on GPIO0, gesture state machine. |
| `power.cpp` | BQ27220 gauge, BQ25896 charger status, frontlight PWM, deep sleep + wake cause. |
| `clock.cpp` | PCF8563 via SensorLib; seeds the system clock; `set()` writes both. |
| `storage.cpp` | NVS (`Preferences` namespace `quireos`) + LittleFS on the `spiffs` partition. |
| `net.cpp` | Wi-Fi STA, captive portal, HTTPS with the embedded CA bundle, SNTP -> RTC, ArduinoOTA + mDNS. |
| `web_server.cpp` | `WebServer` on :80 forwarding `/os*` to `quire::os::web::handle()`. |
| `sys.cpp` | threads, mutexes, timing, PSRAM alloc, `log`, `reboot`, `device_hw_id`. |
| `main.cpp` | Arduino `setup()`/`loop()` for the full firmware. |
| `certs/` | `gen_crt_bundle.py` and the generated `x509_crt_bundle.bin`. |
| `board.json` | Board profile (matches spec §10). |
| `../../probe/probe_main.cpp` | Hardware probe, env `probe`. |

## Decisions

### Rotation mapping
`hal::Rotation` -> epdiy: `R0` = `EPD_ROT_LANDSCAPE` (960x540, native), **`R90` =
`EPD_ROT_INVERTED_PORTRAIT`** (540x960, the phone's "up", the orientation LilyGo's factory UI and
hn-t5 use), `R180` = `EPD_ROT_INVERTED_LANDSCAPE`, `R270` = `EPD_ROT_PORTRAIT` (portrait upside
down). `board().default_rotation` is `R90`. The logical -> native pixel transform is a copy of
epdiy's `_rotate()` so `epd_hl_update_area()` (which inverse-rotates the area it is given) agrees
with the pixels we copied.

### Pixel format: no nibble expansion needed
The hal framebuffer (4 bpp, low nibble = even x, 0 black .. 15 white, stride `(w+1)/2`) has exactly
epdiy's framebuffer packing (`MODE_PACKING_2PPB`; `epd_get_pixel()` reads the low nibble for even x
too). `present()` therefore copies nibbles straight into epdiy's front buffer. The `v * 17`
expansion in the task brief is only needed for epdiy's *drawing helpers* (`epd_draw_pixel` and
friends take 0x00..0xFF and keep the upper nibble), which this layer does not use.

### Update modes
`FULL` -> `MODE_GC16`, `PARTIAL` -> `MODE_GL16`, `FAST` -> `MODE_DU`. The vendored builtin waveform
for ED047TC1 (`lib/epdiy/src/waveforms/epdiy_ED047TC1.h`) ships modes 1 (DU), 2 (GC16), 5 (GL16),
16 and 17 (epdiy white/black-to-GL16); **A2 is not available**. If DU is ever reported as
`EPD_DRAW_MODE_NOT_FOUND` the layer falls back to GL16 for FAST permanently. Temperature for the
waveform lookup: `epd_board_v7` returns a constant 20 C, so `present()` reads the TPS65185
thermistor (`tps_read_thermistor`) once a minute while the rails are up and keeps it only if it is
between 5 and 45 C (the thermistor may not be populated); `temperature_c()` reports that value.

### Timings (estimates, not measured)
`caps()` says `full_ms 1200`, `partial_ms 400`. From epdiy on a 4.7" panel with the LCD driver:
GC16 full ~ 1.0-1.4 s, GL16 partial of a tile ~ 300-500 ms, DU ~ 200-300 ms, plus the region copy
(per-pixel rotation of a full 540x960 frame from PSRAM, ~40-80 ms *estimate*) and the TPS rail
power-up (~50 ms). `present()` logs `copy`/`update` milliseconds at `LOG_DEBUG`, and epdiy's own
`diff/draw/buffer update` line appears at `CORE_DEBUG_LEVEL=3` (the probe env). Replace these
numbers in `display.cpp` (`caps_`) and `board.json` after a run.

### Diff behaviour and an upstream off-by-one
`epd_hl_update_area()` crops the diff by **lines only** (`epd_difference_image_base` walks whole
native lines in the y-range of the area), so copying just `region` into the front buffer is exact:
pixels outside the region equal the back buffer and never get driven. The back-buffer sync in
`highlevel.c` misses the last pixel column of every dirty line (`memcpy(..., (x_last - x) / 2)` after
`x_last` was decremented), which would re-drive the logical bottom row (portrait) or top row on
every update from a stale "from" value. `sync_back()` re-copies the whole native lines the update
covered, which fixes it without touching the LGPL library.

### Glass image persistence (no flash on wake/reboot)
PSRAM is lost in deep sleep but the panel keeps its image, and epdiy's diff needs to know it. Before
`Power::sleep()` and `hal::reboot()` (and on ArduinoOTA start) the layer RLE-compresses epdiy's
front buffer (typically a few kB for UI screens, 259 kB worst case) to LittleFS `/.sys/glass.rle`;
`Display::begin()` restores it into both buffers and deletes the file (one-shot, so a crash mid-session
falls back to a clear). Without a file, `begin()` runs `epd_clear()` (a flashing clear, ~1 s
*estimate*). Cost of the save: dominated by LittleFS write speed, expect < 100 ms for normal screens
*estimate*.

### Shared I2C bus
`Wire.begin(39, 40)` **must** run before `Display::begin()`. epdiy's `epd_board_v7` calls
`i2c_param_config` + `i2c_driver_install` on `I2C_NUM_0`; with Wire already up the install fails
harmlessly and epdiy's PCA9535/TPS65185 transfers go through the driver Wire installed (the IDF
legacy driver serialises transactions with its own mutex, so Wire and epdiy can share it). The
factory firmware relies on the same thing. Consequences:
- `epd_deinit()` calls `i2c_driver_delete()` and kills Wire, so it is only called from
  `display_prepare_sleep()` right before `esp_deep_sleep_start()`. `Display::power_off()` only
  drops the rails (`epd_poweroff()`); the image persists.
- All I2C from the board layer runs on the main task (input polling, gauge, RTC). The OS's net task
  never touches I2C; SNTP results are applied to the RTC from `Net::poll()` on the main loop.

### S3 button on the expander
LilyGo's pinmap puts the function button on PCA9535 **IO1_2** = input port 1, bit 2 = epdiy's
`PCA_PIN_PC12`, the v7 reference design's STV line, which `epd_board_v7.c` configures as an
**input** (and never drives). `input.cpp` reads register `0x01` at address `0x20` through Wire at
50 Hz; `T5PRO_PCA_BTN_ACTIVE_LOW=1` assumes a pull-up and a switch to ground. The probe logs the raw
port value at boot ("PCA9535 input port 1 = 0x..") — if bit 2 reads 0 while the button is *up*,
flip the macro. Reading the input port also clears the expander's INT line; epdiy's ISR on GPIO38
only sets a flag nobody consumes, so that is harmless. Because the button is behind the expander it
**cannot wake the ESP32-S3 from deep sleep** (GPIO38 is not an RTC GPIO); `WakeSources.button`
therefore arms **BOOT** (GPIO0). `board.json` records `wake: false` for S3.

### Touch
SensorLib's `TouchDrvGT911::begin()` does the reset sequence that selects address 0x5D and reads the
config; after that `input.cpp` polls the status register `0x814E` itself every 10 ms (SensorLib's
`getPoint()` cannot distinguish "no new data" from "released") and clears it after reading. Press =
first report with >= 1 point, release = a report with 0 points **or** no report for 250 ms (a finger
resting on the panel produces a report every GT911 cycle, ~10 ms; the timeout covers a release
report lost while a refresh blocked the loop). TAP is emitted on release when the press lasted
< 700 ms; HOLD once at >= 800 ms while still down; a release between 700 and 800 ms emits nothing.
Taps that start and end inside a blocking refresh are lost; the OS's "the tap that woke us is not a
command" rule belongs in the OS.

Coordinates: `getResolution()` is read at `begin()`; 540x960 (or unreadable) means the controller
reports in the factory portrait frame (= our `R90` space), 960x540 means native landscape. Raw ->
native -> logical for the current rotation, with `T5PRO_TOUCH_FLIP_X/Y` in `pins.h` for mirrored
axes. **Unverified on glass** (hn-t5's touch layer was never run either): check with the probe that
a tap inverts the square under the finger in portrait; if it lands mirrored, set the flip macros; if
it lands transposed, the resolution heuristic picked the wrong frame (`raw_portrait_`).

### Deep sleep and touch wake
The GT911 INT polarity comes from the controller's config (`getInterruptMode()`: 0 rising, 1
falling, 2 low-level, 3 high-level). Rising/high (rests low) -> `esp_sleep_enable_ext0_wakeup(3, 1)`;
falling/low (rests high) -> ext1 `ANY_LOW` on GPIO3, combined with BOOT (GPIO0) in the same ext1 mask
when `WakeSources.button` is set. `wake_cause()` reads `esp_sleep_get_ext1_wakeup_status()` to tell
TOUCH from BUTTON. Unverified assumptions: the GT911 stays powered in deep sleep (touch power is not
switched on this board according to the pinmap) and its INT pulse is long enough for the RTC
controller to catch (ext0/ext1 are level-triggered; a ~100 us pulse should be sampled). If wake on
touch does not work, try `gt_.setInterruptMode(LOW_LEVEL_QUERY)` in `begin()` so INT stays asserted
until read. Before sleeping: frontlight off, Wi-Fi off, glass saved, `epd_poweroff()`,
`epd_deinit()` (TPS65185 to standby).

### Battery and charger
BQ27220 standard commands `0x08` Voltage (mV) and `0x2C` StateOfCharge (%), read through Wire with a
repeated start, cached for 2 s. If the gauge is absent or reports 0 % with a plausible voltage (an
unconfigured gauge), the percentage falls back to a resting-LiPo voltage curve. BQ25896 `REG0B`
bits 4:3 (`CHRG_STAT`): 1 = pre-charge, 2 = fast charge -> `charging()`; we never write to the
charger (its I2C watchdog resets only host-written registers, defaults charge fine).

### Frontlight
LEDC channel 6, 1 kHz, 8-bit on GPIO11 (the pinmap limits the PWM to <= 1 kHz). `frontlight(0)` just
writes duty 0.

### Clock
`now()` returns the system clock once it is past 2025-01-01, otherwise reads the PCF8563 and seeds
`settimeofday()` from it (so TLS date checks work before SNTP). `set()` writes both. `valid()` is
`now() > 2025-01-01`. SNTP is started by `Net::connect()` (`configTime(0, 0, pool.ntp.org,
time.nist.gov)`); its callback only raises a flag, `Net::poll()` then calls `clock->set()` on the
main loop. Time zone handling stays in the OS (`runtime/tz.cpp`); the board keeps UTC everywhere.

### Storage
NVS keys are limited to 15 characters; longer keys are folded to `first7~fnv7hex` (transparent to
the OS; collisions are astronomically unlikely). `kv_get` returns false when the key is missing *or*
the caller's buffer is too small (logged). LittleFS mounts the `spiffs`-labelled partition at
`/littlefs` with format-on-fail; `file_write` creates parent directories; `file_list` reports
`File::name()` (basename in core 2.0.x) and returns the entry count.

### Partition table (changed)
The original table had a single 4 MB `app0` and 12 MB FS, which leaves ArduinoOTA nowhere to
write. Now: `nvs` 20 kB (unchanged), `otadata`, **`app0` + `app1` 4 MB each**, `spiffs` (LittleFS)
`0x7E0000` = 7.9 MB, `coredump` 64 kB. The probe firmware is 1.15 MB; the full firmware with fonts,
TLS and the runtime will be well under 4 MB. 7.9 MB is still far more cache than the OS needs
(manifests, icons, <= 256 kB PNGs, the glass image).

### CA bundle
`certs/gen_crt_bundle.py` (own implementation of ESP-IDF's `gen_crt_bundle.py` output format: u16
count, then `u16 name_len, u16 key_len, subject DER, SubjectPublicKeyInfo DER` per certificate,
sorted by subject DER because `esp_crt_bundle.c` binary-searches the issuer) produced
`x509_crt_bundle.bin` from **certifi 2026.07.22** (Mozilla's bundle): 121 roots, 55,587 bytes. It is
embedded with `board_build.embed_files` and referenced as
`_binary_src_boards_t5pro_certs_x509_crt_bundle_bin_start` (PlatformIO derives the symbol from the
path in `platformio.ini`, not just the basename). `WiFiClientSecure::setCACertBundle()` in core
2.0.17 attaches it per connection; the Arduino core does not ship a bundle of its own, so this is
the only source of trust. Regenerate with
`uv run --with certifi --with cryptography python3 gen_crt_bundle.py` (any PEM file can be passed
as the first argument instead). Note cross-signed roots sharing a subject: the verifier finds one
entry per subject; the IDF tool has the same limitation.

### HTTP
`HTTPClient` + a `Stream` sink into one `hal::alloc_big` buffer sized from `Content-Length` (or
`max_bytes` when unknown); the sink refuses bytes past `max_bytes`, which surfaces as
`HTTP_ERR_TOO_BIG`. Redirects disabled (3xx come back as status), `Accept-Encoding` is the client's
own `identity;q=1,...`; request headers named Host / Connection / Content-Length / Accept-Encoding are
dropped and `User-Agent` goes through `setUserAgent()` so nothing is sent twice. Errors:
`HTTPC_ERROR_READ_TIMEOUT` -> `TIMEOUT`; connection refused on https with an mbedTLS error code ->
`TLS`; `NO_HTTP_SERVER`/`ENCODING` -> `PROTOCOL`; the rest -> `CONNECT`. Plain `http://` is allowed
only when the host ends in `.local`, is a private IPv4 literal (10/8, 172.16/12, 192.168/16,
169.254/16, 127/8) or resolves to one; everything else is `HTTP_ERR_REFUSED` before any connection
is made.

### Web server
`WebServer` parses the query into arguments, so `Request.query` is rebuilt (URL-encoded) from them,
skipping the `plain` argument that holds a non-form body. A `POST` with
`application/x-www-form-urlencoded` therefore arrives with its fields merged into the query and no
body — the OS API uses JSON bodies, where this does not apply. `/` redirects to `/os`. In the probe
build a stub answers `{"probe":true,...}` so the layer links without the OS.

### Wi-Fi provisioning
`provision()` runs the hotspot `QuireOS-Setup` (open), a DNS catch-all and the scan-list form from
hn-t5's `net.cpp` (re-branded, no screen drawing), stores the credentials in NVS namespace `qnet`
(separate from the OS's `quireos` namespace so key names cannot collide) and returns; it does not
reboot. BOOT held for 3 s inside the portal returns without changes. The OS decides what to draw and
when to call `connect()`. `main.cpp` calls `net->forget()` when BOOT is held for 3 s at power-on (not
after a deep-sleep wake).

### ArduinoJson
The core vendors a single-header ArduinoJson under `src/runtime/third_party/`, so `platformio.ini`
has **no `lib_deps`**; adding the library again would produce duplicate definitions. epdiy and
SensorLib come from `lib/` (LDF mode `chain+`).

### Logging
`hal::log()` prints `[millis] L tag: message` on the USB CDC port; `Serial.setTxTimeoutMs(0)` in
`main.cpp`/the probe keeps logging from blocking when no host is attached. `CORE_DEBUG_LEVEL` is 1
(errors) for `t5pro` and 3 (info, shows epdiy's per-update timing and SensorLib's GT911 details) for
`probe`.

## Build results (2026-09-21, no hardware)
- `pio run -e probe`: **compiles and links** (Flash 1,147,273 bytes = 27 % of the 4 MB slot; static
  RAM 55,940 bytes). No warnings from `src/boards/t5pro` or `src/probe`.
- `pio run -e t5pro`: every translation unit compiles (board layer, `hal.cpp`, `os/net_task.cpp`,
  `os/prefs.cpp`, the whole `runtime/`); the link fails only on the OS entry points that do not
  exist yet: `quire::os::setup()`, `quire::os::loop()`, `quire::os::web::handle()`,
  `quire::os::web::release()`. Nothing to fix on the board side; it will link once `src/os/os.cpp`
  and the web handler land.

## Probe checklist (first run on hardware)
1. Serial shows the I2C scan: expect 0x20, 0x51, 0x55, 0x5d, 0x68, 0x6b.
2. Grey ramp with 16 distinct steps, black on the left, grid below, solid square top-left of the
   grid, hollow square bottom-right (portrait, USB port at the bottom). Wrong corner => rotation.
3. Tap: the 120 px square inverts under the finger without a flash (GL16). Mirrored => flip macros;
   transposed => `raw_portrait_`.
4. Hold >= 0.8 s: 200 px square via DU. Note the `copy`/`update` ms lines and put them in
   `caps_`/`board.json`.
5. S3 short toggles the frontlight; S3 long redraws; BOOT short prints status. If S3 does nothing,
   check the logged "PCA9535 input port 1" value and `T5PRO_PCA_BTN_ACTIVE_LOW`.
6. Status line: battery %, mV, charging with USB in/out, RTC valid after `clock->set()` (the OS's
   SNTP), free heap (record it: this is the budget for Wi-Fi + TLS + the OS).
7. Double-press S3: the device sleeps; a tap must wake it (wake cause 1 = TOUCH printed at boot) and
   the pattern must come back without a flash (glass image restored).

## Open issues
- Nothing here has run on the panel yet. The items above marked unverified: touch frame and
  polarity, S3 active level, GT911 INT wake polarity/pulse, thermistor presence, timing numbers.
- `hal::thread_start` pins every thread to core 0 with a byte-sized stack; the Arduino loop task
  stays on core 1 with 32 kB (`SET_LOOP_TASK_STACK_SIZE`).
- The 64 kB epdiy LUT (`EPD_LUT_64K`) lives in internal RAM. If Wi-Fi + TLS run short, switch to
  `EPD_LUT_1K` in `display.cpp` (slower updates).
- The web server rebuilds the query string from parsed arguments (see above); if the OS ever needs
  form posts, teach `web_server.cpp` to route `application/x-www-form-urlencoded` bodies.
- `provision()` runs a `WiFi.scanNetworks()` (blocking ~2-3 s) before the hotspot comes up and on
  every `/rescan`.
