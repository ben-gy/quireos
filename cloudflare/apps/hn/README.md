# Hacker News (QuireOS app)

A read-only Hacker News client for e-paper, ported from the native `hn-t5` reader: six feeds
paged by content height, comment threads you can fold by tapping a byline, a reader mode that
strips the linked article to text, bookmarks, read/unread tracking, three text sizes and a dark
theme. A Cloudflare Worker renders every screen from the [Algolia HN API](https://hn.algolia.com/api);
the device only draws.

```
src/manifest.ts   §5 manifest: id "hn", settings text_size / dark / open_article
src/index.ts      routes and the event handler (createApp)
src/screens.ts    pure screen builders: list, categories, settings, comments, article, message
src/layout.ts     geometry (540×960 first, two columns in landscape), theme, header, toolbar,
                  and the pixel-height paginator shared by comments and articles
src/hn.ts         Algolia client: one request per feed, one per thread, flattened depth-first
src/reader.ts     reader-mode extraction (script/style/nav/header/footer/aside/form dropped,
                  <article>/<main> preferred, headings and bullets kept, JS-only pages detected)
src/text.ts       HTML → text, glyph folding to the device font set, timeAgo, domainOf
src/store.ts      per-install state in KV (settings, bookmarks, read ids, folds) + memory fallback
src/cache.ts      Cache API wrapper with an in-memory fallback (feeds 5 min, threads 5 min, articles 10 min)
test/             vitest: every screen validated with `validateScreen` + the real icon list
```

## Screens

| URL | What | `ttl` |
|---|---|---|
| `/screens/home.json?feed=top\|new\|best\|ask\|show\|jobs\|saved&page=N` | Story list. Rows are as tall as their titles (bold `md`, up to 3 lines) plus a facts line (`xs`: points · comments · age · domain, whole facts dropped from the end when they do not fit). Read stories are drawn at colour 9 (40 % ink). Toolbar: bookmarks · refresh · settings over ▲ · category ▾ · ▼; arrows are `disabled` where there is nowhere to go | 600 |
| `/screens/feeds.json` | Categories (Top, New, Best, Ask HN, Show HN, Jobs, Saved) with a check on the current one | 0 |
| `/screens/settings.json` | Theme, text size (S/M/L → `sm/md/lg`), open story with (comments/article), mark this feed as read, clear read history | 0 |
| `/screens/story.json?id=N&page=N` | Story header + comments paginated by pixel height (18 px between comments, paragraph gaps a third of a line), reply depth as indent with a 2 px bar, tap a byline to fold its subtree (`+N replies`). Toolbar: save · article · back over ▲ · `page / pages` · ▼ | 0 |
| `/screens/article.json?id=N&page=N&from=list\|story` | Reader mode. When the page cannot be read (JavaScript-only, PDF, unreachable) a message screen offers Comments / Retry / Back | 0 |

Every response goes through the SDK's `json()`, so it carries a strong ETag and answers `304`
to `If-None-Match`. List screens embed `{{device.time}}` for the clock in the header, which the
device re-evaluates locally; the document itself only changes when stories or read state do.

Page turns are `navigate` with `replace`, so history holds one entry per screen and the device's
function button pages forward (`keys.short`) and goes back (`keys.double`). Taps that change server
state are `submit` events to `/event`:

| Event | Args | Effect |
|---|---|---|
| `read` | `id` | Marks the story read, `204`; the row's action then navigates (`then: navigate`) |
| `refresh` | `feed` | Evicts the server-side feed cache, `204`; the button's `then: refresh` re-fetches the list |
| `feed` | `feed` | Remembers the feed per install and returns the list (replaces the categories screen) |
| `setting` | `key`, `feed` | Toggles `dark` / cycles `text_size` / toggles `open_article` / `mark_read` / `clear_read`, returns Settings |
| `fold` | `id`, `c`, `page` | Toggles the fold on comment `c`, returns the same page |
| `save` | `id`, `page`, `kind`, `from` | Toggles the bookmark, returns the same comments/article page |

Settings precedence: manifest defaults ← `X-App-Settings` (the device's LAN settings page) ←
choices made on the in-app Settings screen (stored in KV per install).

## Run it

```sh
cd cloudflare
npm install
npm run dev -w apps/hn            # http://localhost:8787/manifest.json, screens validated on every request
npm test -w apps/hn               # renders every screen from fixtures and validates them
npm run typecheck -w apps/hn
```

Point a device at `http://<mac-ip>:8787/manifest.json`. Without device headers the Worker
renders for 540×960 and keys state under `anon`.

## Deploy

1. `wrangler kv namespace create HN_KV` and paste the id into `wrangler.jsonc`. Without the
   binding the Worker falls back to an in-memory map (state lasts one isolate; fine for dev).
2. `npm run deploy -w apps/hn` (rename `name` in `wrangler.jsonc` first).

No secrets are needed. KV is eventually consistent: a screen returned by an event is built from
the value just written, so the change shows immediately; a later re-fetch could lag by up to a
minute at the edge.

CPU: rendering a comments page costs ~10 ms in Node (wrapping ~200 comments with the device's
glyph advances); parsing a very large Algolia thread (hundreds of kB) costs more. Workers Paid
is recommended; on the Free plan the biggest threads may hit the CPU limit.

## Layout

Coordinates target the `t5pro` profile (540×960, 16 greys, `spec/fonts.json`). Text is wrapped
server-side with the SDK's `wrap()` (same algorithm and advance tables as the device) and sent
pre-wrapped, one `text` widget per run of ≤ 8 lines / ≤ 480 bytes, so pagination is exact. When
`X-Screen` reports landscape (960×540) the same chrome is used with the content in two columns.
The header keeps clear of the OS corner (the 48 px status square at the top right).
