# HA Lights (QuireOS app)

Up to eight Home Assistant switches or lights as tap-to-toggle tiles. The Worker only builds
the screen document; the **device** reads each entity's state from Home Assistant on your LAN
and posts the toggle, using the long-lived token stored on the device. The token never reaches
the Worker (secrets are not in `X-App-Settings`) and, by the device's network policy, is only
sent to the `ha_url` origin.

```
src/manifest.ts   the §5 example manifest (ha_url, ha_token, entities) + single_request
src/screens.ts    homeScreen(): data sources, vars, 2×4 tile grid, All off; setupScreen()
src/index.ts      createApp wiring; entities come from X-App-Settings
test/             vitest: validates every variant (setup, 7 and 8 entities, landscape, single request)
```

## Settings

| Key | Type | Notes |
|---|---|---|
| `ha_url` | url | Default `http://homeassistant.local:8123`. Plain `http://` is fine because `.local`/RFC 1918 hosts are private |
| `ha_token` | secret | HA → Profile → Security → Long-lived access tokens |
| `entities` | list (≤ 8) | `id` (`switch.…` or `light.…`) and `label` per row |
| `single_request` | bool | Read every state with one `POST /api/template` instead of one `GET /api/states/<id>` each |

Example entity list (the README of the pool house this was built for):

| Entity id | Label |
|---|---|
| `switch.shelly1minig3_48f6ee868fc4` | Pool Lights |
| `switch.shelly1minig3_48f6ee86ada8` | Hallway Main |
| `switch.shelly1minig3_48f6ee8776a8` | Hallway Entrance |
| `switch.shelly1minig3_48f6ee87d198` | Office |
| `switch.shelly1minig3_48f6ee880e10` | Chandelier |
| `switch.shelly1minig3_48f6ee8e99fc` | Verandah Front |
| `switch.garage_outside` | Garage Outside |

## How the screen works

- One data source per entity: `GET {{settings.ha_url}}/api/states/<id>` with
  `Authorization: Bearer {{settings.ha_token}}`, `ttl: 30`; `vars.eN = {{eN.state}}`.
- Each tile is a `button` whose `fill` is `{ if: "vars.eN == on", then: 0, else: 15 }` and whose
  `sub` reads ON / OFF (or `?` when the state is unknown). Tapping posts
  `{{settings.ha_url}}/api/services/<domain>/toggle` with `{ "entity_id": … }`, flips the var
  immediately (`set`, optimistic) and re-fetches after 1 s (`then: refresh`, `after: 1`).
- **All off** posts `homeassistant/turn_off` with every id (works for switches and lights alike).
  It is the eighth tile, or a full-width button under the grid when all eight cells are used.
- `single_request`: one `POST {{settings.ha_url}}/api/template` with `body_raw: true` and a
  Jinja template that renders `{"e0":"on","e1":"off",…}`; HA answers `text/plain`, which the
  device still parses as JSON; `vars.eN = {{st.eN}}`.
- Without entities in `X-App-Settings` the Worker returns a screen that explains how to fill the
  settings on the device's LAN page, with a Reload button.
- The screen is portrait 540×960 (2×4 grid); a 960×540 `X-Screen` gets a 4×2 grid.

## Run it

```sh
cd cloudflare
npm install
npm run dev -w apps/ha-lights     # http://localhost:8787/manifest.json
npm test -w apps/ha-lights
```

Try it in a browser with the header the device would send:

```sh
curl -H "X-App-Settings: $(node -p 'encodeURIComponent(JSON.stringify({entities:[{id:"switch.garage_outside",label:"Garage"}]}))')" \
  http://localhost:8787/screens/home.json
```

Deploy with `npm run deploy -w apps/ha-lights`. No Cloudflare resources or secrets are needed.
