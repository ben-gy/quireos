# QuireOS App Specification, version 1

Status: normative for `spec_version: 1`. Both the firmware (`firmware/src/runtime`) and the SDK
(`cloudflare/sdk`) implement this document; `spec/conformance/` pins the parts where they must agree
byte for byte (template evaluation, word wrapping, document validation).

QuireOS is an operating system for e-paper devices. An **app** is a small HTTP service (or a folder of
static files) that returns **screen documents**: JSON describing what to draw and what taps do. The
device renders screens with fonts and icons compiled into the firmware, handles taps locally, and talks
to the app only when a screen says so. Apps never run code on the device.

Design principles:

1. **Server decides, device draws.** The device fetches, substitutes, compares, draws and hit-tests.
   Anything else happens on the app's server.
2. **One flat document, absolute coordinates, one pass.** No layout engine on the device. A `grid`
   helper does arithmetic, not layout.
3. **Few requests, everything ETagged.** A screen costs one fetch plus at most eight small data fetches
   and two images. `304 Not Modified` means "do nothing".
4. **The device enforces network policy.** An app can only talk to its own origin and the hosts it
   declared; secrets only ever go to declared hosts.
5. **Fail soft, version explicitly.** Unknown fields are ignored, unknown widgets are skipped,
   `spec_version` gates everything, and a transient error never blanks a working screen.

## 1. Conventions

- Documents are UTF-8 JSON with `"spec_version": 1` at the top level.
- **URLs** are absolute (`https://…`, `http://…`) or **origin-relative** (`/path`). Origin-relative URLs
  resolve against the origin of the document that contains them. `./` and `../` are not supported.
- **Colour** is an integer `0`–`15`: `0` is black ink, `15` is white paper. Devices with fewer greys
  quantise: on a 4-grey panel `0-3 → 0`, `4-7 → 5`, `8-11 → 10`, `12-15 → 15`; on a 1-bit panel `0-7 → 0`,
  `8-15 → 15`.
- **Identifiers** (`id`, setting keys, data ids, var names) match `^[a-z][a-z0-9_-]{0,31}$`. App ids
  (store slugs) additionally may not contain `_`.
- **Versions** are `MAJOR.MINOR.PATCH` with integer parts, compared numerically part by part.
- **Sizes and positions** are integers in logical pixels of the device's current orientation.
- Coordinates are relative to the top-left of the screen, `x` to the right, `y` down.

## 2. The device

Every request a device makes carries these headers:

| Header | Example | When |
|---|---|---|
| `User-Agent` | `QuireOS/0.1.0 (t5pro)` | always |
| `X-Device-Id` | `a1b2c3d4e5f6` (stable, derived from hardware) | always |
| `X-OS-Version` | `0.1.0` | always |
| `X-Spec-Version` | `1` | always |
| `X-Screen` | `540x960x16@235` = logical width × height × grey levels @ dpi | always |
| `X-Timezone` | `Australia/Sydney` | always |
| `X-Locale` | `en-AU` | always |
| `X-Install-Id` | UUIDv4 minted when the app was installed | app requests |
| `X-App-Id` / `X-App-Version` | `hn` / `1.2.0` | app requests |
| `X-App-Settings` | URL-encoded JSON of the app's **non-secret** settings, ≤ 2 kB | screen and event requests to the app origin only |
| `If-None-Match` | the ETag of the copy the device holds | re-fetches |
| `Accept` | `application/json` or `image/png` | always |
| `Accept-Encoding` | `identity` | always (the device does not decompress) |

`X-Screen` is the **logical** size after the app's `orientation` is applied. The same device reports
`540x960x16@235` to a portrait app and `960x540x16@235` to a landscape app.

Timeouts: 5 s to connect, 10 s total. Redirects are not followed. TLS certificates are validated
against a public CA bundle; plain `http://` is allowed only to private-network hosts (RFC 1918,
link-local, `.local`).

## 3. Templates and expressions

One syntax is used everywhere a string can be dynamic: `{{ expr }}`, any number of times inside a
string. Whitespace inside the braces is ignored.

```
expr     := path ( "|" filter )*
path     := root ( "." segment )*          segment = identifier | non-negative integer
root     := "settings" | "vars" | "device" | <data source id>
filter   := "fixed:" int | "default:" literal | "upper" | "lower" | "time:" literal
literal  := 'single-quoted string' | bare-word | number
```

