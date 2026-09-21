# SDK implementation notes for SPEC.md

Decisions taken while implementing `cloudflare/sdk` where SPEC.md is silent or ambiguous, and two
corrections. Each is pinned by `spec/conformance/` so the firmware can match. Merge into SPEC.md
as you see fit.

## Corrections

1. **`then: navigate` target is `then_url`, not `url`.** §7 says `navigate (with url)`, but on an
   `http` action `url` is already the request URL. `then_url` is used on `http`, `submit` and `set`.
   Validator: `then: "navigate"` without `then_url` is an error (`invalid-then-navigate-missing-then-url`).
2. **Bundles need a mount rule.** §9 says bundle URLs are origin-relative to the store, but a zip
   made from `apps/hello/` (served at `/apps/hello/…` by the dev store) is served at
   `/a/hello/1.0.0/…` by the store, so origin-relative URLs cannot be correct in both places.
   Rule implemented in `validateBundle`: the bundle's **mount** is the directory of `manifest.entry`
   (`/apps/hello`); every origin-relative URL in the bundle must start with `<mount>/` and name a
   file in the zip. When the store serves the bundle at a different mount it rewrites the prefix in
   every `.json` file (`rebaseBundle(files, "/apps/hello", "/a/hello/1.0.0")`, a plain string-prefix
   replace on URL-valued strings). Alternative worth considering for a later spec version:
   document-relative URLs (`about.json`, resolved against the containing document) would make
   bundles relocatable without rewriting; the firmware already knows each document's URL.

## §3 Templates and expressions

- **Whitespace** between tokens inside `{{ }}` is skipped; bare-word literals cannot contain
  whitespace (`default:no data` is an error; quote it). Single-quoted literals have no escape
  sequences, so a literal cannot contain `'`. `}}` inside quotes does not close the template.
- **Errors render empty.** A malformed expression, an unknown filter, or a filter with a bad
  argument renders the whole `{{ … }}` as `""`. An unclosed `{{` is literal text.
- **Numbers** render in JS shortest round-trip form (`String(n)`): `21`, `21.5`, `-3.5`, `1e+21`;
  `-0` renders `0`. Firmware: shortest round-trip (Ryu/Grisu or `%.17g` then shorten); the fixtures
  only use values that are unambiguous.
- **`fixed:n`** applies to number values *and* numeric strings (regex below); `n` is clamped to
  0–10. Rounding is JS `toFixed`: round half away from zero on the exact binary value
  (`2.5 → "3"`, `1.005 → "1.00"`). `floor(|x|·10ⁿ + 0.5)` on doubles matches. Non-numbers pass
  through unchanged.
- **`default:x`** substitutes when the stringified value is `""` (missing, `null`, `""`, objects,
  arrays). `"0"`, `0` and `false` are not empty.
- **`upper`/`lower`** touch ASCII letters only.
- **`time:'fmt'`** accepts epoch seconds (number or numeric string, fractions floored) or ISO-8601
  `YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH:MM|±HHMM]` (space accepted instead of `T`). Without a zone
  designator the value is wall time in the device zone. Tokens are matched longest-first
  (`HHH` → `18` + `18`); other characters are copied; `a` is `am`/`pm` in lower case; month and
  day names are English. Unparseable values pass through unchanged (so `| default:` works after).
- **Time zone** comes from `device.tz`; absent → UTC.
- **Numeric regex** for comparisons and `fixed`: `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`, no
  surrounding whitespace, no `inf`/`nan`/hex.
- **Comparisons**: numeric when both stringified sides match the regex (quoting does not make a
  number a string: `vars.ten > '9'` is numeric); otherwise ordered by UTF-16 code units (byte
  order for ASCII). A missing value is `""`, so `vars.nope < 5` is **true** (string compare).
- **Truthiness** is tested on the stringified result: `""`, `"0"`, `"false"`, `"off"` are falsy.
- **Malformed conditions are falsy.** A missing `when` is truthy.
- **`device` fields**: `time tz battery charging rssi name online w h greys dpi`. The validator
  rejects other names; the device renders them empty.
