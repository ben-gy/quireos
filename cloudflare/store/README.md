# QuireOS store service

The reference QuireOS app store: a Cloudflare Worker (Hono, server-rendered JSX) backed by **D1**
(accounts, listings, devices, pairings) and **R2** (hosted bundles, icons). Developers sign in with
GitHub, create apps, upload static bundles or list an externally hosted app, and choose a visibility.
Devices register anonymously, browse the index, and can be paired to an account with a short code to
see that account's private apps. The contract is `spec/SPEC.md` §4 (index), §5 (manifest) and §9 (API).

```
src/index.ts        Worker entry; mounts the three routers below
src/api.ts          /api/v1/*  device API (register, pair, index, app detail, installs)
src/bundles.ts      /a/:slug/:version/*  immutable bundle files; /icons/*; zip → R2 publishing
src/web.tsx         developer UI routes (browse, app pages, dashboard, edit/publish, devices, pair, admin)
src/pages/*.tsx     JSX pages (no client-side JS)
src/auth.ts         cookie sessions in D1, GitHub OAuth, CSRF tokens
src/device_auth.ts  bearer device tokens (SHA-256 hashed in D1)
src/db.ts           typed D1 queries
src/index_doc.ts    builds the §4 index document, visibility rules
src/validate.ts     single import point for validation and bundle helpers (re-exports @quireos/sdk)
src/icons.ts        icon names from spec/icons.json, passed to the SDK validators
migrations/         D1 migrations (wrangler d1 migrations …)
public/style.css    the only static asset
test/               vitest suites with a node:sqlite-backed fake D1 and an in-memory R2
```

## Local development

Prerequisites: Node 22+, and `npm install` run once in `cloudflare/` (the workspace root).

1. **Create a GitHub OAuth app** for development at <https://github.com/settings/developers> →
   *New OAuth App*:
   - Homepage URL: `http://localhost:8787`
   - Authorization callback URL: `http://localhost:8787/auth/github/callback`

   Copy the client id and generate a client secret.

2. **Secrets.** Copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in:

   ```
   GITHUB_CLIENT_ID=…
   GITHUB_CLIENT_SECRET=…
   SESSION_SECRET=$(openssl rand -base64 32)
   ```

3. **Database.** Apply the migrations to the local D1 (stored under `.wrangler/state/`):

   ```sh
   npm run migrate:local          # = wrangler d1 migrations apply quireos-store --local
   ```

4. **Run.**

   ```sh
   npm run dev                    # = wrangler dev → http://localhost:8787
   ```

   `/` is the public browse page, `/login` starts GitHub sign-in, `/api/v1/index` is the index the
   devices read. Local R2 and D1 are file-backed and survive restarts.

5. **Pretend to be a device** (from another terminal):

   ```sh
   curl -s -H 'Content-Type: application/json' \
     -d '{"hw_id":"a1b2c3d4e5f6","os_version":"0.1.0","screen":"540x960x16@235"}' \
     http://localhost:8787/api/v1/devices
   # → {"device_id":"…","token":"…"}
   curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/v1/pair
   # → {"code":"ABC234","expires_in":600,"url":"http://localhost:8787/pair"}
   #   enter the code at http://localhost:8787/pair while signed in, then:
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/v1/pair/ABC234
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/v1/index
   ```

   To point a real device at this store, run `wrangler dev --ip 0.0.0.0` and set the store URL on the
   device's LAN page to `http://<your-mac-ip>:8787`.

### Tests and typecheck

```sh
npm test          # vitest: index shape + ETag/304, pairing state machine, visibility, publish validation
npm run typecheck
```

The tests run the real Hono app against a fake D1 (Node's built-in `node:sqlite`, same migration
file) and an in-memory R2, so no Cloudflare emulator is needed.

## Deploy

```sh
# once
wrangler d1 create quireos-store          # paste the printed database_id into wrangler.jsonc
wrangler r2 bucket create quireos-bundles
wrangler secret put GITHUB_CLIENT_ID      # from a *production* GitHub OAuth app whose callback is
wrangler secret put GITHUB_CLIENT_SECRET  #   https://<your-worker-host>/auth/github/callback
wrangler secret put SESSION_SECRET        # openssl rand -base64 32

# every release
npm run migrate:remote                    # = wrangler d1 migrations apply quireos-store --remote
wrangler deploy
```

