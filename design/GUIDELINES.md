# QuireOS interface guidelines

How to design a screen for an e-paper device that runs QuireOS. This document gives the reasoning
and the rules; [tokens/TOKENS.md](tokens/TOKENS.md) gives the pixel values per device and
[COMPONENTS.md](COMPONENTS.md) gives the parts. Where a rule is fixed the text says **must**; where
it is the default a good screen departs from knowingly, it says **should**.

Everything here is expressed in the app spec's vocabulary ([spec/SPEC.md](../spec/SPEC.md)): a
screen is a flat list of `text`, `rect`, `line`, `icon`, `image`, `button` and `grid` widgets at
absolute coordinates, colours are ink levels 0 (black) to 15 (white), and the server lays the
screen out for the device that asked (`X-Screen: 540x960x16@235`).

Contents: 1 Principles · 2 Devices · 3 Layout · 4 Space · 5 Type · 6 Tone · 7 Icons · 8 Refresh ·
9 Input · 10 States · 11 Writing · 12 Legibility · 13 Checklist

---

## 1. Principles

**Paper, not glass.** An e-paper screen is a printed page that can be reprinted. It does not glow,
scroll, fade or bounce. Compose each screen as a finished page: everything the person needs is
visible at once, nothing is "below the fold", nothing waits for a gesture to appear.

**Ink is the only material.** Black, white and a few greys, applied to paper. There is no colour to
carry meaning, no transparency, no shadow, no blur. Hierarchy comes from size, weight, position and
space. Emphasis is either bold or inverted; there is no third kind.

**Space is the first tool, rules the second, fills the last.** Separate things with distance.
Where distance is not enough, one hairline. Fill a shape only to say that it is on, selected or
pressed. A screen with no boxes on it is usually the right one.

**Nothing scrolls.** A screen shows what fits and pages the rest. There is no off-screen content,
no "scroll for more", and no clipping: a list longer than the panel is broken into pages by the
server, exactly as body text is. The kit reports a screen whose content runs past its frame or past
the panel itself, and the gallery build fails on one.

**One thing per screen.** A screen answers one question or offers one action set. Depth comes from
navigation, not density. If a screen needs a second column it needs a second screen, unless the
device is large.

**Same size under every finger.** Sizes are millimetres, not pixels. A button is 7 mm on a badge
and 7 mm on a tablet; only the amount of content changes with the panel.

**Design for the slowest refresh.** Assume every change costs a visible flash and a second. Screens
change when the person acts or the data changes, never on a timer for effect. A layout that keeps
its bones from screen to screen (same nav bar, same toolbar, same margins) lets the device repaint
only what moved.

**The server decides, the device draws.** All layout, wrapping, pagination, number formatting and
state logic happen in the app. A screen document is the result, not a program.

**Fixed where the hand goes, free where the eye goes.** Chrome, targets, states, tone and type are
shared so the person learns them once. What is on the page, and how much, is the app's.

---

## 2. Devices

The system covers four classes. A profile ([profiles.json](profiles.json)) is one panel size with
its dpi, grey depth and inputs; the class sets the millimetre sizes and the profile turns them into
pixels. Apps read the profile from `X-Screen` and lay out for it.

| class | example profiles | how it is read | input | what it is for |
|---|---|---|---|---|
| **badge** | `badge29` 296×128 · `badge42` 400×300 | glanced at, arm's length | 0–3 buttons | one number, one status, one line |
| **panel** | `panel75` 800×480, 1-bit | across a desk or room (×1.4) | 1 button | dashboards that change slowly |
| **handheld** | `t5pro` 540×960, 16 greys | held, reading distance | touch + 1 button | readers, remotes, lists |
| **large** | `tablet103` 1404×1872 · `tablet133` 1650×2200 | held or wall-mounted, reading distance | touch | reading, multi-column boards, frames |

**Orientation** is per app (manifest `orientation`); the device rotates and reports the logical
size. Portrait is the default for handheld and large; landscape for badge and panel. An app that
supports both lays out from the logical width and height it is given, it does not keep two designs.

**Grey depth** changes what tone can express. 16-grey panels show secondary text and hairlines;
4-grey panels keep one mid grey; 1-bit panels have ink and paper only. Section 6 says what to do.

**Input** changes what a screen may assume. Touch panels get tap targets; button-only panels get at
most three actions per screen, mapped to short, long and double presses (section 9).