- **Conditional values**: an object is a conditional iff it has a string `if` and a `then` key;
  other keys are invalid. `else` is optional and resolves to `null`, which every property treats as
  "not set" (text `""`, colours their default, vars `""`). Depth counts conditionals: three nested
  levels are allowed; a fourth resolves to `null` (validator: error).
- **Where dynamic values may appear**: string-typed widget properties (`text size weight align
  valign name src label sub icon feedback`) accept templates and conditionals; colour properties
  (`color fill stroke`) accept conditionals but not bare templates (their branches may be
  templates). Static: `type id x y w h x1 y1 x2 y2 cols rows cell_w cell_h gap cell lines stroke_w
  radius width ttl when` and every structural action field (`type method event then after
  replace body_raw`).

## §6.4 Wrapping

- Words are `paragraph.split(" ")`, so consecutive spaces produce empty words and spacing
  round-trips (`"a  b"` at a narrow width → `["a ", "b"]`; greedy fit still applies to the empty
  word).
- A word wider than `w` always starts a fresh line (the current line is flushed first) and is cut
  at the last fitting character measured against `w`; the remainder continues as the next word.
  At least one character is taken per chunk even when it does not fit.
- The same algorithm runs for `lines: 1`: the first greedy line is kept and ellipsised.
- Ellipsis: drop trailing characters until `line + "…"` fits; no trailing-space trimming. The
  advance of `…` (U+2026) comes from the table, `default_advance` if absent.
- Measurement is per code point; unknown glyphs use `default_advance`; a missing `bold` face falls
  back to `regular`.

## Validation rules not spelled out in SPEC.md

- `spec_version` missing is an error for the validator (the device treats it as 1 and logs).
- `line` widgets do not need `x`/`y`; `w`/`h` must be ≥ 0; `x`/`y` are ±32767.
- Grid children may omit `x y w h`; `cols`/`rows` ≤ 64; `cell` must be inside `cols × rows`.
- `after` ≤ 3600; `ttl` ≥ 0 (the device clamps 1–9 to 10).
- Unknown widget or action types are **errors** in the validator (the device skips them).
- Widget `id`s are not required to be unique; data ids and index app ids are.
- Icon names match `^[a-z0-9][a-z0-9_-]{0,63}$`; when `spec/icons.json` is available the CLI
  checks names against it. A manifest/index `icon` starting with `/` or `http` is a URL.
- Manifest `hosts` literals are lower-case origins without a path; `http://` only to private
  hosts (RFC 1918, link-local, loopback, `.local`), also checked statically for literal request URLs.
- With a manifest present, `settings.<key>` must exist; list rows are `settings.<list>.<n>.<field>`;
  secrets may appear only in data-source / `http` / `image` URLs, headers and bodies.
- Absolute literal origins in a screen must be in `hosts` (or equal the app origin when given).
- Bundle PNGs: colour type 0 with 8 bits or type 3 with 4/8 bits, no `tRNS`, ≤ 256 kB;
  `icon.png` (or whatever the manifest `icon` URL points at) must be 96×96.
- `store.json` in a bundle is optional listing metadata: `{ tagline, description, categories,
  screenshots[], changelog[{version, notes}] }`. The store may merge `tagline`/`categories` into
  its index entry.

## Protocol details

- ETags are `"` + the first 32 hex characters of SHA-256 + `"` over the canonical body (sorted
  keys, no whitespace) for JSON, or over the bytes (or a caller-supplied seed) for PNGs.
- `error()` truncates `message` to 120 characters.
- A malformed `X-App-Settings` header parses as `{}`.
- satori is pinned to 0.32.0 (see the SDK README); newer versions cannot run on Workers.

## Conformance fixtures

- `spec/conformance/expr.json`: `{ ctx, cases[] }`; each case has one of `template` → string,
  `cond` → boolean, `value` → scalar/null, plus `expect`, and optionally its own `ctx`.
- `spec/conformance/screens/`: `valid-*.json` must validate; `invalid-*.json` break one rule
  each; `cases.json` lists them with the expected error pointer and whether a JSON schema can
  detect the rule (`schema: false` = semantic check).
- `spec/conformance/wrap.json` (when published by the fonts work) is read by
  `cloudflare/sdk/test/wrap.test.ts` as `{ profile?, cases[{ text, w, lines, size?, weight?, expect[] }] }`.
