# Proposals for the OS session

Small changes the design system asks of the spec, the firmware tooling and the SDK. `spec/SPEC.md`
stays the core session's; this file is where design-side requests queue, with their outcome.

| # | proposal | outcome (2026-09-21) |
|---|---|---|
| 1 | OS corner | accepted into SPEC §8.2: 48 / 24 / 56 on t5pro, published per profile |
| 2 | `disabled` | accepted into SPEC §6.1 |
| 3 | `keys` | accepted as `{ short, double }`; a long press is always Home, `long` is rejected |
| 4 | dithered fills on 1-bit | deferred; boards threshold for now |
| 5 | icon tiers | accepted; gen_icons.py compiles core at sm + md and display at lg |
| 10 | icon sizes 24 / 36 / 64 | **done** in 88a3780; firmware image dropped 2.86 → 2.59 MB |
| 6 | fonts for all profiles | **done**; spec/fonts.json carries all six with real advance tables |
| 7 | `device.rssi` −100 offline | accepted into SPEC §3 |
| 8 | 56 px chrome in OS screens | accepted |
| 9 | SDK gaps | `disabled`/`keys` validation in progress; warning-vs-error noted |

## 1. Name the OS corner (SPEC §8.2, §6)

The OS draws its glyphs (offline, alert, update available, charging, low battery, busy) at a fixed
place on every app screen so apps can keep it clear:

```
corner = chrome.corner (48 px on t5pro)
x = page_margin + content_width − corner        content_width = floor((W − 2·margin) / u) · u
y = max(0, round_to_unit((chrome.nav − corner) / 2))
```

Values per profile are in [tokens/TOKENS.md](tokens/TOKENS.md) (`chrome.corner`, `space.page`).
Proposed text for §8.2: "The device draws status glyphs in a square of `corner` px whose right
edge is `margin` px from the screen's right edge and whose top is `(nav − corner) / 2` px from the
top, where `margin`, `nav` and `corner` are published per profile. Apps should not draw
interactive widgets there." Until then the kit's nav bar stops short of it and `stack()` narrows
the first rows to clear it.

Glyph vocabulary (all in `spec/icons.json` after §5): `wifi-off`, `alert-circle-outline`, `update`,
`battery-charging`, `battery-alert-variant-outline`, `progress-clock`.

## 2. `disabled` on tappable widgets (SPEC §6.1)

`disabled: <cond>` (default false). When truthy the widget is drawn with the profile's tertiary tone
and is not hit-tested; `feedback` is ignored. Until then the kit emits disabled controls without
`on_tap`, with `color`/`stroke` at the tertiary level and `stroke_w: 1`, which is what the device
would draw anyway.

## 3. `keys` for button-only devices (SPEC §6, §7)

Top-level screen field, as accepted:

```json
"keys": { "short": { "type": "navigate", "url": "/next.json" }, "double": { "type": "back" } }
```

A long press is always Home (the person's guaranteed escape) and cannot be claimed; the validator
rejects `keys.long`. When a screen claims neither key, short = Home and double = a full redraw.
The kit emits `keys` from `pagerRow()` (short = next, double = previous) and from any toolbar
cell with `key`, and its `validate()` rejects `long`.

## 4. Dither fills on 1-bit boards (HAL quantisation)

Boards with `greys: 2` threshold the 4-bit framebuffer at 8. That makes every mid-grey fill
vanish or go solid. Proposal: in the board's `present()`, quantise `rect`/`button` fill regions
with an ordered 4×4 Bayer matrix and threshold everything else (text, lines, icons stay crisp).
This needs the renderer to tag fill spans, or a second "fill mask" bitplane; the cheaper route is
a per-widget flag the renderer sets when it fills a rectangle. **Deferred** to a later version:
the design system's 1-bit tone table maps every fill to ink or paper and the kit adds a shape cue
for every state, so nothing depends on it. The preview page keeps a "dither fills" toggle showing
the intended result.

## 5. Icons: compile the design library's core tier

[icons/icons.json](icons/icons.json) tiers 294 Material Design Icons:

| tier | count | sizes | t5pro flash (4 bpp) |
|---|---|---|---|
| core | 238 | sm 24, md 36 | ≈ 217 kB |
| display (subset of core) | 44 | also lg 96 | ≈ 200 kB |
| extended | 56 | sm, md where flash allows | ≈ 51 kB |

`icons/names.txt` is the full list in `gen_icons.py`'s `ICONS` layout; `icons.json` carries the
`tier` and `display` flags so the generator can emit `lg` only for display icons. The 71 names
already compiled are all in the core tier, so nothing breaks. Suggested change to `gen_icons.py`:
read `design/icons/icons.json`, rasterise `sm` and `md` for `core`, `lg` for `display`, and take
`extended` behind a `--extended` flag; write the resulting names to `spec/icons.json` as now.

Also: the size table should come from the profile's tokens (`icon.sm/md/lg` per profile in
[tokens/tokens.json](tokens/tokens.json)) so a second board gets its own sizes.

