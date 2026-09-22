# The deployed QuireOS services

Everything below runs on Ben's Cloudflare account and was deployed from this repo.

| What | URL |
|---|---|
| Store (website, device API, hosted bundles) | https://quireos-store.bens-account-5d3.workers.dev |
| Hacker News | https://quireos-app-hn.bens-account-5d3.workers.dev |
| HA Lights | https://quireos-app-ha-lights.bens-account-5d3.workers.dev |
| Clock & Weather | https://quireos-app-clock-weather.bens-account-5d3.workers.dev |
| Frame | https://quireos-app-frame.bens-account-5d3.workers.dev |

Resources: D1 `quireos-store` (`59068200-c1d9-46f7-a67a-541ae0b2d2e4`), R2 `quireos-bundles`,
KV `HN_KV` (`a41d69ea5f73407585f551ce011191a7`). The firmware's default store URL is
`QUIRE_STORE_URL` in `firmware/src/os/prefs.h`.

## One thing left to do: GitHub sign-in

The store's device API, its public pages and installing apps all work now. Signing in as a
developer does not, because it needs a GitHub OAuth app that only the account owner can create:

1. https://github.com/settings/developers → **New OAuth App**
   - Application name: `QuireOS Store`
   - Homepage URL: `https://quireos-store.bens-account-5d3.workers.dev`
   - Authorization callback URL: `https://quireos-store.bens-account-5d3.workers.dev/auth/github/callback`
2. Generate a client secret, then from `cloudflare/store/`:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

`SESSION_SECRET` is already set. The `ben-gy` account is seeded as the owner of the five apps and
is an admin, so signing in picks them up.

For local development add the same three values to `cloudflare/store/.dev.vars` and use the callback
`http://localhost:8787/auth/github/callback`.

## Publishing changes

- An app Worker: bump `version` in its `src/manifest.ts`, `npm run deploy -w apps/<name>`, then
  publish the new version on the store website (or re-run the seeding script below).
- A static bundle: `npm run bundle` in the app folder and upload the zip on the store website.
- The store itself: `npx wrangler deploy` in `cloudflare/store`.

`cloudflare/tools/seed-store.mjs` re-registers this repo's example apps without the website, which
is how the store was first populated:

```bash
node tools/seed-store.mjs --owner ben-gy --github-id 6506968 --name "Ben Richardson" \
  --store https://quireos-store.bens-account-5d3.workers.dev --apply
```
