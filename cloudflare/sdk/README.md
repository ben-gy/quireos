# @quireos/sdk

TypeScript SDK for writing QuireOS apps and tooling. Implements `spec/SPEC.md` (spec_version 1):

| Module | What it gives you |
|---|---|
| `types` | Exact types for the index, manifest, settings, screens, every widget, actions, events, errors, device headers and font profiles |
| `screen`, `actions` | Thin builders: `screen() text() rect() line() icon() image() button() grid() cell()` and `navigate() submit() http() set() refresh() back() home()`, plus `bind("e0.state", f.upper)` → `"{{e0.state | upper}}"` and `cond(test, then, else)` |
| `expr` | The reference §3 evaluator: `evaluate(template, ctx)`, `evaluateCond(cond, ctx)`, `resolveValue(value, ctx)`, `resolveDeep`, `tokenize`, `parseTime`/`formatTime` |
| `wrap` | §6.4 `measure(text, size, weight, profile)` and `wrap(text, { w, lines, size, weight, profile })`, byte-identical to the device |
| `profiles` | `t5pro` and `loadProfile(json, name)`; `npm run sync-profiles` refreshes the bundled copy from `spec/fonts.json` |
| `validate` | `validateIndex`, `validateManifest`, `validateScreen`, `validateBundle` (+ `rebaseBundle`, `LIMITS`, the id/version regexes). Every limit in the spec is enforced |
| `request` | `parseDevice(req)` → `DeviceContext` from the §2 headers (`X-Screen`, `X-App-Settings`, …) |
| `response` | `json(doc, req)` (canonical JSON, strong ETag, `304`), `png(bytes, req, seed)`, `error(code, message, status)`, `AppError` |
| `app` | `createApp({ manifest, screens, onEvent, images })` → a Workers `fetch` handler with `/manifest.json`, `/screens/:id.json`, `/event`, `/img/:name.png` |
| `png` (`@quireos/sdk/png`) | `quantize16` (Floyd–Steinberg to 16 greys), `encodePng4` (4-bit palette PNG, no dependencies), `renderPng` (satori + resvg) |
| `zip` | `readZip` / `writeZip` for bundles |

The core entry (`@quireos/sdk`) has no runtime dependencies; `encodePng4`/`quantize16` are
exported from it too. Only `@quireos/sdk/png` pulls in `satori` and `@resvg/resvg-wasm`.

## Use

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

`apps/_template` is a complete Worker; `apps/hello` is a static bundle.

Every widget takes `when` (falsy: not drawn) and `disabled` (truthy: drawn dimmed, not
hit-tested, `feedback` ignored); both are §3 condition strings. A screen may bind the hardware
key with `keys: { short?: Action, double?: Action }`; long press is always Home and cannot be
bound. Among the `device.*` template variables, `device.rssi` is the Wi-Fi signal in dBm and is
`-100` when the device is offline. `scaleProfile(t5pro, 1.25)` derives a profile with all text
metrics scaled, for layouts designed at a different line height.

Server-side pagination uses the same wrap as the device:

```ts
import { wrap, t5pro } from "@quireos/sdk";
const lines = wrap(story, { w: 492, lines: 8, size: "md", weight: "regular", profile: t5pro });
```

Validation (the store runs exactly these on upload):

```ts
const { ok, errors } = validateScreen(doc, { manifest, origin: "https://my-app.workers.dev" });
// errors: [{ path: "/widgets/3/text", message: "unknown setting 'nmae'" }]
```

## Rendering PNGs on Workers (read this before using `renderPng`)

`renderPng(node, { w, h, fonts, dither, gamma })` runs satori (JSX-like tree → SVG) then resvg
(SVG → RGBA), quantises to 16 greys and encodes a 4-bit palette PNG. The pitfalls:

1. **Pin the versions.** `satori@0.32.0` and `@resvg/resvg-wasm@2.6.2`. satori ≥ 0.33 depends on
   `harfbuzzjs`, whose Emscripten loader fetches `hb.wasm` at runtime and cannot run on Workers
   (runtime WASM compilation is disallowed). This package declares both as optional peers at those
   exact versions.
2. **Import the WASM as modules and initialise once at module scope.** Workers only allow WASM
   that is bundled as a module:
   ```ts
   import yoga from "satori/yoga.wasm";
   import resvg from "@resvg/resvg-wasm/index_bg.wasm";
   import { initRenderer, renderPng, h } from "@quireos/sdk/png";
   const ready = initRenderer({ yoga, resvg }); // top of the module, not per request
   ```
   `initRenderer` is idempotent; `renderPng` throws if it has not completed. In Node (tests)
   pass the file bytes instead.
3. **Fonts are assets.** satori needs TTF/OTF bytes: import `Roboto-Regular.ttf` with a wrangler
   `rules: [{ type: "Data", globs: ["**/*.ttf"] }]` entry and pass
   `fonts: [{ name: "Roboto", data, weight: 400, style: "normal" }]`. No system fonts exist.
4. **Images must be inlined as `data:` URLs.** satori fetches `<img src>`; on Workers that means
   a subrequest per render and no caching. Fetch once, base64, inline.
5. **CPU time.** A 540×960 render costs 100–400 ms of CPU; the Free plan's 10 ms limit will not
   do. Use Workers Paid (30 s), cache by ETag (`png(bytes, req, seed)` lets you answer `304`
   from the seed before rendering) and keep `ttl` on `image` widgets generous.
6. **No emoji, no CJK** unless you ship those fonts; satori's `loadAdditionalAsset` can fetch
   them but that is another subrequest per glyph run.
7. **Output is `w × h`.** resvg renders at the SVG size; the result is clipped or padded onto
   white if it differs. The device does not scale images, so size the node to the widget.
8. `dither: "fs"` (default) is right for photos and gradients; use `dither: "none"` for text
   and line art so edges stay crisp. `gamma: 1.2` lightens mid-greys on e-paper.

## Scripts

```sh
npm test                 # vitest: conformance fixtures, validators, ETags, routing, PNG round-trip
npm run typecheck        # tsc --noEmit over src, test and scripts
npm run build            # sync profiles + tsc → dist (also runs on npm install via prepare)
npm run sync-profiles    # regenerate src/profiles/fonts.generated.ts from spec/fonts.json
```

Conformance fixtures live in `spec/conformance/` (`expr.json`, `screens/`) and the JSON schemas
in `spec/schema/`; `test/schema.test.ts` checks that the schemas and `validateScreen` agree.