## 10. Icon sizes: 24 / 36 / 64, not 32 / 48 / 96

**This changes what the firmware compiles.** The design system now sizes an icon to the text beside
it rather than to a round millimetre figure:

| size | was | now (t5pro) | why |
|---|---|---|---|
| `sm` | 32 | 24 | sits on an `xs`/`sm` line without overpowering it |
| `md` | 48 | 36 | equals the `md` line box, so nav and toolbar glyphs sit level with their labels |
| `lg` | 96 | 64 | a 24-unit glyph past about 3× scale has slab strokes; 96 is for an app's icon PNG, not for a compiled glyph |

A 48 px chrome glyph beside 36 px text was the single biggest reason the first pass read as heavy.
Flash goes **down**: about 300 kB for core at `sm` + `md` plus display at `lg`, against 570 kB before.

`design/icons/icons.json` carries the per-profile sizes (`sizes.<profile>.{sm,md,lg}`), so
`gen_icons.py` can read them rather than hard-coding `{"t5pro": {"sm": 32, "md": 48, "lg": 96}}`.
The launcher no longer needs a 96 px glyph: it draws a `md` glyph inside a rounded square, which is
also what makes room for an app's own 96 × 96 icon PNG to sit there instead.

**Shipped** in 88a3780, with the tier corrected in 57d6c7d after the icons the OS draws on its own
screens (the launcher's Store tile, the pairing glyph, the account rows) turned out to be sitting in
extended categories — the firmware had been silently substituting another glyph for the Store tile
and drawing nothing on the pairing screen. `gen_icons.py` reads the sizes from `design/tokens/tokens.json`, the core
tier is 238 icons with 44 at `lg` for 305 kB of bitmaps against 561 kB before, and the t5pro
firmware image went from 2.86 MB to 2.59 MB. `spec/fonts.json` now carries the per-profile sizes
and real advance tables for all six profiles, so nothing in the kit is estimated any more.

## 6. Fonts for the other profiles (`gen_fonts.py`)

`gen_fonts.py` hard-codes `PROFILE = "t5pro"` and the line-height table. The token build derives
line heights for six profiles from millimetres ([tokens/TOKENS.md](tokens/TOKENS.md), "Type line
heights"). Proposal: loop over `design/profiles.json`, take each profile's `type.<size>.line`
target from `design/tokens/tokens.json`, and emit all of them into `spec/fonts.json`. Flash cost is
per board build (`-DQUIREOS_BOARD` selects one profile's tables), so this costs nothing on t5pro.
Until then the kit scales t5pro's advances by line-height ratio for those profiles and marks them
approximate (`kit.approximate`).

## 7. `device.rssi` when offline

The kit's stepped Wi-Fi glyph draws `wifi-strength-N` icons with `when: device.rssi >= -85` and so
on, layered so the highest true step is on top. A device that reports `rssi` as `0` when offline
would show full strength under the `wifi-off` glyph. Proposal: `device.rssi` is `-100` whenever
`device.online` is false. (No spec change needed if the firmware simply does this; a sentence in
§3 would help app authors.)

## 8. Nav bar and toolbar heights in the OS screens

The Hacker News reader used 44 px bars. The design system's chrome is 56 px on t5pro (6 mm, the
minimum for a full-width touch row; Apple's is 6.9 mm). Launcher, store, settings and the built-in
screens should use `chrome.nav` / `chrome.toolbar` from the tokens, and the status bar
`chrome.status` (44 px, not tappable). The kit's `statusBar()`, `launcherGrid()`, `storeRow()`,
`errorScreen()`, `setupScreen()`, `needsSetupScreen()`, `updateOsScreen()` and `pairingScreen()`
are reference implementations; the gallery renders them for every profile.

## 9. SDK gaps found while building `@quireos/ui`

- `validateScreen` rejects nothing about `keys` today (good) but `tools/validate` should list
  unknown top-level fields as warnings, not errors, when §3 lands.
- `wrap()` treats consecutive spaces as empty words (spec-conformant). The kit normalises input
  before wrapping; worth a note in the SDK README for app authors pasting HTML-extracted text.
- A `Profile` for a screen size the firmware has no tables for: the kit builds one by scaling
  `t5pro` (`fontProfile(id)` in `cloudflare/ui/src/text.ts`). If the SDK grows a `scaleProfile()`
  helper the kit will use it.
- `etag()` is async (SubtleCrypto). Fine on Workers and Node 20+; the kit exposes `kit.etag()`
  as async for parity and the gallery uses `json(doc, req)`.
