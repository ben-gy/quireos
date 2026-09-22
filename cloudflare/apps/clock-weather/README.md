# Clock & Weather (QuireOS app)

A big clock over the current conditions and a three-day outlook. The clock is a
`{{device.time | time:'HH:mm'}}` template, so the device redraws it every minute without any
network traffic; the weather comes from [Open-Meteo](https://open-meteo.com) through a
Cloudflare Worker that caches each place for ten minutes and is baked into the screen, which the
device re-fetches every ten minutes (`ttl: 600`, `304` when nothing changed).

```
src/manifest.ts   settings: place (string), lat / lon (number), units (metric | imperial)
src/weather.ts    Open-Meteo client + cache, WMO code → icon/description, weekday names
src/screens.ts    homeScreen(): clock, current conditions, 3-day grid, Refresh button
src/index.ts      createApp wiring; reads the place from X-App-Settings
test/             vitest: validates portrait/landscape/imperial/unavailable screens, cache and 304
```

## Settings

| Key | Type | Default |
|---|---|---|
| `place` | string | `Sydney` |
| `lat` | number | `-33.87` |
| `lon` | number | `151.21` |
| `units` | select | `metric` (°C, km/h) or `imperial` (°F, mph) |

Coordinates are rounded to two decimals for the cache key, so neighbours share a forecast.

## Screen

Portrait (540×960): place name (`lg` bold), date line (`{{device.time | time:'EEEE d MMMM'}}`),
the time in the `digits` face, a rule, then the current conditions (icon at `lg`, temperature at
`2xl`, description, high/low/feels-like, wind/humidity), a 3-column grid for the next three days
(weekday, icon at `md`, high/low) and a Refresh button (`refresh` action, also bound to the
device's function button). Landscape (960×540) puts the clock on the left and the weather on the
right.

Weather icons are mapped from WMO codes (`condition()` in `src/weather.ts`). The large glyph
only uses the seven names the design library ships at `lg` (sunny, night, partly-cloudy, cloudy,
rainy, snowy, lightning); fog, pouring rain, hail and the rest fall back to the nearest of those
at `lg` while the forecast row uses the precise icon at `md`.

If Open-Meteo is down the screen still shows the clock with a "Weather unavailable" panel (and a
stale copy from memory when the isolate has one).

## Run it

```sh
cd cloudflare
npm install
npm run dev -w apps/clock-weather     # http://localhost:8787/manifest.json
npm test -w apps/clock-weather
```

Deploy with `npm run deploy -w apps/clock-weather`. No Cloudflare resources or secrets are
needed; Open-Meteo needs no API key.