### Adapting a layout

The same components adapt by these rules, in this order:

0. **Whatever does not fit, pages.** Before anything else, the content is measured against the
   frame. A list becomes pages of whole rows; body text becomes pages of whole lines; a notice
   drops its ornament until it fits. Nothing is ever clipped or pushed off the bottom.
1. **Portrait stacks**: nav bar, content, toolbar. Content is one column.
2. **Landscape moves the toolbar to a left rail** (80 px wide on t5pro) so the content keeps its
   height, and may split content into list and detail when the content width is at least two
   `layout.min_column` plus a gutter.
3. **Large screens add columns**, never bigger type or bigger controls. The measure of a text
   column never exceeds `layout.max_measure` (90 mm); a wider content area becomes two or three
   columns of the same components.
4. **Panels drop the nav bar** when the screen has no navigation (a dashboard is one screen), keep
   the OS corner, and use `lg`/`2xl`/`3xl` type because they are read from further away.
5. **Badges keep only** stat, text, icon, progress and pager, with `space.page` of 2 units and no
   chrome except the OS corner.

Never respond to a larger screen by scaling a small design up. Respond by showing more, at the same
physical size.

---

## 3. Layout

### The page

Every screen is a page with these regions, top to bottom. Heights are t5pro pixels; other profiles
in [TOKENS.md](tokens/TOKENS.md).

```
┌──────────────────────────────────────────┐
│ page margin 24                           │
│ ┌────────────────────────────┐ ┌──────┐  │  nav bar 56: back · title · actions · [OS corner 48]
│ │ ‹  Title              ⟳ ⚙ │ │ ⚠ │  │
│ └────────────────────────────┘ └──────┘  │
│ ────────────────────────────────────────  │  1 px rule, content width
│                                          │  space.2 (8)
│  content                                 │
│  (content width = W − 2 × margin)        │
│                                          │
│ ────────────────────────────────────────  │  1 px hairline
│  ▲    │     Top stories ▾    │     ▼    │  toolbar rows 56 (one or two)
└──────────────────────────────────────────┘
```

- **Page margin** (`space.page`) on all four sides. Text, rules and controls align to it. Fills
  and images may bleed to the screen edge; text never does.
- **Nav bar** (`chrome.nav`): present on any screen that can go back or that has a title. It holds
  a back chevron at the left margin, the title, and up to two icon actions on the right, stopping
  short of the OS corner. Its bottom edge is a 1 px rule at `tone.rule`, the one line every page has.
- **OS corner** (`chrome.corner`): a `48 × 48` slot whose right edge is at the page margin and whose
  top is at the page margin. The OS draws its glyphs there (offline, alert, update, charging, low
  battery, busy). Apps **must** leave it clear on every screen. When the nav bar is present the
  corner sits inside it, at its right end; without a nav bar it still exists.
- **Content** runs from the rule plus `space.2` to the toolbar's hairline minus `space.2`.
- **Toolbar** (`chrome.toolbar` per row): one or two rows of equal cells at the bottom, for the
  screen's actions and paging. On landscape screens it becomes a **rail** on the left. A screen with
  no actions has no toolbar.
- **Toast band** (`chrome.toast`): the OS draws transient messages in a band at the bottom, over the
  toolbar. Apps do not draw there and do not draw toasts.

### Alignment

- **One left edge.** Titles, body, list rows, buttons, rules and the toolbar all start at the page
  margin. Indentation is reserved for hierarchy (replies under a comment, items under a heading)
  and is a multiple of `space.4`.
- **Right edge for numbers and values.** Trailing values in list rows, status text in the nav bar
  and numeric columns align to the right margin.
- **Centre only inside a control.** Button labels, toolbar cells and tiles centre their content.
  Nothing else is centred except a single stat on a badge or an empty-state message.
- **Baselines, not boxes.** Text sits on the 4 px grid by its line box; when text and an icon
  share a line the icon box is centred on the line box.

### Grids and columns

Column count follows content width, not device name:

```
cols = max(1, floor((contentW + gutter) / (minColumn + gutter)))
colW = (contentW − gutter × (cols − 1)) / cols
```