The Worker host is `quireos-store.<account>.workers.dev` until a custom domain is attached; when the
host changes, only the GitHub OAuth app's callback URL needs updating (and `PUBLIC_URL` in
`wrangler.jsonc` if you want absolute URLs to use a domain other than the one requests arrive on).
GitHub allows one callback per OAuth app, so use one app for development and one for production.

### Making a user an admin

Admins can unlist/relist any app and see reports at `/admin`. Sign in once so the user row exists,
then:

```sh
wrangler d1 execute quireos-store --remote --command \
  "UPDATE users SET is_admin = 1 WHERE login = 'ben-gy'"
# locally: add --local instead of --remote
```

## Routes

Device API (`/api/v1`, JSON; `Authorization: Bearer <device token>` where noted):

| Method and path | Auth | Returns |
|---|---|---|
| `POST /devices` `{hw_id, os_version, screen}` | none | `{device_id, token}`; re-registering rotates the token and clears the pairing |
| `POST /pair` | device | `{code, expires_in, url}`; 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 10 min |
| `GET /pair/:code` | device | `202 {status:"pending"}` · `200 {status:"paired", user:{login,name}}` · `410` expired |
| `GET /index` | optional | spec §4 document; strong ETag, `Cache-Control: max-age=300`, CORS `*`, `304` on `If-None-Match` |
| `GET /apps/:slug` | optional | index entry + `description`, `screenshots[]`, `changelog[]`, `versions[]`; `404` when not visible |
| `POST /installs` `{app, version, action}` | device | `204` |

Files: `GET /a/:slug/:version/<path>` (hosted bundle files, immutable, ETag, CORS `*`; private apps
require a paired device token of the owner) · `GET /icons/:slug/<hash>.png`.

Web: `/` · `/apps/:slug` · `/login` · `/auth/github/callback` · `/logout` · `/dashboard` ·
`/apps/new` · `/apps/:slug/edit` (details, icon, publish, versions, delete) · `/devices` · `/pair` ·
`/admin`. All state-changing forms carry a CSRF token; session cookies are HttpOnly, SameSite=Lax and
Secure on https.

## Publishing

- **Hosted app**: upload a zip (≤ 5 MB) with `manifest.json` at the root plus screens, images and a
  96×96 `icon.png`. The store validates it (`validateBundle` from the SDK), requires `manifest.id` to
  equal the slug and `manifest.version` to be greater than every published version, writes the files
  to R2 under `bundles/<slug>/<version>/` and serves them at `/a/<slug>/<version>/…`.
  Bundles follow the SDK's mount rule: the directory of `entry` is the mount (`/home.json` → the
  bundle root is the origin root; `/hello/home.json` → the bundle root is `/hello/`), the entry file
  sits at the bundle root, and every origin-relative URL must resolve to a file under that mount.
  At publish time the store rebases those URLs to `/a/<slug>/<version>/…` (`rebaseBundle`);
  absolute URLs, `{{settings.…}}` templates and `hosts` are untouched. An optional `store.json`
  (`tagline`, `description`, `categories`, `screenshots`, `changelog[{version, notes}]`) is merged
  into the listing. Versions are immutable.
- **External app**: set the manifest URL; publishing fetches it (no redirects, must send an `ETag`),
  validates it and snapshots it as a version. Devices fetch the manifest from your server.
- Visibility: `private` (owner's paired devices only), `unlisted` (installable by URL/slug, not
  listed), `public` (listed). New apps start private. Quotas: 20 apps per user, bundles ≤ 5 MB, icon
  PNG ≤ 200 kB.

## SDK dependency

`src/validate.ts` is the only place that imports validation and bundle helpers, and it simply
re-exports `@quireos/sdk` (`validateBundle`, `validateManifest`, `validateIndex`, `bundleMount`,
`rebaseBundle`, types `Manifest`, `StoreApp`, `StoreIndex`, `StoreMeta`). Uploads are checked with
exactly the rules `tools/validate` applies, including icon names from `spec/icons.json`
(`src/icons.ts`), declared `hosts`/`settings` for every origin and template a screen uses, and the
bundle mount rule. The SDK is a workspace package: after changing `cloudflare/sdk`, run its build
(`npm run build -w sdk`) so `dist/` is current before running the store's tests.