Resolution rules:

- A missing path resolves to the empty string. Objects and arrays resolve to the empty string.
- Numbers render in their shortest form (`21`, `21.5`); booleans render as `true`/`false`.
- `fixed:n` formats a number with `n` decimals (non-numbers pass through). `default:'x'` substitutes
  `x` when the value is empty. `upper`/`lower` change case (ASCII). `time:'fmt'` formats an epoch in
  seconds or an ISO-8601 string in the device's time zone; tokens `HH H hh h mm ss a d dd M MM MMM MMMM
  yyyy EEE EEEE`; any other character is copied.
- Roots: `settings.<key>` (this app's settings; list rows as `settings.<key>.<index>.<field>`),
  `vars.<name>` (screen variables), `device.time` (epoch seconds), `device.tz`, `device.battery`
  (0-100 or -1), `device.charging`, `device.rssi` (dBm; **-100 whenever `device.online` is false**),
  `device.name`, `device.online`, `device.w`, `device.h`, `device.greys`, `device.dpi`, and
  `<data id>.<path>` into a data source's JSON.
- A screen that references `device.time` is re-evaluated once a minute with no network traffic; if any
  rendered value changed, the affected widgets are redrawn. This is how clocks work.

**Conditions** are single expressions with an optional comparison, without braces:

```
cond := expr ( op literal )?         op ∈  ==  !=  <  >  <=  >=
```

If both sides parse as numbers the comparison is numeric, otherwise it is a case-sensitive string
comparison. A bare `expr` is a truthiness test: `null`, `""`, `"0"`, `"false"`, `"off"`, `0`, `false`
are falsy; everything else is truthy.

**Conditional values** are the one branching construct, allowed wherever a scalar is expected:

```json
{ "if": "vars.pool == on", "then": 0, "else": 15 }
```

`then`/`else` may be scalars, templates or another conditional (depth ≤ 3). An object is a
conditional exactly when it has a string `if` and a `then` key; `else` is optional and resolves to
"not set" (empty text, a colour's default). There is no `&&`/`||`; nest conditionals or compute in
the app. Colour properties (`color`, `fill`, `stroke`) accept conditionals but not bare templates.

Details both implementations follow (pinned by `spec/conformance/expr.json`): a malformed
expression, unknown filter or bad filter argument renders as `""`; an unclosed `{{` is literal text;
numbers render in shortest round-trip form; `fixed:n` also applies to numeric strings and rounds half
away from zero; the numeric test for comparisons is `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`;
non-numeric comparisons order by UTF-16 code units; a missing value compares as `""`; malformed
conditions are falsy and a missing `when` is truthy.

Where templates may appear: any string-typed widget property, `vars` values, action `url`, `headers`,
`body` string values, `args` values, data-source `url`/`headers`/`body`. Where they may **not** appear:
`id`, `type`, numeric geometry, `spec_version`.

## 4. Store index

The device's store screen (and the store website) read one document:

```json
{
  "spec_version": 1,
  "store": { "name": "QuireOS Store", "updated": "2026-09-21T08:00:00Z" },
  "apps": [
    {
      "id": "hello",
      "name": "Hello",
      "tagline": "The ten-line tutorial app",
      "icon": "star",
      "version": "1.0.0",
      "manifest": "https://quireos-store.example.workers.dev/a/hello/1.0.0/manifest.json",
      "min_os": "0.1.0",
      "screens": ["540x960", "960x540"],
      "categories": ["demo"],
      "author": "ben-gy",
      "kind": "hosted",
      "visibility": "public",
      "installs": 12
    }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `spec_version` | int | yes | |
| `store.name` | string | yes | |
| `store.updated` | ISO-8601 | yes | Informational; the ETag drives caching |
| `apps[].id` | id | yes | Equals the manifest `id` |
| `apps[].name` / `tagline` | string | yes | ≤ 24 / ≤ 80 chars |
| `apps[].icon` | icon name or PNG URL | yes | |
| `apps[].version` | version | yes | Equals the manifest `version` |
| `apps[].manifest` | URL | yes | Absolute |
| `apps[].min_os` | version | yes | |
| `apps[].screens` | string[] | no | Logical sizes the app supports; absent = any |
| `apps[].categories` | string[] | no | |
| `apps[].author` | string | no | Store account login |
| `apps[].kind` | `hosted` \| `external` | no | Store-hosted bundle or owner-hosted service |
| `apps[].visibility` | `public` \| `unlisted` \| `private` | no | Present only in authenticated responses |
| `apps[].installs` | int | no | |

The index is served with a strong `ETag` and `Access-Control-Allow-Origin: *`. Anonymous responses
carry `Cache-Control: public, max-age=300`; responses to a paired device (which can include that
account's private apps) carry `Cache-Control: private, max-age=300` and `Vary: Authorization`. The
device re-fetches the index when the store screen opens and at most once a day for update checks.

`tagline` comes from the store listing, not the manifest, and may be empty. `icon` is the icon
uploaded to the store listing when present, otherwise the manifest `icon`.

## 5. App manifest

```json
{
  "spec_version": 1,
  "id": "ha-lights",
  "name": "HA Lights",
  "version": "1.0.0",
  "min_os": "0.1.0",
  "icon": "lightbulb",
  "orientation": "portrait",
  "screens": ["540x960"],
  "entry": "/screens/home.json",
  "event": "/event",
  "hosts": ["{{settings.ha_url}}"],
  "settings": [
    { "key": "ha_url", "label": "Home Assistant URL", "type": "url", "required": true,
      "default": "http://homeassistant.local:8123", "help": "Where the device can reach HA on your LAN" },
    { "key": "ha_token", "label": "Long-lived access token", "type": "secret", "required": true,
      "help": "HA > Profile > Security > Long-lived access tokens" },
    { "key": "entities", "label": "Switches", "type": "list", "max": 8, "required": true,
      "item": [
        { "key": "id", "label": "Entity id", "type": "string", "required": true },
        { "key": "label", "label": "Tile label", "type": "string", "required": true }
      ] }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `spec_version` | int | yes | |
| `id` | id | yes | Stable forever |
| `name` | string | yes | ≤ 24 chars |
| `version` | version | yes | Bump on every publish |
| `min_os` | version | yes | Device refuses to install when its OS is older |
| `icon` | icon name or PNG URL | yes | PNG: 96×96 grey, fetched once at install |
| `orientation` | `portrait` \| `landscape` | no | Default `portrait`. One per app; screens cannot override |
| `screens` | string[] | no | Logical sizes the app is designed for; absent = any. The device installs anyway and passes `X-Screen` |
| `entry` | URL | yes | First screen |
| `event` | URL | no | Target of `submit`. Absent means `submit` is a no-op |
| `hosts` | string[] | no | Extra origins the app may contact: a literal origin (`https://api.open-meteo.com`) or `{{settings.<key>}}` where `<key>` is a `url` setting |
| `settings` | Setting[] | no | ≤ 8 entries; a `list` value serialises to ≤ 2 kB |

Setting:

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | id | yes | |
| `label` | string | yes | |
| `type` | `string` \| `secret` \| `url` \| `number` \| `bool` \| `select` \| `list` | yes | |
| `required` | bool | no | The app cannot open until required values exist ("Needs setup" screen) |
| `default` | matches type | no | Not allowed for `secret` |
| `help` | string | no | |
| `options` | `[{value,label}]` | select | |
| `min` / `max` | number | no | Range for `number`; row count for `list` (max ≤ 16) |
| `item` | Setting[] of scalar types | list | Fields of each row; no nested lists |

Values are entered on the device's LAN settings page and stored on the device. In templates they
stringify; list rows are addressed as `settings.entities.0.id`.

Manifests must be served with an `ETag`. The device re-checks an installed manifest when the store
screen opens and at most once a day; a higher `version` shows an update badge. Updates are never
applied silently because a new version may add required settings.

## 6. Screen document

```json
{
  "spec_version": 1,
  "id": "home",
  "url": "/screens/home.json",
  "ttl": 0,
  "refresh": "auto",
  "data": [
    { "id": "e0", "url": "{{settings.ha_url}}/api/states/switch.pool_lights",
      "headers": { "Authorization": "Bearer {{settings.ha_token}}" }, "ttl": 30 }
  ],
  "vars": { "e0": "{{e0.state}}" },
  "widgets": [
    { "type": "text", "x": 24, "y": 24, "w": 400, "h": 44, "text": "Lights", "size": "xl", "weight": "bold" },
    { "type": "line", "x1": 24, "y1": 80, "x2": 516, "y2": 80, "color": 0 },
    { "type": "grid", "x": 24, "y": 100, "cols": 2, "rows": 4, "cell_w": 238, "cell_h": 190, "gap": 16,
      "children": [
        { "type": "button", "cell": 0, "id": "t0", "label": "Pool Lights",
          "fill": { "if": "vars.e0 == on", "then": 0, "else": 15 },
          "sub":  { "if": "vars.e0 == on", "then": "ON", "else": "OFF" },
          "on_tap": {
            "type": "http", "method": "POST",
            "url": "{{settings.ha_url}}/api/services/switch/toggle",
            "headers": { "Authorization": "Bearer {{settings.ha_token}}" },
            "body": { "entity_id": "switch.pool_lights" },
            "set": { "e0": { "if": "vars.e0 == on", "then": "off", "else": "on" } },
            "then": "refresh", "after": 1
          } }
      ] }
  ]
}
```

Top-level fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `spec_version` | int | yes | |
| `id` | id | yes | Reported in `submit` events |
| `url` | URL | no | Canonical URL, used for `ttl` re-fetches. Defaults to the URL the screen came from. `submit` responses should set it |
| `ttl` | int seconds | no | Re-fetch the screen (with `If-None-Match`) after N seconds. `0` = only on open, `refresh`, or settings change. Default 300. Values 1–9 are clamped to 10 |
| `refresh` | `auto` \| `partial` \| `full` | no | E-paper update hint. `auto` (default) lets the device pick; `full` always does a clean full refresh (image-heavy screens); `partial` avoids the flash unless the device's ghosting policy forces one |
| `data` | DataSource[] | no | ≤ 8 (§6.3) |
| `vars` | map id → value | no | ≤ 16. Initialised from their templates after data loads, on every (re)load and `refresh`; `set` overrides until then |
| `widgets` | Widget[] | yes | ≤ 96 including grid children. Array order is draw order and z-order; hit-testing picks the topmost |
| `keys` | map | no | Actions for the device's app-assignable button: `{"short": Action, "double": Action}`. A **long press is always Home** and cannot be claimed. When a screen does not claim `short`, a short press is Home too. Devices without an app-assignable button ignore the field |

Limits: target under 8 kB, hard limit **32 kB** (larger documents are rejected with an error screen).
Any single string ≤ 512 bytes.

**The OS corner.** The device draws its own status glyphs (offline, alert, update available,
charging, low battery, busy) in a square of `corner` px whose right edge is `margin` px from the
screen's right edge and whose top is `(nav − corner) / 2` px from the top; `corner`, `margin` and
`nav` are published per device profile (§10). Apps should keep interactive widgets out of that square.

### 6.1 Common widget fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | |
| `id` | id | no | Needed for `submit` events and useful for logs |
| `x`, `y` | int | yes | May be negative |
| `w`, `h` | int | mostly | See each type |
| `when` | condition | no | Falsy: not drawn, not hit-tested |
| `disabled` | condition | no | Truthy: drawn dimmed (ink at the profile's tertiary tone, colour 9 on 16-grey panels), not hit-tested, `feedback` ignored. Default false |
| `on_tap` | Action | no | |
| `on_hold` | Action | no | Press ≥ 800 ms. Optional for devices |
| `feedback` | `invert` \| `none` | no | Default `invert` for `button`, `none` otherwise. `invert` flips the widget's rectangle as soon as a tap is accepted, until the next render |

### 6.2 Widget types

**`text`**

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | template | yes | |
| `size` | `xs` \| `sm` \| `md` \| `lg` \| `xl` \| `2xl` \| `3xl` \| `digits` | no | Default `md`. Line heights per size are published in `spec/fonts.json` per device profile. `digits` is a very large face limited to `0-9 : . - ° %` and space |
| `weight` | `regular` \| `bold` | no | Default `regular` |
| `align` | `left` \| `center` \| `right` | no | Default `left` |
| `valign` | `top` \| `middle` \| `bottom` | no | Default `top` |
| `color` | 0–15 | no | Default 0 |
| `lines` | int 1–8 | no | Default 1. More than 1 enables word wrap in `w`; overflow on the last line is ellipsised |
| `h` | int | no | Defaults to `line_height × lines` |

**`rect`** — `fill` (0–15 or `null`; default `null`), `stroke` (0–15 or `null`; default `null`),
`stroke_w` (1–8, default 2), `radius` (0–64, default 0).

**`line`** — `x1, y1, x2, y2` (required), `color` (default 0), `width` (1–8, default 1). Diagonals are
drawn without anti-aliasing.

**`icon`** — `name` (required; one of `spec/icons.json`), `size` (`sm` \| `md` \| `lg`, default `md`),
`color` (default 0). Pixel sizes come from the device profile (§10) and are chosen to match the text
beside them, so read them rather than assuming: on the reference device `sm` sits on an `xs`/`sm`
line, `md` equals the `md` line box, and `lg` is a screen's single focal glyph. `w`/`h` default to
the icon size, **except for a grid child, which fills its cell unless given `w`/`h`**. An unknown
name draws nothing and is logged.

**`image`** — `src` (PNG URL, required; may contain templates), `ttl` (int seconds; re-fetch with
`If-None-Match`; `0` = only with the screen; default = the screen's `ttl`). The PNG should be exactly
`w × h`; otherwise it is drawn from the top-left and clipped (no scaling). Format: PNG, greyscale
8-bit or 4-bit/8-bit palette, no alpha, ≤ the logical screen size, ≤ 256 kB. At most **2** images per
screen.

**`button`** — `label` (template; centred; wraps to `lines`, default 2), `sub` (template; small line at
the bottom), `icon` (name; drawn above the label), `size` (label size, default `md` bold), `fill`,
`stroke`, `stroke_w`, `radius` (as `rect`; defaults `15 / 0 / 2 / 8`), `color` (text and icon; default
auto-contrast: 15 when `fill` < 8, else 0).

**`grid`** — `cols`, `rows`, `cell_w`, `cell_h`, `gap` (all required), `children` (Widget[]; any type
except `grid`). Each child has `cell` (int, row-major) or `[col, row]`; its `x, y, w, h` are relative to
the cell and default to `0, 0, cell_w, cell_h`. A grid draws nothing itself.

### 6.3 Data sources

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id | yes | Template root. Reserved: `settings`, `vars`, `device` |
| `url` | template URL | yes | |
| `method` | `GET` \| `POST` | no | Default `GET` |
| `headers` | map string → template | no | |
| `body` | object or string | no | Object: JSON with templates in string values. String: sent as-is |
| `body_raw` | bool | no | Do not template `body` (e.g. when the body is a Home Assistant Jinja template) |
| `ttl` | int seconds | no | Re-fetch with `If-None-Match` after N s; `0` = only with the screen. Default = screen `ttl`, minimum 10 |
| `required` | bool | no | If true and the first fetch fails, show the error screen instead of rendering with empty values |

Responses must be JSON (object or array), ≤ **16 kB**, parsed regardless of `Content-Type`. Non-JSON or
oversize responses make the source empty. After a data response the device re-renders bindings; if
nothing changed nothing is drawn.

### 6.4 Text wrapping

The device and the SDK wrap identically so servers can paginate. The greedy algorithm: split the text
at `\n` into paragraphs; within a paragraph, take words separated by single spaces and add words while
the rendered width (sum of glyph advances, no kerning) fits `w`; a word wider than `w` is broken at the
last fitting character; a line count over `lines` truncates and the last line gets `…` fitted within
`w`. Glyph advances per size and weight are published in `spec/fonts.json` per device profile and
pinned by `spec/conformance/wrap.json`.

## 7. Actions

```json
{ "type": "navigate", "url": "/screens/detail.json", "replace": false }
{ "type": "submit",   "event": "next", "args": { "seed": 5 } }
{ "type": "http",     "method": "POST", "url": "…", "headers": {}, "body": {}, "set": {}, "then": "refresh", "after": 1 }
{ "type": "set",      "vars": { "page": "2" } }
{ "type": "refresh" }
{ "type": "back" }
{ "type": "home" }
```

| Type | Fields | Behaviour |
|---|---|---|
| `navigate` | `url` (required), `replace` (default false) | GET the screen, render, push onto history (depth 8). `replace` swaps the top entry |
| `submit` | `event` (required), `args` (map of scalars/templates) | POST the event body (§8.3) to the manifest `event` URL; `200` with a screen replaces the current one (no history push); `204` does nothing |
| `http` | `method` (GET/POST/PUT/DELETE, default GET), `url` (required), `headers`, `body` (object → JSON, string as-is), `body_raw`, `set`, `then`, `after` | Perform the request from the device. Status ≥ 400 or a network error is a failure: a transient alert is shown and the screen is unchanged |
| `set` | `vars` (map) | Local only: assign vars and re-render |
| `refresh` | — | Re-fetch all data sources ignoring `ttl`, re-fetch the screen with `If-None-Match`, re-initialise `vars`, re-render |
| `back` | — | Pop history; at the root behaves like `home` |
| `home` | — | Clear history and load `entry` |

Optional fields on `http`, `submit` and `set`:

- `set` (map var → value/template/conditional): applied **immediately, before the request**
  (optimistic update).
- `then`: `none` (default) \| `refresh` \| `back` \| `home` \| `navigate` (with `then_url`; on `http`
  the `url` field is the request URL). Runs when the request completes.
- `after`: seconds to wait before `then` (default 0). `1` is a good value after commands that take a
  moment to be reflected by the data source.

Tap feedback: with `feedback: invert` the widget rectangle is inverted within about 150 ms of the tap
and stays inverted until the next render of the screen.

## 8. Protocol

### 8.1 Responses and caching

- Screens and data: `200` with `Content-Type: application/json` and a strong `ETag`. `304` means nothing
  changed and timers re-arm. `Cache-Control` is ignored by the device; `ttl` in the document is
  authoritative. Servers producing per-device content should send `Cache-Control: no-store`.
- Images: `200 image/png` with an `ETag`, or `304`.
- Chunked transfer encoding is fine. Compression is not (`Accept-Encoding: identity`).
- Redirects are not followed.

### 8.2 Errors

Any status ≥ 400 is an error. The body may be:

```json
{ "spec_version": 1, "error": { "code": "settings_missing", "message": "Add your HA token in Settings" } }
```

`message` (≤ 120 chars) is shown on the built-in error screen; without a body the device shows
`App error <status>`. A failure during a periodic refresh never replaces the current screen: the device
shows a small alert glyph and retries with backoff (10 s, 30 s, 60 s, then `ttl`). A failure on open or
`navigate` shows the error screen with Retry and Home buttons.

### 8.3 `submit` event body

```json
{
  "spec_version": 1,
  "event": "next",
  "screen": "home",
  "widget": "btn_next",
  "args": { "seed": "5" },
  "vars": { "page": "2" },
  "x": 300, "y": 812,
  "ts": 1758441600
}
```

`widget` is the tapped widget's `id`, or `#<index>` when it has none. Settings are never included in
event bodies; non-secret settings arrive in the `X-App-Settings` header.

### 8.4 Network policy (enforced by the device)

At install and whenever settings change the device computes:

```
allowed = { origin(manifest_url) }
        ∪ { literal origins in manifest.hosts }
        ∪ { origin(settings[k]) for each "{{settings.k}}" in manifest.hosts where k is a url setting }
```

For every request an app makes (screen, data, image, `http`, `submit`):

1. If the URL template starts with `{{settings.<k>}}` and `k` is a `url` setting, the origin is
   `origin(value)`; otherwise the literal origin is parsed from the template. Any other template in the
   origin position is an error.
2. An origin outside `allowed` is refused: the data source is empty, the action fails, the image is
   blank. The refusal is logged.
3. Remaining templates in path, query, headers and body are substituted. **`secret` settings resolve
   only for requests to origins in `allowed` other than the app's own origin**, unless the app origin
   is also listed literally in `hosts` (the settings page then warns "this app sends your secrets to
   `<origin>`" before install). A secret referenced elsewhere fails the request.
4. `http://` is permitted only to private-network hosts.

### 8.5 Compatibility

- `spec_version` is required in index, manifest and screen documents. A missing value is treated as `1`
  and logged. A document with a `spec_version` newer than the device supports shows the "Update
  QuireOS" screen.
- Unknown fields are ignored. Unknown widget types are skipped and logged. Unknown action types and
  filters are no-ops / empty strings and logged. A widget missing a required field is skipped.
- Limits exceeded (document > 32 kB, > 96 widgets, > 8 data sources, > 2 images) reject the document.
- `min_os` in the manifest is the mechanism for apps that need a newer widget or feature.

## 9. Store service API

The reference store is a multi-tenant service. Developers sign in with GitHub, create apps, host static
bundles or point at their own servers, and choose a visibility. Devices register anonymously and can be
paired to an account to see that account's private apps.

Base path `/api/v1`. Devices send `Authorization: Bearer <device token>` once registered.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /devices` `{hw_id, os_version, screen}` | none | Register; returns `{device_id, token}`. Re-registering the same `hw_id` keeps the `device_id`, issues a **new** token, invalidates the old one and **drops any account pairing** (the hardware id is not a secret: every app server sees it as `X-Device-Id`). `screen` is the `WxH` part of `X-Screen` |
| `POST /pair` | device | Returns `{code, expires_in, url}`; the device shows the code and `url` (the store's pairing page). Codes are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, valid for 10 minutes, matched case-insensitively |
| `GET /pair/:code` | device | `202 {"status":"pending"}` while unclaimed; `200 {"status":"paired","user":{"login","name"}}` once a signed-in user claimed it on the website; `410` when expired; `404` when the code belongs to another device |
| `GET /index` | optional device | The §4 document: public apps, plus the paired user's `unlisted` and `private` apps. Strong ETag |
| `GET /apps/:slug` | optional device | Index entry plus `description` (string), `screenshots` (URL[]), `changelog` (`[{version, published_at, notes}]`, newest first) and `versions` (`[{version, min_os, manifest, published_at}]`, newest first). `404` for private apps the caller cannot see; `unlisted` apps are readable by anyone who knows the slug |
| `POST /installs` `{app, version, action: install\|uninstall\|update}` | device | `204`. `installs` in the index counts devices whose latest report for the app is not `uninstall` |

**Hosted bundles.** A bundle is a zip with `manifest.json` at its root plus its screens, images, an
optional 96×96 `icon.png` and an optional `store.json`; ≤ 5 MB, validated with the same rules as
`tools/validate` before it is accepted. Inside a bundle, `entry` must be origin-relative and its
directory is the bundle's **mount** (`/home.json` → mount is the bundle root, so the entry file sits
at the root); every other origin-relative URL in the bundle must resolve under that mount to a file in
the bundle. When the store publishes a version it rewrites those URLs to the version's prefix and
serves the files immutably at `/a/:slug/:version/<file>` (`Cache-Control: public, max-age=31536000,
immutable`); the index then points at `/a/:slug/:version/manifest.json`. Absolute URLs, templates and
`hosts` are left untouched. Files of `private` apps require the device token of a device paired to
the owner; `unlisted` and `public` files are open.

`store.json` (optional, bundle root) carries listing metadata the manifest does not: `tagline`,
`description`, `categories`, `screenshots` (absolute URLs), `changelog` (`[{version, notes}]`).
Publishing merges it into the listing.

**External apps** are listed by manifest URL. At publish time the store fetches the manifest (no
redirects), requires `200` with an `ETag`, validates it, and snapshots it; the manifest `id` must equal
the slug and `version` must be greater than the last published version. Versions are immutable.

Visibility: `private` (owner's paired devices only), `unlisted` (installable by URL or slug, not
listed), `public` (listed and browsable).

## 10. Device profiles

A device profile describes what a board can display. The reference profile `t5pro`:

| Property | Value |
|---|---|
| Native panel | 960 × 540, 16 greys, 235 dpi |
| Default orientation | portrait, logical 540 × 960 |
| Partial updates | yes |
| Text sizes (line height px) | `xs` 24 · `sm` 29 · `md` 36 · `lg` 44 · `xl` 56 · `2xl` 72 · `3xl` 96 · `digits` 150 |
| Icon sizes (px) | `sm` 24 · `md` 36 · `lg` 64 |
| Chrome (px) | `margin` 24 · `nav` 56 · `toolbar` 56 · `status` 44 · `corner` 48 |
| Touch | 5-point capacitive |
| Buttons | one app-assignable function button (§6 `keys`); long press is always Home |

Icons compiled into a device come from the design library's tiers (`design/icons/icons.json`): the
`core` tier at `sm` and `md`, the `display` subset also at `lg`. `spec/icons.json` lists what a
firmware build actually contains.

Profiles, including per-glyph advances for every size and weight, are published in `spec/fonts.json`
and `spec/icons.json`. Apps that hard-code coordinates should declare `screens` in their manifest and
read `X-Screen`; the SDK's layout helpers take a profile as input.

## 11. Changes

`spec_version` bumps only on breaking changes to document semantics. Additive widgets and fields ship
under the same `spec_version`, guarded by `min_os`.