with `layout.min_column` (60 mm) and the gap. Tiles use the spec `grid` with `gap` =
`space.gutter`; **columns of text** (key–value lists, stats, tables side by side) sit
`space.section` apart, because a right-aligned value one gutter from the next column's
left-aligned key reads as one line. Cells are whole multiples of `space.1` wide; any remainder
goes to the outer margins, never to the last cell.

---

## 4. Space

This is the section to read twice. On paper, space is what distinguishes a considered page from a
form.

### The unit

`u` is 4 px on panels of 180 dpi or more and 2 px below: about 0.4–0.5 mm everywhere. Every
position and size on a screen is a multiple of `u`. The scale is

| token | ×u | t5pro | use |
|---|---|---|---|
| `space.1` | 1 | 4 | between a title and its subtitle; between a value and its unit |
| `space.2` | 2 | 8 | between siblings; between an icon and its label; a divider's height |
| `space.3` | 3 | 12 | compact row inset; padding inside chips and pills |
| `space.4` | 4 | 16 | row inset; gutter between tiles; padding inside cards |
| `space.6` | 6 | 24 | page margin; padding inside dialogs; between groups of rows |
| `space.8` | 8 | 32 | a toggle's height; between columns on large screens |
| `space.12` | 12 | 48 | between sections |
| `space.16` | 16 | 64 | around a single element on a badge or panel |

**The rhythm.** Every row, bar and block is a whole number of `space.rhythm` (2u; 8 px on t5pro).
Line heights are not all multiples of the unit — the firmware picks them from the font — so a
column of mixed components would otherwise drift a few pixels per item until nothing lines up. The
kit rounds each block up to the rhythm and centres its text inside, which is why a list of one-line
and two-line rows still reads as one grid.

Named tokens sit on that scale so a class can move them together: `page` (6u), `gutter` (4u),
`inset` (4u), `inset_compact` (3u), `gap` (2u), `rhythm` (2u), `group` (6u), `section` (12u).
Badges halve all of them.

### Margins

- The **page margin** is the same on all four sides and is the largest fixed space on the screen.
  Nothing in the content region is closer to the edge than it, except fills and images that bleed
  on purpose.
- Margins **do not grow with the screen**. A 13-inch tablet keeps 32 px margins and gains columns.
  Growing margins to fill a large screen produces a small screen with a frame around it.
- Margins **do not shrink to fit content**. If a row does not fit, it wraps or truncates
  (section 5); the margin holds.
- The toolbar and rail are inside the margin on the sides and flush with the bottom or left edge.

### Padding (insets)

Padding is the space between a container's edge and what is inside it. It exists only when a
container is visible (a button, a tile, a card, a dialog) or hit-tested (a row).

- **Rows**: `space.4` above and below the text block, `space.3` in compact lists. Rows have no
  side padding: their text starts at the page margin, and their hit area extends to the screen edges.
- **Buttons and chips**: `space.4` at the sides, vertical padding is whatever centres the label in
  the control's fixed height (`touch.row` for buttons, `space.8` for chips).
- **Tiles and cards**: `space.4` on all sides; content inside aligns to that inset edge.
- **Dialogs and sheets**: `space.6` on all sides.
- Padding inside a container **must be at least the gap** between that container and its
  siblings. A tile with 16 px inside and 8 px between tiles reads as a fragment.

### Gaps

- **Siblings** of one kind (rows, tiles, chips) sit `space.gap` apart, or `0` when a hairline
  separates them.
- **Related lines in one item** (a title and its caption) sit `space.2` apart, and the caption is
  in a smaller size and the secondary tone. That is what tells them apart; a rule between them
  would make two items.
- **Groups** of rows sit `space.group` apart with no rule between the groups; the space is the
  divider.
- **Sections** sit `space.section` apart and begin with a section header (a `label` role line).
- A **display stat** has `space.8` above and below and nothing beside it.

### Vertical rhythm

Line heights are chosen so common pairings land on the 4 px grid (`xs` 24 + `md` 36 = 60;
`md` + `space.2` + `xs` = 68). Stack items by adding their heights and the gaps; the kit's `stack()`
does this and rounds each item's top to the unit. Do not distribute leftover space evenly between
rows to fill a page: leftover space goes at the bottom.

### Touch rows against text rows

A row a finger can tap is at least `touch.row` tall (56 px, 6 mm) regardless of its text. A row
that is only read (a key–value line) may be as short as its line height plus `space.2`. Mixing
the two in one list is allowed if tappable rows have a trailing chevron or value and the list is
not alternating.

