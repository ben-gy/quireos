# Firmware notes on the spec

Decisions the firmware (`firmware/src/runtime`, `firmware/src/os`) took where SPEC.md leaves room,
plus deviations and open issues. The SDK should match the items marked **contract**.

## Fonts and metrics (`spec/fonts.json`)

- Line heights for every profile are the token targets exactly (t5pro: 24/29/36/44/56/72/96/150),
  found by searching 26.6 char sizes for the largest size whose FreeType `height` rounds to the
  target; the achieved pixel size is recorded as `px`. `ascent`/`descent` are FreeType's rounded
  ascender/descender; the baseline of a line box sits at `y + ascent`.
- Glyph set: printable ASCII, Latin-1 Supplement, `– — • … € ↑ ↓`. Roboto has no `←`/`→`
  (U+2190/U+2192); they are omitted and draw as the fallback glyph. **Contract:** a code point
  missing from `advance` measures as `default_advance`, which is the advance of `?`, and the device
  draws `?`.
- Bitmaps are hinted (FreeType default), 4 bpp coverage; advances are the hinted integer advances.
- Text is clipped to the widget rectangle; a `text` widget's `h` defaults to `line_height × lines`.

## Icons (`spec/icons.json`)

- The `core` tier of `design/icons/icons.json` is compiled at `sm` and `md`; the `display` subset
  also at `lg` (`lg` array in icons.json). An `lg` request for any other icon draws its `md` bitmap
  centred in the box. Ten OS roles (store, paired, account, sign in/out, devices and
  their filled variants) were promoted to `core` on 2026-09-22 regardless of category, because the
  OS draws them on its own screens: core is 238 icons, extended 56. `gen_icons.py --extended`
  compiles the extended tier too (about +110 kB).
- `spec/icons.json` keeps the `icons` and `sizes` keys and adds `lg`, `profile` and `source`.

## Templates and expressions (§3)

- Numbers render with JS `Number#toString` rules. ArduinoJson stores short decimals as `float`
  (parsed in float arithmetic, up to a ulp off the nearest float); the renderer recovers the
  original decimal by re-parsing candidates through the same parser, and numeric comparisons
  involving such a value are done at that precision. `21.456` therefore renders as `21.456` and
  `vars.temp == 21.456` is true, matching the SDK, which sees the JSON as doubles.
- `fixed:n` uses JS `toFixed` rounding (ties away from zero) and **applies to numeric strings** as
  well as numbers (Home Assistant states are strings). Non-numbers pass through.
- `time:'fmt'`: tokens as listed, longest match first (`HHH` = `HH` + `H`); `a` renders `am`/`pm`
  (en-AU). Fractional epochs floor. ISO-8601 without a zone and date-only values are **device
  local** time; values that are neither a number nor ISO-8601 pass through unchanged.
- Conditions: quoted literals still compare numerically when both sides parse as numbers
  (`vars.ten > '9'` is true). A condition with nothing before the operator, or nothing after it,
  is malformed and false. Objects and arrays are falsy.
- Comparison of non-numbers is a byte-wise `strcmp` of the rendered strings.
- Unknown filters render the whole expression as `""` and are logged.
- Conditional values nest at most three deep; deeper `if`s resolve to null.
- `device.rssi` is `-100` whenever `device.online` is false.

## Time zones

The device carries no tz database. `X-Timezone` is the IANA name from settings; formatting uses a
built-in table (Australia, New Zealand, Europe, North America, common Asian and African zones)
with the current DST rules, plus fixed offsets (`UTC`, `UTC+10`, `UTC-05:30`, `Etc/GMT-10`).
Unknown names behave as UTC. Historical rule changes are not modelled. Conformance fixtures using
`Australia/Sydney` and `America/New_York` pass.

## Screens (§6)

- Fail-soft vs reject. The device rejects: bad/newer `spec_version`, missing/invalid `id`,
  missing `widgets`, more than 96 widgets (grid children counted), more than 8 data sources, more
  than 16 vars, more than 2 images, a duplicate/reserved/invalid data id, a data source without
  `url`, any string over 512 bytes, documents over 32 kB. Everything else in
  `spec/conformance/screens` that the SDK validator flags (unknown widget or action types, enum
  typos, ranges, missing widget fields, templates in the wrong place…) is handled softly: the
  widget is skipped or the value clamped/defaulted, and logged. `spec_version` missing is treated
  as 1. `parser_test` records which invalid fixtures the device accepts.
- `text` needs `w` (skipped otherwise); grid children default to the cell rectangle.
- Colours out of range clamp to 0-15; `lines` clamps to 1-8; `stroke_w` 1-8; `radius` 0-64.
- Buttons: label wraps to `lines` (default 2) in bold `md`; `sub` is `sm` regular at the bottom;
  the icon sits above the label and shrinks to `md`/`sm` when the box is too small.
- `disabled`: text, icons, lines and strokes at the tertiary tone (9 on 16 greys, 10 on 4, 0 on
  1-bit, where it is indistinguishable from enabled); dark fills become `fill_disabled` (13); no
  hit-testing, no feedback.
- `keys`: `keys.long` is ignored with a log line. A `submit` triggered by a key reports
  `"widget": "#key"`.
- `on_hold` on a widget without one runs `on_tap`.
- The first render of a screen waits until every data source has answered (or failed), so the
  panel does not flash twice; later data responses cause partial redraws of the widgets whose
  evaluated state changed. `vars` are re-initialised from their templates after **every** data
  load (not only the first), so `set` overrides last until the next data fetch, screen reload or
  `refresh`.
- The OS corner (offline, background failure, busy, update, charging, low battery; that priority)
  is drawn over app screens only; the OS's own screens have a status bar.

## Network policy (§8.4)

- Loopback (`127.0.0.1`, `localhost`) counts as a private host so the emulator can talk to local
  servers over plain http.
- `X-App-Settings` is omitted when the encoded non-secret settings exceed 2 kB (logged).
- A store URL ending in `.json` is treated as a static index (the devstore): no device
  registration, pairing, detail pages or install reports.

## Storage and boards

- kv keys: `store_url`, `dev_token`, `dev_id`, `paired`, `apps`, `cfg/<app id>`, `sleep_s`,
  `frontlight`, `tz`, `web_pw`, `refresh`, `name`, `upd_check`, `last_app`. NVS limits keys to 15
  characters: boards must map `cfg/<id>` (up to 36 chars) themselves.
- Flash budget on t5pro: fonts 900 kB, icons 561 kB, settings page 4.5 kB gzipped.
- Manifest icons given as PNG URLs are fetched (≤ 64 kB), decoded to 96 × 96 and stored as
  `/apps/<id>/icon.bin`, but the launcher currently draws the built-in icon named in the manifest
  (or `apps`); drawing the stored PNG on the tile is an open issue.

## Open issues

- Offline cache of the last screen and data (plan: LittleFS) is not implemented; offline shows the
  error screen with Retry.
- ETags are not persisted across deep sleep, so a timed wake re-fetches and redraws in full.
- `submit` responses with `204` re-arm `then` but do not update `url`.
- Dithered fills on 1-bit boards (design proposal 4) are deferred; the host `trmnl` preset thresholds.
