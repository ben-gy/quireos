# The QuireOS emulator

The emulator is the OS core (`firmware/src/os`, `firmware/src/runtime`) compiled for macOS against
the **host board** (`firmware/src/boards/host`): a fake e-paper panel, a touch/button queue fed over
HTTP, storage under a directory, and libcurl for the network. Everything drawn comes from the real
renderer, fonts and icons, so a screen that looks right here looks the same on glass (except for
e-paper refresh artefacts). It is also the second `hal.h` implementation that keeps the abstraction
honest: the core contains no board code at all (`firmware/test/host/portability_check.sh`).

## Build and run

```sh
sh firmware/emu/build.sh                 # clang++ -std=c++17, links libcurl and libz
./firmware/emu/build/quireos-emu         # http://127.0.0.1:8087/
```

Options: `--device t5pro|trmnl`, `--port 8087`, `--data emu/data` (kv.json + file store; delete it
for a factory reset), `--log error|warn|info|debug` (`debug` logs every widget tree that is drawn).

Presets:

| preset | panel | greys | dpi | partial | touch | notes |
|---|---|---|---|---|---|---|
| `t5pro` | 960 × 540, portrait 540 × 960 | 16 | 235 | yes | yes | the reference device |
| `trmnl` | 800 × 480 landscape | 2 (1-bit) | 125 | no | no | proves the quantisation path: every present is FULL, greys threshold at 8 |

Open `http://127.0.0.1:8087/` in a browser: it shows the panel (polling `/info` for a new frame),
click the screen to tap, and use the buttons for the function key. Space = short press (the
screen's `keys.short`, else Home), Backspace = double press (`keys.double`, else a full redraw),
Enter = long press (always Home).

## HTTP endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | the page |
| `GET /frame.bmp`, `GET /frame.png` | the panel as an 8-bit grey image, quantised to the preset's greys |
| `GET /info` | `{name, w, h, greys, dpi, touch, mode, heap, frame, asleep, hw_id}`; `mode` is the OS mode (`launcher`, `store`, `settings`, `app`, `error`, `needs_setup`, `update_os`, `setup`) |
| `GET /ver` | `"<frame version> <asleep 0/1>"` |
| `POST /tap?x=&y=[&hold=1]` | a tap (or a ≥ 800 ms hold) in logical pixels; wakes the device when asleep |
| `POST /g?k=short\|double\|long[&b=1]` | a function-button gesture |
| `POST /dev?d=t5pro\|trmnl` | switch preset; the process re-executes itself |
| `/os`, `/os/api/*` | forwarded to the OS's own LAN settings page and JSON API (see below) |

Frames can be inspected without a browser: `curl -s localhost:8087/frame.png > f.png`.

## The LAN settings page and API

The device serves its settings page at `http://<device-ip>/os` (the emulator at `/os` on 8087).
The page is `firmware/src/os/www/settings.html`, gzipped into `settings_html_gz.h` by
`tools/gen_www.py`. The API (`firmware/src/os/web_api.cpp`) is JSON; every POST is validated in
the listener's context and then queued to the OS loop:

| Endpoint | Body | Effect |
|---|---|---|
| `GET /os/api/state` | | device, Wi-Fi, prefs, installed apps with their settings schema and **non-secret** values (secrets report `set: true/false`), store status, pairing |
| `POST /os/api/prefs` | `{name, tz, sleep_s, frontlight, refresh_policy, web_password}` | device preferences (any subset) |
| `POST /os/api/store` | `{store_url}` | store base URL, or a static index URL ending in `.json` (no device API: no registration, pairing or install reports) |
| `POST /os/api/app/install` | `{manifest_url}` | fetch + validate the manifest, save it, add the app |
| `POST /os/api/app/<id>/settings` | `{values: {...}}` | validated against the manifest; secrets: `""` keeps, `null` clears |
| `POST /os/api/app/<id>/uninstall`, `.../open` | | |
| `POST /os/api/pair`, `/refresh`, `/home`, `/updates`, `/reboot`, `/wifi/forget` | | |

If a password is set (`web_password`), every `/os` request needs HTTP basic auth (any user name).

## Development stores and fixtures

- **devstore** (`cloudflare/tools/devstore`): `node cloudflare/tools/devstore/dist/server.js
  cloudflare/apps/hello --port 8788` serves an index built from the manifests it finds. Point the
  emulator at it: `curl -X POST -d '{"store_url":"http://127.0.0.1:8788/index.json"}'
  localhost:8087/os/api/store`, then tap Store.
- **lanapp** (`firmware/emu/fixtures/lanapp`): `python3 firmware/emu/fixtures/lanapp/serve.py`
  runs the app origin on :8124 and a fake Home Assistant on :8123 that logs every request with its
  `Authorization` header. Install `http://127.0.0.1:8124/manifest.json`, set the token
  (`secret-123`) on the settings page, and watch the tile toggle with an optimistic `set` followed
  by `then: refresh`. The other tiles demonstrate the refusals: a secret sent to the app origin,
  and a request to an undeclared origin.

## Sleep

With `sleep_s` > 0 the OS calls `Power::sleep()` after that much idle time. The host marks the
device asleep (the page says so); the next tap or gesture, or the wake timer (the next TTL), wakes
it the way a real board does: `os::setup()` runs again and reopens the last app.

## Tests

`sh firmware/test/host/run.sh` builds and runs the host tests with plain clang:
`expr_test` (spec/conformance/expr.json), `wrap_test` (spec/conformance/wrap.json;
`--generate` rewrites it from the firmware's wrap()), `parser_test` (spec/conformance/screens),
`hal_contract_test` (the host board through `hal.h` only) and `portability_check.sh`.

## Regenerating assets

```sh
uv venv firmware/.venv && uv pip install --python firmware/.venv/bin/python freetype-py resvg-py pillow
firmware/.venv/bin/python firmware/tools/gen_fonts.py --profile t5pro   # fonts/*.h, profile_gen.h, spec/fonts.json
firmware/.venv/bin/python firmware/tools/gen_icons.py --profile t5pro   # icons_gen.h, spec/icons.json
python3 firmware/tools/gen_www.py                                       # settings_html_gz.h
```