### Density

Two densities, chosen per screen, never per row:

| | row inset | list-row (1 line) | 2 lines | tile min | use |
|---|---|---|---|---|---|
| comfortable | `space.4` | 72 px | 104 px | 88 px | settings, menus, anything tapped often |
| compact | `space.3` | 64 px | 96 px | 64 px | long lists the person scans, tables |

Both meet the 6 mm row rule on every profile; the kit will not go below it.

### Minimalism, as rules

1. Prefer distance to a line, and a line to a box. If a box is needed, a `frame` stroke, not a fill.
2. No decorative lines: a rule exists to separate two things that would otherwise touch. Two rules
   never run parallel within `space.6` of each other (the nav rule and a section rule, say).
3. No filled backgrounds behind content. A fill means on, selected or pressed.
4. Two type sizes per screen plus `meta`, at most. A third size is a sign the screen is two screens.
5. One bold thing per row, one `lg` or larger thing per screen (a title or a stat, not both).
6. Empty space at the bottom of a page is correct. Do not add content to fill it.
7. Every pixel of chrome earns its place by being tapped or read on every visit. A toolbar cell
   that is used once a month belongs in a menu.
8. Corners: `radius.md` (8 px) on buttons and tiles, `radius.sm` on chips, none on rules, cards,
   dialogs or images.

### Worked examples (t5pro, portrait 540 × 960)

**Settings list.** Margin 24; nav 56 with a rule at y 55; content from y 64. Rows 68 tall
(16 + 36 + 16): title `headline` at the margin, value `body` in `secondary` right-aligned, no rules.
Groups separated by 24. Eleven rows fit above a one-row toolbar.

**Tile board (2 × 4).** Content width 492; two columns: `(492 − 16) / 2 = 238`. Rows of height
190 with 16 gaps fill `4 × 190 + 3 × 16 = 808`, which with 64 above and 24 below is 896 of 960;
the rest is margin. Tile inset 16; icon `md` top-left; label `headline` under it after `space.2`;
sub `caption` at the bottom inset.

**Reader page.** Content width 492, at most 60 characters of `md` per line. Title `title` (56)
wrapped to at most three lines, `space.2`, meta line `xs`, `space.6`, body `md` with paragraph
gaps of `space.3` (a third of a line, as the Hacker News reader does), toolbar of two rows: actions
then `▲ · 3 / 57 · ▼`.

---

## 5. Type

**Roboto** regular and bold, compiled into the firmware at eight named sizes. There is no other
face, no italic, no light weight, no letter-spacing. Apps cannot ship fonts.

### Sizes and roles

Sizes are the spec tokens; roles are how the system uses them. The kit takes a role.

| role | size (t5pro line) | weight | tone | for |
|---|---|---|---|---|
| `display` | `digits` 150 (numbers only) or `3xl` 96 | bold | ink | the one number a panel exists to show |
| `title` | `xl` 56 | bold | ink | a screen's subject in the content (an article title) |
| `headline` | `lg` 44 | bold | ink | dialog and empty-state titles, card titles |
| `nav_title` | `md` 36 | bold | ink | the nav bar title: the anchor of the page |
| `row` | `md` 36 | regular | ink | list-row titles. **Regular, not bold** |
| `body` | `md` 36 | regular | ink | reading text, values, messages |
| `callout` | `lg` 44 | regular | ink | a value that must read from further away without being the display |
| `label` | `sm` 29 | regular | ink | buttons, toolbar cells, chips, segments |
| `section` | `xs` 24 | bold | secondary | the label over a group of rows |
| `caption` | `xs` 24 | regular | secondary | help text under a control, image captions |
| `meta` | `xs` 24 | regular | secondary | bylines, timestamps, counts: facts about an item |

A list row's title is **regular**. Bold in a list is for the row that differs from the others: an
unread story among read ones, the selected item in a choice list. A column of bold titles has no
hierarchy left to spend.

`2xl` 72 is available for panels read from a distance and for pairing codes. Reading text offers
three sizes, S/M/L = `sm`/`md`/`lg`, chosen once in the app's settings.

### Weight

Bold marks the thing a row is about; regular carries everything else. One weight change per row.
Never fake emphasis with size when weight will do, and never use bold for whole paragraphs. On
1-bit panels, bold versus regular is also the substitute for secondary tone (section 6).

