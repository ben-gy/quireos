# Porting QuireOS to a new board

The OS core (`firmware/src/os`, `firmware/src/runtime`) depends on one header,
`firmware/src/hal/hal.h`. A board is a directory under `firmware/src/boards/<name>/` that implements
the six interfaces and the free functions declared there, and a PlatformIO environment that
compiles the core plus that directory. `firmware/src/boards/_template/` is a skeleton with every
method stubbed and a TODO; `firmware/src/boards/host/` is a complete implementation for macOS.

## 1. The six interfaces

| Interface | What the OS expects |
|---|---|
| `Display` | `caps()` describes the panel (native size, bpp 1/2/4, greys 2/4/16, dpi, partial/fast updates, typical timings). `begin(rot)`/`set_rotation()`: logical width/height follow the rotation. `present(fb, region, mode)` pushes the **4-bit logical framebuffer** (two pixels per byte, low nibble = left pixel, 0 = black, 15 = white, stride `(w+1)/2`) to glass: quantise to your depth (16 → 4 greys: 0-3 → 0, 4-7 → 5, 8-11 → 10, 12-15 → 15; 16 → 2: below 8 = black), map logical to native coordinates, honour `region` when you support partial updates, treat every mode as FULL otherwise. `power_off()` cuts the panel rails; the image must persist. |
| `Input` | `caps()`: touch yes/no, button list. `poll(Event&)` is non-blocking and yields `TAP`/`HOLD` (logical coordinates; a hold is ≥ 800 ms) and `BUTTON` (id + short/long/double gesture). Debounce and gesture detection are yours. |
| `Power` | `caps()`: battery, charging, frontlight, deep sleep. `battery_percent()` (-1 unknown), `charging()`, `frontlight(0..255)`. `sleep(WakeSources)`: enter deep sleep with touch/button/timer wake; on most boards it never returns and the OS reads `wake_cause()` after the reset. `free_heap()`/`free_psram()` are informational. |
| `Clock` | epoch seconds; `set()` after SNTP. Back it with an RTC when the board has one so the clock survives deep sleep. |
| `Storage` | `kv_*`: small NUL-terminated strings ≤ 2 kB (NVS on ESP32). The OS uses keys such as `store_url`, `apps`, `cfg/<app id>`; NVS keys are limited to 15 characters, so hash or shorten longer keys inside the board. `file_*`: a filesystem for `/apps/<id>/manifest.json`, `/apps/<id>/icon.bin` and caches; `file_read` allocates (PSRAM if you have it), `file_remove` removes directories recursively. |
| `Net` | Wi-Fi state (`connected`, `rssi`, `ssid`, `ip`), credentials (`has_credentials`, `connect`, `forget`, `provision()` = a blocking captive portal that returns once credentials are stored), and **blocking** `http()`: no redirects, TLS validated against a CA bundle, plain http only where the OS allows it (it checks the host before asking), `max_bytes` enforced (`HTTP_ERR_TOO_BIG`), `ETag` and `Content-Type` captured, body NUL-terminated, freed with `http_free`. The OS calls it only from its network task. |

Free functions: `thread_start` (one task for the network worker), `mutex_*`, `millis`, `delay_ms`,
`yield`, `random_u32`, `alloc_big`/`free_big` (PSRAM when available: framebuffer, widget trees,
JSON documents, decoded images), `log`, `reboot`, `board()` (the `Board` struct with your devices,
`name`, `profile`, `os_version` = `QUIREOS_VERSION`, `default_rotation`) and `device_hw_id()`
(12 lowercase hex characters, e.g. from the MAC).

Rules: no pin numbers, bus addresses, vendor driver calls or RTOS calls outside `src/boards/`
(`test/host/portability_check.sh` greps for them); no exceptions or RTTI in the core; large buffers
through `alloc_big`.

## 2. The profile

A profile is what the OS tells apps about the display (`X-Screen`, `device.w/h/greys/dpi`) and
what the design system derives type, icon and chrome sizes from. Profiles live in
`design/profiles.json` (add yours there); `design/tokens/build.mjs` turns them into
`design/tokens/tokens.json`. Then generate the board's tables:

```sh
firmware/.venv/bin/python firmware/tools/gen_fonts.py --profile <name>   # fonts/*.h, profile_gen.h
firmware/.venv/bin/python firmware/tools/gen_icons.py --profile <name>   # icons_gen.h
```

`gen_fonts.py` writes every profile's metrics into `spec/fonts.json` (the SDK reads them) but C
tables only for `--profile`, so a firmware carries one profile's fonts (about 900 kB for t5pro) and
icons (about 560 kB: the core tier at sm/md, the display subset also at lg). `profile_gen.h` holds
the chrome sizes (margin, nav, status, corner…), icon sizes and tone levels the OS screens use.
`Board::profile` must name that profile.

## 3. PlatformIO

Add an environment to `firmware/platformio.ini` that defines `-DQUIREOS_BOARD_<NAME>`, builds
`src/hal`, `src/os`, `src/runtime` (and `src/runtime/third_party/*.c`) plus `src/boards/<name>`,
and excludes the other boards (`build_src_filter`). Vendored panel/touch drivers go under
`firmware/lib/`. The board's `main.cpp` constructs the devices, then calls `quire::os::setup()` once
and `quire::os::loop()` forever; forward the board's HTTP listener to `quire::os::web::handle()`
for the LAN page.

## 4. Verify

1. `sh firmware/test/host/run.sh` still passes (the core did not change).
2. Port `firmware/test/host/hal_contract_test.cpp` to the board (it only uses `hal.h`): geometry,
   present/quantisation, input queue, storage round trips, HTTP error mapping.
3. On glass: the launcher renders; a tile inverts within ~200 ms of a tap (FAST/PARTIAL); a full
   refresh clears ghosting; the function button works (short/double per the screen, long = Home);
   sleep and wake by touch, button and timer; the LAN page reachable at `http://<ip>/os`.
