# Third-party components

| Component | Where | Licence | Notes |
|---|---|---|---|
| epdiy | `firmware/lib/epdiy/` | LGPL-3.0 | E-paper panel driver (`epd_board_v7`, ED047TC1) and its font renderer, as vendored by LilyGo in [T5S3-4.7-e-paper-PRO](https://github.com/Xinyuan-LilyGO/T5S3-4.7-e-paper-PRO). |
| SensorLib | `firmware/lib/SensorLib/` | MIT | Lewis He. GT911 touch and PCF8563 RTC drivers. |
| Roboto | `firmware/fonts/` (TTF) and generated tables under `firmware/src/runtime/fonts/` | Apache-2.0 | Google. Tables generated with epdiy's `fontconvert.py`. |
| Material Design Icons | `firmware/src/runtime/icons_gen.h`, `spec/icons.json`, `design/icons/` | Apache-2.0 / Pictogrammers Free | The design library's `core` tier at sm/md and `display` tier at lg, rasterised by `firmware/tools/gen_icons.py`. |
| ArduinoJson 7.4.3 | `firmware/src/runtime/third_party/` | MIT | Single-header JSON. |
| pngle | `firmware/src/runtime/third_party/` | MIT | PNG decoder. |
| miniz | `firmware/src/runtime/third_party/` | MIT | Inflate for PNG. See `firmware/src/runtime/third_party/README.md`. |

Board bring-up for the T5 E-Paper S3 Pro (display, touch, gauge, portal) was first written for
[ben-gy/hn-t5-epaper](https://github.com/ben-gy/hn-t5-epaper) and adapted here under MIT with the
author's permission (same author).