### Wrapping and truncation

The device and the SDK wrap identically (spec §6.4), so the server always knows how many lines a
string takes. Rules:

- Titles wrap to at most three lines in lists, unlimited on their own page.
- Body text wraps without limit and is **paginated** by the server into screens of whole lines;
  a page never ends mid-paragraph if the paragraph fits on the next page.
- The last permitted line is truncated with `…`. Never truncate in the middle of a number or a
  name; drop the whole fact instead (section 11).
- A word longer than the measure is broken at the last fitting character; this is rare in
  practice and acceptable.
- Line length: 45–75 characters of `md`. Above `layout.max_measure` the column splits.

### Numbers

- Digits, always: `3 comments`, `21.5°`, `1 / 57`.
- A unit follows its number after a thin gap (`space.1` when drawn as two widgets, a normal
  space in a string): `21 °C`, `72 %`. Percent and degree may attach when space is tight.
- Right-align columns of numbers. The `digits` face is fixed-width; `md` and smaller are
  proportional, so columns of small numbers are aligned by right edge, not by decimal point.
- Times as `HH:mm` (24-hour follows the device locale), dates as `EEE d MMM`, relative times as
  `2 h`, `3 d`, never `2 hours ago`.

---

## 6. Tone

Colour is one integer, 0 black to 15 white. The system names seven levels and one theme rule.

| tone | 16-grey | 4-grey | 1-bit | meaning |
|---|---|---|---|---|
| `paper` | 15 | 15 | 15 | the page |
| `ink` | 0 | 0 | 0 | text, icons, outlines, selected fills |
| `secondary` | 6 | 5 | 0 | meta, captions, values that support a title |
| `tertiary` | 10 | 10 | 0* | disabled controls, read items, resting chevrons |
| `hairline` | 12 | 10 | 0* | separators: under the nav bar, between siblings, around cards |
| `rule` | 8 | 5* | 0* | a line that must be read as structure: a table's header |
| `fill_subtle` | 13 | 15* | 15* | an empty track (progress, slider) |

A separator is a **hairline**, not ink. A 1 px pure-black line the width of the page is a bar, and a
page with three of them looks like a form. The nav bar, the toolbar and the lines between groups
use `hairline`; ink lines are for the one place a line has to be read as structure.

`*` **collapsed**: at that depth the tone equals ink or paper and carries no information. The
tokens list which tones collapse per profile, and the kit adds a second cue for them: on 1-bit,
read items are regular where unread are bold, disabled toolbar glyphs are omitted rather than
greyed, hairlines become solid ink lines and subtle fills vanish. **Never encode meaning in grey
alone**; a grey must always accompany a cue that survives 1-bit.

The states that carry meaning are therefore shapes: **on** is a fill, **off** is an outline,
**selected** is a check or a fill, **disabled** is a 1 px outline or nothing at all.

### Using the levels

- Text is `ink` or `secondary`. `tertiary` text is for things that are present but not for now
  (a read story, a disabled row). Nothing is set in a lighter grey than `tertiary`.
- Fills are `ink` (on, selected, pressed) or none. `fill_subtle` exists for a dialog's band on a
  16-grey panel and for nothing else.
- Lines are `rule` (ink, structural) or `hairline` (grey, between siblings).
- Auto-contrast is the spec's default for buttons (`color` 15 on a fill below 8) and the system's
  rule: text on a fill is `paper`, text on paper is `ink`.
- Levels between 1 and 5 and between 11 and 14 are for images and charts only.

### Dark theme

The dark theme is the token set inverted (`15 − v`). Paper becomes 0, ink 15, secondary 9. It is
an app setting (or an OS setting later), applied by the kit; screens never mix themes. On e-paper
a dark page costs a full refresh more often (the panel flashes to clear ghosting sooner), which
is why it is a choice and not the default.

### Images

A PNG is drawn as-is, no scaling, no dithering on the device. The app renders it for the exact
profile that asked: greyscale, sized to its widget, and **dithered on the server** to the panel's
depth (error-diffusion for 16-grey photographs, ordered for 1-bit). Line art and text in an
image are thresholded, not dithered. Two images per screen at most, and any image screen requests
`refresh: full`.

