# Frame (QuireOS app)

Turns the device into a picture frame. The screen is one full-bleed `image` widget
(`refresh: "full"`) and two invisible tap zones; the Worker renders the PNG with `renderPng`
from `@quireos/sdk/png` (satori → resvg → 16-grey 4-bit PNG) and caches each card in the Cache
API.

- **Quote mode** (default): one of twenty public-domain quotes typeset in Roboto (regular and
  bold from `firmware/fonts/`), `dither: "none"` so the type stays crisp.
- **Image mode**: fetches `image_url` (PNG, JPEG or GIF, ≤ 6 MB), crops it to the screen
  (`object-fit: cover`), quantises with Floyd–Steinberg (`dither: "fs"`) and `gamma: 0.85`. When
  the image cannot be fetched the card says why instead of leaving the screen blank.

The card is chosen by a **seed**: the screen's `vars.seed` starts at the current hour, so the
frame turns over on its own when the device re-fetches the screen (`ttl: 3600`); the right half
of the screen submits `next` and the left half `prev` (`submit` with `args.seed`), and the Worker
answers with the same screen for seed ± 1. The device's function button does the same (short =
next, double = prev).

```
src/manifest.ts   settings: mode (quote | image), image_url (url, optional)
src/screens.ts    homeScreen(): image + tap zones; hourlySeed(); parseMode()
src/render.ts     makeRenderer({ yoga, resvg, fonts }) → card(): satori nodes for both modes
src/app.ts        createFrameApp(renderer): routes, per-seed ETag (304 before rendering) and Cache API
src/index.ts      Workers entry: imports the WASM modules and TTFs, initialises the renderer once
test/             vitest: validates screens, steps seeds, renders real PNGs in Node (skipped without fonts)
```

Routes: `GET /manifest.json`, `GET /screens/home.json`, `POST /event`,
`GET /img/card.png?seed=N&mode=quote|image[&u=<image url>]`. The image request carries
`X-Screen`, so the card is rendered at the device's logical size (540×960 or 960×540). Its ETag
is derived from `size/mode/seed/url`, so a device that already holds the card gets `304` without
any rendering; a cache hit is served without rendering too.

## Run it

```sh
cd cloudflare
npm install                       # satori 0.32.0 and @resvg/resvg-wasm 2.6.2 are pinned (see the SDK README)
npm run dev -w apps/frame         # http://localhost:8787/screens/home.json, /img/card.png?seed=1
npm test -w apps/frame
```

Try a card in the browser: `http://localhost:8787/img/card.png?seed=3&mode=quote`.

## Deploy

`npm run deploy -w apps/frame`. **Rendering needs Workers Paid**: a 540×960 card costs 100–400 ms
of CPU, well past the Free plan's 10 ms limit (`wrangler.jsonc` sets `limits.cpu_ms` accordingly).
Cards are cached per seed for a day (an hour in image mode), so a frame that turns over hourly
renders once per hour per size. No secrets or other Cloudflare resources are needed.

The fonts are imported straight from `firmware/fonts/*.ttf` with a wrangler `Data` rule, and the
two WASM modules as `CompiledWasm` (wrangler's default for `.wasm`), initialised once at module
scope as the SDK README requires.
