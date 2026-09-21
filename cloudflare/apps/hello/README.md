# Hello (static bundle)

The tutorial app: no server, just files. `manifest.json` points at `screen.json`, which shows
an icon, a greeting with a template, a clock line that the device re-evaluates every minute, and
a button that navigates to `about.json` (which has a six-line paragraph and a Back button).

```
manifest.json   §5 manifest (icon "star", entry /apps/hello/screen.json)
screen.json     home screen, laid out for 540×960 portrait
about.json      second screen
icon.png        96×96 16-grey PNG made by scripts/make-icon.mjs with the SDK encoder
store.json      listing metadata the store merges into its index (tagline, description, changelog)
```

## Try it

```sh
cd cloudflare
npm install
npm run devstore -- ./apps          # serves http://<mac-ip>:8788/index.json
```

Open the store on a device (or the emulator) pointed at that URL and install Hello. The files are
served at `/apps/hello/…`, which is what the URLs inside the bundle expect.

## Ship it

```sh
npm run validate -- apps/hello      # same checks the store runs
npm run bundle -w apps/hello        # writes apps/hello/hello-1.0.0.zip
```

Upload the zip through the store website. The store serves bundles at `/a/hello/1.0.0/…` and
rebases the `/apps/hello/…` URLs to that mount (see `spec/NOTES-sdk.md`, "Bundles").

To regenerate the icon: `npm run icon -w apps/hello`.