Charts are drawn with `rect` and `line`, not images: they stay crisp, cost no fetch, and adapt.
Bars are `ink` fills or `frame` outlines; series are told apart by pattern (solid, outline), never
by grey level.

---

## 7. Icons

The rules are in [icons/ICONS.md](icons/ICONS.md). In short: one family (Material Design Icons,
compiled in), three sizes with fixed jobs (`sm` 24 inline with text, `md` 36 in chrome, `lg` 64 as
a screen's single focal glyph), outline at rest and filled for on/selected, ink only, labelled
unless universally understood, and the OS corner glyphs are the OS's.

**An icon is the size of the text beside it.** A glyph drawn from a 24-unit grid keeps its stroke
weight only up to about 3× scale; past that the strokes become slabs and the chrome starts to shout
over the content. That is why `md` (36 px on t5pro) matches the `md` line box and a launcher shows
its apps as a `md` glyph inside a rounded square rather than as a 96 px glyph.

---

## 8. Refresh

E-paper repaints in one of three ways, and the screen document asks for one with `refresh`:

| `refresh` | what happens | ask for it when |
|---|---|---|
| `auto` (default) | the device chooses: a partial update for small changes, a full flash every few partials or when ghosting builds up | almost always |
| `partial` | avoid the flash unless the ghosting policy forces one | tile boards and clocks where a flash on every minute would be a distraction |
| `full` | a clean flash | any screen with an image, and after a theme change |

Rules for apps:

- **Nothing animates.** No progress spinners, no transitions, no counters that tick. A busy state
  is a glyph the OS draws in its corner while a request is in flight.
- **Never blank.** The device keeps the last screen until the next one arrives; a screen must not
  send a placeholder or an empty page while it loads. If the app cannot render yet, it returns an
  error or the previous content.
- **Keep the bones.** When a person navigates within an app the nav bar, toolbar and margins stay
  where they were; the device then repaints only the content region.
- **Tap feedback is inversion.** The tapped widget's rectangle is inverted within about 150 ms and
  stays inverted until the next screen. Buttons, list rows, tiles, toolbar cells and chips get it;
  text and images do not. A screen must be sure that the inverted rectangle is the whole control
  and nothing else, which is why a control is one widget or a `grid` cell.
- **Change when the data changes.** `ttl` and data-source refresh only cause a repaint when a
  rendered value changed. Choose `ttl` for the data, not for the person: weather every ten
  minutes, a light's state every thirty seconds, a clock by the minute tick (`device.time`).
- **Sleep is normal.** Handhelds deep-sleep between taps and wake on touch; the last screen stays
  visible. A screen must be complete and legible without power, so no state is "loading".

---

## 9. Input

### Touch

- A tap target is at least `touch.min` (7 mm; 64 px on t5pro) in both axes, or `touch.row` (6 mm)
  tall when it spans the content width. The recommended size is `touch.recommended` (9 mm).
- Targets are at least `space.2` apart; adjacent rows share edges and rely on their height.
- The hit area may exceed the visual: a row's hit area spans the screen edge to edge; an icon
  button's `48` px glyph sits in a `56` px cell. The kit sets widget geometry to the hit area and
  draws the visual inside it.
- `on_hold` (800 ms) is optional on devices and secondary in apps: it may offer a shortcut (fold a
  thread, mark all read) but never the only way to do something.
- There are no gestures: no swipe, no drag, no pinch. Paging is a tap on a cell or on the
  upper/lower half of a reading page.
- There is no keyboard. Text is entered on the LAN settings page. On-device input is limited to a
  numeric keypad (PINs, codes, quantities) and choice lists.

### Buttons

The function button is the person's guaranteed way out: a **long press is always Home** and no
screen can claim it. A screen may claim the other two presses in its `keys` map (SPEC §6):
**short** = the screen's primary action (next page, refresh, the one button on a dashboard) and
**double** = the secondary one (previous page, back). When a screen claims neither, short = Home
and double = a full redraw. The kit's `pagerRow()` and any toolbar cell with `key` declare these
alongside the tap targets, so one screen serves touch and button-only devices alike. Never rely
on the button for something a touch device could not also reach.

---

## 10. States

| state | look on 16-grey | look on 1-bit | notes |
|---|---|---|---|
| default | as designed | as designed | |
| pressed | inverted rectangle (device does it) | same | until the next screen |
| selected / on | `ink` fill, `paper` text, filled icon twin | same | tiles, segmented control, choice rows |
| current (in a list) | check mark at the right, bold title | same | radio lists, the current feed |
| disabled | `tertiary` text and icon, 1 px outline, no fill; not hit-tested | toolbar glyphs are omitted rather than greyed | prefer absent: a control that cannot be used is usually not needed |
| off (a switch) | 1 px outlined track with an outlined knob at the left | same | never a filled dot: off is the quiet state |
| read / done | `tertiary` text, regular weight | regular weight where unread is bold | lists of items with history |
| offline | OS corner glyph; content unchanged | same | apps do not draw their own offline banner |
| loading | nothing changes; OS corner busy glyph | same | see §8 |
| empty | `lg` icon, `body` message, `caption` hint, optional one button, all at the top of content | same | never a blank content region |
| error (open) | the OS error screen: message, Retry, Home | same | from a status ≥ 400 |
| error (inline) | one `body` line in the content where the value would be, with `alert-circle-outline` `sm` | same | for a data source that failed but the screen still works |

Every state uses weight, fill, an icon or a mark as well as tone, so the 1-bit column is never
"nothing".

---

## 11. Writing

- **Sentence case** everywhere: titles, buttons, tabs, labels. No all-caps, no title case.
- **Short.** A nav title is one to three words. A button is a verb, one or two words: `Save`,
  `Retry`, `Turn off`. A toolbar cell is an icon, or one word.
- **Say the thing, not the system.** `Could not reach Home Assistant` not `HTTP 502`. `Nothing
  saved yet` not `No data`.
- **Facts, dot-separated.** Meta lines are facts joined by ` · `: `675 pts · 273 comments · 1 d ·
  RohanAdwankar`. When the line is too long, whole facts are dropped from the end; a fact is never
  cut.
- **Numbers as digits**, relative times as `2 h`, `3 d`, `1 w`; absolute times as `14:05`, dates as
  `Tue 23 Sep`. Never `ago`, never `about`.
- **No punctuation at the end** of titles, labels, list rows or single-sentence messages. Full
  stops only inside multi-sentence body text.
- **Empty states name the next action**: `Nothing saved yet` + `Open a story and choose Save`.
- **Errors say what to do**: one line of what happened, one of what to try. Retry is always offered
  when a retry can work.
- **Labels are nouns, actions are verbs, states are adjectives**: `Frontlight`, `Turn off`, `Off`.

---

## 12. Legibility

E-paper has no backlight by default and is read in whatever light there is, sometimes at a
distance, sometimes by someone whose eyes are tired.

- Minimum text: `xs` on handheld and large (2.6 mm line, about 7.5 pt), `sm` on panels, and on
  badges only `sm` and above for anything that must be read rather than glanced.
- Reading text defaults to `md` and offers `lg`; an app that shows long text **must** offer the
  reading size setting.
- Contrast: text is `ink` or `secondary`; `tertiary` only for things it is fine to miss.
- Targets: 7 mm minimum, 9 mm recommended, and bigger on wall panels.
- Meaning never in grey alone; state always has a shape.
- A frontlight, where present, is an OS setting, not something a screen turns on.
- Distance: panels multiply every physical size by 1.4; a screen designed for a handheld must not be
  served to a panel unchanged. The kit does this from the profile.

---

## 13. Checklist

Before a screen ships:

- [ ] Every size and position is a multiple of `u`; text and controls align to the page margin.
- [ ] The OS corner is clear; nothing is drawn in the toast band.
- [ ] At most two type sizes plus `meta`; one bold per row; one `lg`+ element per screen.
- [ ] No fills except on/selected; no boxes that a rule or space could replace; no parallel rules.
- [ ] Every tap target is at least 7 mm (or a 6 mm full-width row), and a control is one widget.
- [ ] Every state reads on 1-bit: on/selected has a fill or a filled icon, disabled has a frame or
      is absent, read items change weight.
- [ ] Meta lines drop facts, never cut them; titles wrap to at most three lines in lists.
- [ ] Images are pre-dithered for the profile and the screen asks for `refresh: full`.
- [ ] `ttl` matches the data; the screen references `device.time` only if it shows a clock.
- [ ] Sentence case; verbs on buttons; digits for numbers; no trailing full stops.
- [ ] It validates (`npm run validate`) and renders in the preview on every profile it declares.
