# QuireOS app template (Worker)

The smallest useful QuireOS app: a Cloudflare Worker that serves a manifest, two screens and an
event handler through `createApp` from `@quireos/sdk`.

```
src/manifest.ts   §5 manifest (id, name, version, settings, hosts)
src/index.ts      screens and the event handler
wrangler.jsonc    Worker config; DEV=1 turns on per-request screen validation
```

## Run it

```sh
cd cloudflare
npm install                      # builds @quireos/sdk too
npm run dev -w apps/_template    # http://localhost:8787/manifest.json
```

Point a device at `http://<mac-ip>:8787/manifest.json`, or add the app to a dev store index
(`npm run devstore -- ./apps` serves static apps; for a Worker, install by manifest URL).

Deploy with `npm run deploy -w apps/_template` (rename `name` in `wrangler.jsonc` first). The
manifest `entry`/`event` are origin-relative, so the app works on any hostname.

## Make it yours

1. Change `id` (store slug), `name`, `version`, `icon` and `settings` in `src/manifest.ts`.
2. Add screens as keys of `screens`; each handler receives `{ device, request, env, manifest }`
   and the request URL and returns a `Screen`. Use the builders (`screen`, `text`, `button`,
   `grid`, `navigate`, `submit`, `bind`, `cond`) or plain object literals.
3. Handle `submit` actions in `onEvent`: return a screen (`200`), `null` (`204`) or a `Response`.
4. For dynamic images add `images: { chart: (ctx) => bytes }` and import from
   `@quireos/sdk/png` (see the SDK README for the satori/resvg setup on Workers).

Validate screens without a device: `npm run validate -- apps/_template` only works for static
files; for a Worker run it in dev (`DEV=1`) and every screen is validated on each request, or
write a vitest that calls `validateScreen(await app.fetch(...).json())`.
