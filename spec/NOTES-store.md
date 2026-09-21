# Spec notes from the store implementation (`cloudflare/store`)

Things in `SPEC.md` that the store had to interpret, extend or deviate from. Each item says what the
store does today so the firmware/SDK can match it, and what the spec might say.

## 1. Bundle URLs vs. the `/a/<slug>/<version>/` prefix (§9) — needs a decision

§9: "all URLs inside the bundle are origin-relative to the store", and bundles are served at
`/a/:slug/:version/<file>`. A bundle's `entry: "/screens/home.json"` would then resolve to
`https://<store>/screens/home.json`, which does not exist.

**Store behaviour (same rule as the SDK's `bundleMount`/`rebaseBundle`):** the directory part of
`manifest.entry` is the bundle's *mount* (`/home.json` → `""`, `/hello/home.json` → `/hello`); the
entry file sits at the bundle root and every origin-relative URL in the bundle must resolve to a file
under that mount (`validateBundle` checks this). At publish time the store rebases those URLs from the
mount to `/a/<slug>/<version>` in every `*.json` file and stores the result immutably. Absolute URLs,
`{{…}}` templates and `hosts` are untouched.

**Suggested spec text (§9):** "A bundle's `entry` must be origin-relative and its directory is the
bundle's mount; all other origin-relative URLs in the bundle resolve under that mount to files in the
bundle. The store rewrites them to the version's URL prefix when it publishes." Two things worth
tightening in the SDK: `rebaseBundle` rewrites *every* string that starts with `<mount>/` (a text
widget saying "/" would be rewritten); restricting it to the URL-bearing keys that
`collectRelativeUrls` already uses would be safer. And the rule that the entry file must sit at the
bundle root (entry `/screens/home.json` implies mount `/screens`, so a file at `screens/home.json`
fails) surprised me; authors will hit it, so `tools/validate` should say so in its error.

## 2. `Cache-Control` on authenticated index responses (§4)

§4 mandates `Cache-Control: public, max-age=300`. An index fetched with a device token can contain the
owner's private apps, so the store sends `private, max-age=300` for authenticated responses (and
`public` for anonymous ones), plus `Vary: Authorization`. Devices should ignore this; suggest the spec
says "public for anonymous responses, private otherwise".

## 3. Pairing responses (§9)

- `POST /pair` returns `{code, expires_in, url}`; `url` (the store's `/pair` page) is an addition so
  the device can show it without hard-coding the host.
- `GET /pair/:code` bodies: `202 {"status":"pending"}`, `200 {"status":"paired","user":{"login","name"}}`,
  `410 {"error":…}` when expired, `404` for a code that does not belong to the polling device.
  The spec only says `200 {user}`; suggest pinning these shapes.
- Codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), 6 chars, 10 minutes. The web form is
  case-insensitive.

## 4. Re-registration drops the pairing (§9 "idempotent per hw_id")

`hw_id` is derived from hardware and sent to every app server as `X-Device-Id`, so it is not a secret.
If re-registering kept the account pairing, any app server could impersonate a device and read the
owner's private apps. The store therefore keeps the `device_id` but issues a new token, invalidates the
old one and sets `user_id = NULL`: after a factory reset the user pairs again. Suggest the spec state
this explicitly.

## 5. `installs` semantics (§4)

Undefined in the spec. The store counts devices whose most recent `POST /installs` report for the app
is not `uninstall` (`update` keeps a device counted).

## 6. `GET /apps/:slug` detail fields (§9)

The store returns the index entry plus:
`description` (string), `screenshots` (URL[]), `changelog` (`[{version, published_at, notes}]`, newest
first) and `versions` (`[{version, min_os, manifest, published_at}]`, newest first). The manifest URL
of older hosted versions is `/a/<slug>/<version>/manifest.json`; for external apps every version
reports the same owner URL (the store only snapshots the manifest).

## 7. Index `tagline` and `icon` (§4)

- `tagline` is required in §4 but has no source in the manifest; it comes from the store listing and
  may be the empty string if the developer left it blank.
- `icon`: the store prefers an icon uploaded on the store page (`/icons/<slug>/<hash>.png`), then the
  manifest `icon` (a name, an absolute URL, or a root-relative URL resolved against the bundle prefix or
  the external manifest's origin).

## 8. External manifests must carry an `ETag` (§5)

The store enforces this at publish time (it fetches the manifest with `redirect: "manual"`; a
non-200 or a missing `ETag` is rejected). Worth stating in §9 next to "validated with the same rules".

## 9. `screen` in `POST /devices` (§9)

The registration body's `screen` format is unspecified. The store stores it verbatim (≤ 40 chars) and
also refreshes it from the `X-Screen` header on later requests, truncated to `WxH`.

## 10. Unlisted apps are readable by slug without auth (§9)

`GET /api/v1/apps/<slug>` and the bundle files of an `unlisted` app are served to anyone who knows the
slug ("installable by URL or slug"). Only `private` apps require a paired device token. Confirming this
is the intent.

## 11. Extra columns and `store.json`

`apps` gained `description` and `screenshots` (JSON) for the store page and the detail endpoint; they
are not part of the index document. When a hosted bundle ships the SDK's optional `store.json`
(`tagline`, `description`, `categories`, `screenshots`, `changelog[{version, notes}]`), publishing
merges those fields into the listing and uses the matching changelog entry when the upload form's
changelog is blank. `store.json` is not mentioned in SPEC.md; suggest adding it to §9.
