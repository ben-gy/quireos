# Vendored third-party code (runtime)

| File | Project | Version | Licence |
|---|---|---|---|
| `ArduinoJson.h` | [ArduinoJson](https://arduinojson.org) by Benoit Blanchon | 7.4.3 (single header release) | MIT |
| `pngle.c`, `pngle.h` | [pngle](https://github.com/kikuchan/pngle) by kikuchan | master, 2026 | MIT (`PNGLE_LICENSE`) |
| `miniz.c`, `miniz.h` | miniz by Rich Geldreich, as bundled by pngle | 1.15 | Public domain / unlicense (see the end of `miniz.c`) |

`miniz.h` is pngle's header-only shim (`MINIZ_HEADER_FILE_ONLY` + `miniz.c`); `miniz.c` must also be
compiled once. The vendored copy defines `MINIZ_NO_ZLIB_APIS`, so it does not clash with a system zlib
(the emulator links `-lz` for its PNG frame export). On ESP32 the ROM already contains miniz; boards
may drop `miniz.c` and provide `tinfl_*` from the ROM if flash is tight.

None of these headers is included from `hal.h`; `ArduinoJson.h` includes `<Arduino.h>` only when
`ARDUINOJSON_ENABLE_ARDUINO_STRING` is set, which the host build does not do.
