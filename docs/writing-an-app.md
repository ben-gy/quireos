# Writing a QuireOS app

A QuireOS app is a web service (or a folder of static files) that returns **screen documents**: JSON
that says what to draw and what taps do. The device renders it with its own fonts and icons and
handles taps locally. Apps never run code on the device. The full contract is `spec/SPEC.md`; this
page is the practical path.

## Two kinds of app

| | Static bundle | Worker (or any HTTPS server) |
|---|---|---|
| What it is | `manifest.json` + screen JSON files + images, zipped | A service that builds screens per request |
| Good for | Fixed layouts, menus, information that rarely changes | Anything with live data, per-user state, images rendered on demand |
| Hosting | Upload to the store; it serves the files | You run it (Cloudflare Workers is the reference); the store lists the manifest URL |
| Example | `cloudflare/apps/hello` | `cloudflare/apps/_template`, `hn`, `ha-lights`, `clock-weather`, `frame` |

Both produce the same documents. Templates such as `{{settings.name}}` and `{{device.time}}` are
substituted **on the device**, so a screen can be the same bytes for every user and still show their
data. Data sources (`data: [...]`) let the device fetch small JSON documents itself, for example from
Home Assistant on the LAN, with secrets that never leave the device.

## 1. Start from the template

```bash
cd cloudflare && npm install
cp -r apps/_template apps/myapp
```

Edit `apps/myapp/src/manifest.ts` (set `id`, `name`, `icon`, `settings`) and `wrangler.jsonc`
(`name`). Screens live in `src/index.ts` as functions of the device context:

```ts
import { createApp, screen, text, button, navigate, bind, f } from "@quireos/sdk";

export default createApp({
  manifest,
  screens: {
    home: (ctx) => screen({
      id: "home",
      widgets: [
        text({ x: 24, y: 24, w: 492, text: `Hello, ${bind("settings.name", f.default("friend"))}`, size: "2xl", weight: "bold" }),
        text({ x: 24, y: 240, w: 492, h: 150, text: bind("device.time", f.time("HH:mm")), size: "digits" }),
        button({ x: 24, y: 600, w: 492, h: 88, label: "About", on_tap: navigate("/screens/about.json") }),
      ],
    }),
  },
});
```

`createApp` gives you `GET /manifest.json`, `GET /screens/<id>.json`, `POST /event` (for `submit`
actions) and `GET /img/<name>.png`, with ETags and `304` handling built in.

## 2. Lay out for the device

The reference device is the LilyGo T5 E-Paper S3 Pro: **540 × 960 portrait**, 16 greys, 235 dpi.
Coordinates are absolute pixels. Read `ctx.device.screen` (`{ w, h, greys, dpi }`) if you want to
adapt to a landscape or a different panel; declare `screens: ["540x960"]` in the manifest if you only
support one size.

Text sizes are tokens (`xs sm md lg xl 2xl 3xl digits`) whose pixel line heights come from the
device profile in `spec/fonts.json`. Use `wrap()` from the SDK when you paginate long text: it is
byte-identical to the device's wrapping, so what you count as a page is what the device draws.

Icons are the names in `spec/icons.json`, which is what a firmware build actually compiles (229 of
the design library's 294 today). `createApp` checks every icon your screens use against that list in
dev, so a name the device cannot draw fails in `wrangler dev` rather than silently drawing nothing
on glass; pass `icons` to `createApp` for a board that compiles a wider set. Colours are `0` (black)
to `15` (white).

E-paper rules of thumb: a full refresh flashes and takes about a second, so change screens rarely;
set `ttl` on screens and data sources so the device polls with `If-None-Match` and only redraws on
`200`; keep taps local where you can (`set` and conditionals) and use `refresh: "partial"` for
screens whose taps change small things.

## 3. Run it locally

```bash
npm run dev -w apps/myapp            # wrangler dev --ip 0.0.0.0 --port 8787
```

Then either:

- **Emulator** (no hardware): `sh firmware/emu/build.sh && ./firmware/emu/build/quireos-emu`, open
  http://127.0.0.1:8087, and install from `http://<your-mac-ip>:8787/manifest.json` on the emulator's
  settings page at http://127.0.0.1:8087/os. See `docs/emulator.md`.
- **Device on the same Wi-Fi**: open the device's LAN settings page (`http://<device-ip>/os`) and use
  *Install from URL* with the same manifest URL.

For static bundles, `npm run devstore -- ./apps` serves a store index built from every
`manifest.json` under `apps/` at `http://<mac-ip>:8788/index.json`; point the device or emulator's
store URL at it.

## 4. Validate

```bash
npm run validate -- apps/myapp       # schemas + every limit in the spec + hosts/secrets rules
```

The store runs exactly the same checks when you publish, so fix everything here first. Add a vitest
that renders your screens with a fake device context and calls `validateScreen` (the example apps
do this).

If your app paginates or links between screens, walk those links too:

```bash
npm run linkcheck -- http://127.0.0.1:8787
```

It follows every `navigate` target from the entry screen and reports any that do not answer 200,
which is how a screen that reports a page count from one place and generates pages from another
gets caught.

## 5. Publish

1. Bump `version` in the manifest (every publish must be greater than the last).
2. Worker apps: `npm run deploy -w apps/myapp`. Static bundles: `npm run bundle` in the app folder
   to get `myapp-<version>.zip`.
3. Sign in to the store with GitHub, create the app (slug = manifest `id`), and either upload the
   zip (hosted) or paste your manifest URL (external). Choose the visibility:
   - **private**: only devices paired to your account see it (pair from the device's Store screen),
   - **unlisted**: anyone with the slug can install it,
   - **public**: listed for everyone.
4. Devices see a new version as an update badge; users choose when to update because a version may
   add required settings.

## 6. Settings and secrets

Declare settings in the manifest (`string secret url number bool select list`). Users fill them on
the device's LAN page; the device stores them. Non-secret values reach your server in the
`X-App-Settings` header. **Secrets never reach your server**: they can only be substituted into
requests the device makes to hosts you declared in `hosts` (for example the user's Home Assistant),
and the store warns users if a manifest declares its own origin as such a host.

## Cheat sheet

- Templates: `{{path | filter}}`; filters `fixed:n default:'x' upper lower time:'HH:mm'`.
- Roots: `settings.*`, `vars.*`, `device.time|tz|battery|charging|rssi|name|online|w|h|greys|dpi`, and
  each data source id.
- Conditions: `vars.state == on`, `e0.temp > 25`, bare `vars.flag`.
- Branching: `{ "if": "vars.on", "then": 0, "else": 15 }` (nest up to 3).
- Actions: `navigate submit http set refresh back home`; `http` and `submit` take `set` (optimistic),
  `then` (`refresh|back|home|navigate` with `then_url`) and `after` (seconds).
- Limits: 32 kB per screen, 96 widgets, 8 data sources of 16 kB, 2 images of 256 kB, 16 vars,
  8 settings.
