# QuireOS firmware

PlatformIO project (espressif32@6.12.0, Arduino framework). Layout:

- `src/hal/` — the hardware abstraction (`hal.h`). The OS core includes nothing else from a board.
- `src/boards/<name>/` — one directory per board, selected with `-DQUIREOS_BOARD_<NAME>`:
  `t5pro` (LilyGo T5 E-Paper S3 Pro) and `host` (macOS emulator). `_template/` is the porting skeleton.
- `src/os/` — launcher, store, settings, Wi-Fi provisioning, LAN settings page, network task, prefs.
- `src/runtime/` — screen JSON parser, widget tree, renderer, expression evaluator, PNG decoding, fonts, icons.
- `emu/` — builds `src/os` + `src/runtime` + `boards/host` into a macOS binary with an HTTP frame server.
- `test/host/` — conformance and HAL contract tests (plain clang, no Arduino).
- `src/runtime/third_party/` — vendored ArduinoJson, pngle and miniz (see `third_party/README.md`).
- `tools/` — `gen_fonts.py` (Roboto tables + `spec/fonts.json` for every profile in `design/profiles.json`), `gen_icons.py` (icon tiers from `design/icons/icons.json`), `gen_www.py` (gzips the settings page).
- `lib/` — vendored board libraries (see ../THIRD_PARTY.md). `_from_hn_t5/` holds reference sources from
  ben-gy/hn-t5-epaper used while porting the t5pro board; delete once the port is complete.

Rules: no pin numbers, I2C addresses, vendor driver calls or RTOS calls outside `src/boards/`. The
renderer draws only into the 4-bit logical `Framebuffer` from `hal.h`; boards quantise and push.
