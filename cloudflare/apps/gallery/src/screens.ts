// Every gallery screen, one per component group. Each is a function of the kit and a page number,
// so the same code lays itself out for any profile, orientation and grey depth — and pages itself
// when the content is longer than the panel, because an e-paper screen cannot scroll.
//
// This file is also the reference for how to compose screens: copy it, delete what you do not need.
import { Icons, type Kit, type Screen, type Action, type Box, type StackItem, type CellSpec } from "@quireos/ui";

const go = (id: string, page = 1): Action => ({ type: "navigate", url: `/screens/${id}.json${page > 1 ? `?p=${page}` : ""}` });
const home: Action = { type: "home" };
const back: Action = { type: "back" };
const refresh: Action = { type: "refresh" };
const set = (vars: Record<string, string | number | boolean>): Action => ({ type: "set", vars });

export interface Section { id: string; title: string; sub: string }
export const SECTIONS: Section[] = [
  { id: "starter", title: "Starter page", sub: "A typical app screen to copy" },
  { id: "lists", title: "Lists and rows", sub: "Rows, sections, key-values, meta lines" },
  { id: "tiles", title: "Tiles", sub: "A tile board bound to device state" },
  { id: "controls", title: "Controls", sub: "Buttons, toggles, choices, stepper, chips" },
  { id: "navigation", title: "Navigation", sub: "Segmented control, pager, menu rows" },
  { id: "reading", title: "Reading", sub: "A paginated article at the reading size" },
  { id: "data", title: "Data", sub: "Stats, progress, charts, tables" },
  { id: "feedback", title: "Feedback and states", sub: "Empty, disabled, read, offline, busy" },
  { id: "dialog", title: "Dialog", sub: "A modal over a page" },
  { id: "sheet", title: "Action sheet", sub: "A sheet of actions from the bottom" },
  { id: "keypad", title: "Keypad", sub: "The only on-device text input" },
  { id: "launcher", title: "Launcher", sub: "OS: status bar and app grid" },
  { id: "store", title: "Store", sub: "OS: the app list with badges" },
  { id: "error", title: "Error screen", sub: "OS: a failed open" },
  { id: "setup", title: "Setup screen", sub: "OS: first boot with no Wi-Fi" },
  { id: "needs-setup", title: "Needs setup", sub: "OS: an app missing its settings" },
  { id: "update-os", title: "Update QuireOS", sub: "OS: a newer spec is needed" },
  { id: "pair", title: "Pairing", sub: "OS: pair with an account" },
  { id: "dashboard", title: "Dashboard", sub: "A glanceable panel screen" },
  { id: "badge", title: "Badge", sub: "The reduced set for tiny panels" },
];

/**
 * Which device classes a screen is for. A real app says this in its manifest `screens` field and
 * the store greys it out elsewhere; the gallery says it here. A 2.9-inch badge gets the reduced
 * set from the guidelines — one thing per screen — not a squeezed copy of the handheld layout.
 */
const BADGE_SCREENS = new Set(["home", "lists", "store", "badge", "dashboard", "error", "setup", "needs-setup", "update-os", "pair"]);
export function supports(id: string, deviceClass: string): boolean {
  return deviceClass !== "badge" || BADGE_SCREENS.has(id);
}
/** Navigate to a screen only if this device has it; otherwise the row stays put. */
const goIfPresent = (ui: Kit, id: string): Action => (supports(id, ui.p.class) ? go(id) : refresh);

/**
 * A screen whose body is a list too long for one panel. The list is laid out first so the toolbar
 * knows the page count, then the page is assembled around it. This is the pattern every list-shaped
 * app screen uses.
 */
function pagedScreen(ui: Kit, o: { id: string; title: string; page: number; items: StackItem[]; back?: boolean; gap?: number; actions?: CellSpec[] }): Screen {
  const f = ui.frame({ nav: true, toolbarRows: 1 });
  const body = ui.paged(f, o.items, { page: o.page, gap: o.gap });
  const nav = ui.pagerRow({
    page: body.page, pages: body.pages,
    prev: body.page > 1 ? go(o.id, body.page - 1) : back,
    next: go(o.id, body.page + 1),
  });
  return ui.page({
    id: o.page > 1 ? `${o.id}-p${o.page}` : o.id,
    // The pager already says which page this is; saying it twice is chrome for its own sake.
    nav: { title: o.title, back: o.back !== false, actions: o.actions },
    toolbar: { rows: [body.pages > 1 ? nav : [{ icon: Icons.home, on_tap: home, key: "short" }]], placement: "bottom" },
    body: () => body,
  });
}

export const SCREENS: Record<string, (ui: Kit, page: number) => Screen> = {
  home: (ui, page) => pagedScreen(ui, {
    id: "home", title: "Gallery", page, back: false,
    items: SECTIONS.filter((s) => supports(s.id, ui.p.class))
      .map((s) => (b: Box) => ui.linkRow(b, { title: s.title, subtitle: s.sub, on_tap: go(s.id) })),
    gap: 0,
  }),

  starter: (ui) => {
    // Light rows say on or off with the pill alone on a grey panel; 1-bit panels get the word too.
    const word = ui.p.depth === 2;
    return ui.page({
      id: "starter",
      nav: { title: "Lights", back: true, actions: [{ icon: Icons.refresh, on_tap: refresh }] },
      toolbar: { rows: [[
        { icon: Icons.home, on_tap: home },
        { label: "All off", on_tap: set({ hall: "off", kitchen: "off", verandah: "off", office: "off", bedroom: "off" }), key: "double" },
        { icon: Icons.settings, on_tap: go("controls"), key: "short" },
      ]] },
      body: (f) => ui.paged(f, [
        (b: Box) => ui.sectionHeader(b, { text: "Downstairs" }),
        (b: Box) => ui.toggleRow(b, { title: "Hallway", on: "vars.hall == on", on_tap: set({ hall: "off" }), value: word }),
        (b: Box) => ui.toggleRow(b, { title: "Kitchen", subtitle: "Two lamps", on: "vars.kitchen == on", on_tap: set({ kitchen: "off" }), value: word }),
        (b: Box) => ui.toggleRow(b, { title: "Verandah", on: "vars.verandah == on", on_tap: set({ verandah: "on" }), value: word }),
        (b: Box) => ui.sectionHeader(b, { text: "Upstairs" }),
        (b: Box) => ui.toggleRow(b, { title: "Office", on: "vars.office == on", on_tap: set({ office: "off" }), value: word }),
        (b: Box) => ui.toggleRow(b, { title: "Bedroom", on: "vars.bedroom == on", on_tap: set({ bedroom: "on" }), value: word }),
        (b: Box) => ui.divider(b),
        (b: Box) => ui.keyValue(b, { key: "Last updated", value: "{{device.time|time:'HH:mm'}}" }),
      ], { gap: 0 }),
      vars: { hall: "on", kitchen: "on", verandah: "off", office: "on", bedroom: "off" },
    });
  },

  lists: (ui, page) => pagedScreen(ui, {
    id: "lists", title: "Lists and rows", page, gap: 0,
    items: [
      (b) => ui.sectionHeader(b, { text: "Settings rows" }),
      (b) => ui.listRow(b, { title: "Theme", trailing: { value: "Light" }, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "Text size", trailing: { value: "Medium" }, on_tap: refresh }),
      (b) => ui.linkRow(b, { title: "Wi-Fi", value: "Home", on_tap: goIfPresent(ui, "controls") }),
      (b) => ui.listRow(b, { title: "Clear read history", trailing: { value: "142 stories" }, on_tap: refresh }),
      (b) => ui.sectionHeader(b, { text: "Content rows" }),
      (b) => ui.listRow(b, { title: "A story title long enough to wrap onto a second line", titleLines: 3, meta: "675 pts · 273 comments · 1 d · example.com", bold: true, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "A story you have already read", meta: "12 pts · 3 comments · 4 h", read: true, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "With a leading icon and a count", subtitle: "Unread messages", leading: Icons.email, trailing: { badge: 3 }, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "With a status pill", subtitle: "Store entry", leading: Icons.news, trailing: { pill: { text: "Installed" } }, on_tap: refresh }),
      (b) => ui.sectionHeader(b, { text: "Facts" }),
      (b) => ui.keyValue(b, { key: "Battery", value: "{{device.battery}}%" }),
      (b) => ui.keyValue(b, { key: "Signal", value: "{{device.rssi}} dBm" }),
      (b) => ui.keyValue(b, { key: "Storage", value: "8.2 of 12 MB" }),
      (b) => ui.divider(b),
      (b) => ui.metaLine(b, { facts: ["675 pts", "273 comments", "1 d", "RohanAdwankar", "example.com"] }),
    ],
  }),

  tiles: (ui) => ui.page({
    id: "tiles",
    nav: { title: "Tiles", back: true },
    refresh: "partial",
    body: (f) => ui.tileGrid(f, {
      cols: ui.p.orientation === "portrait" ? 2 : 4,
      tiles: [
        { label: "Pool lights", sub: { if: "vars.pool == on", then: "On", else: "Off" }, icon: Icons.light, on: "vars.pool == on", on_tap: set({ pool: "off" }), id: "pool" },
        { label: "Hallway", sub: "Off", icon: Icons.ceiling_light, on: false, on_tap: refresh },
        { label: "Office", sub: "On", icon: Icons.lamp_on, on: true, on_tap: refresh },
        { label: "Garage", sub: "Closed", icon: Icons.garage_closed, on: false, on_tap: refresh },
        { label: "Verandah", sub: "Off", icon: Icons.floor_lamp, on: false, on_tap: refresh },
        { label: "Chandelier", sub: "On", icon: Icons.light_group_on, on: true, on_tap: refresh },
        { label: "Fan", sub: "Off", icon: Icons.fan, on: false, on_tap: refresh },
        { label: "All off", icon: Icons.power, on: false, on_tap: refresh },
      ],
    }),
    vars: { pool: "on" },
  }),

  controls: (ui, page) => pagedScreen(ui, {
    id: "controls", title: "Controls", page,
    items: [
      (b) => ui.buttonRow(b, { buttons: [{ label: "Secondary" }, { label: "Primary", kind: "primary", on_tap: refresh }] }),
      (b) => ui.buttonRow(b, { buttons: [{ label: "Tertiary", kind: "tertiary", on_tap: refresh }, { label: "Disabled", disabled: true }], align: "left" }),
      (b) => ui.buttonRow(b, { buttons: [{ label: "Add", icon: Icons.add, on_tap: refresh, size: "lg" }, { label: "Delete", icon: Icons.delete, kind: "tertiary", on_tap: refresh, size: "lg" }], align: "left" }),
      (b) => ui.sectionHeader(b, { text: "Switches" }),
      (b) => ui.toggleRow(b, { title: "Toggle on", on: true, on_tap: refresh }),
      (b) => ui.toggleRow(b, { title: "Toggle off", subtitle: "With a subtitle", on: false, on_tap: refresh }),
      (b) => ui.checkboxRow(b, { title: "Checked", checked: true, on_tap: refresh }),
      (b) => ui.checkboxRow(b, { title: "Unchecked", checked: false, on_tap: refresh }),
      (b) => ui.sectionHeader(b, { text: "Values" }),
      (b) => ui.stepper(b, { label: "Frontlight", value: "3", on_dec: refresh, on_inc: refresh }),
      (b) => ui.slider(b, { label: "Contrast", caption: "4 of 6", steps: 6, value: 4, on_set: () => refresh }),
      (b) => ui.sectionHeader(b, { text: "Chips" }),
      (b) => ui.chips(b, { chips: [{ label: "Top", selected: true, on_tap: refresh }, { label: "New", on_tap: refresh }, { label: "Best", on_tap: refresh }, { label: "Ask", on_tap: refresh }, { label: "Show", on_tap: refresh }] }),
    ],
  }),

  // The one screen that keeps its toolbar as a rail in landscape, to show the difference.
  navigation: (ui, page) => {
    const f = ui.frame({ nav: true, toolbarRows: ui.p.orientation === "landscape" ? 0 : 2, rail: ui.p.orientation === "landscape" });
    const body = ui.paged(f, [
      (b: Box) => ui.segmented(b, { segments: [{ label: "Day", on_tap: set({ tab: "day" }), when: "vars.tab == day" }, { label: "Week", on_tap: set({ tab: "week" }), when: "vars.tab == week" }, { label: "Month", on_tap: set({ tab: "month" }), when: "vars.tab == month" }] }),
      (b: Box) => ui.sectionHeader(b, { text: "Feed" }),
      ...[{ label: "Top stories", sub: "Front page", value: "top" }, { label: "New", sub: "Most recent", value: "new" }, { label: "Best", value: "best" }, { label: "Saved", sub: "Stories you saved (12)", value: "saved" }]
        .map((opt) => (b: Box) => ui.listRow(b, { title: opt.label, subtitle: opt.sub, bold: { if: `vars.feed == ${opt.value}`, then: "bold", else: "regular" }, trailing: { check: `vars.feed == ${opt.value}` }, on_tap: set({ feed: opt.value }) })),
    ], { page, gap: ui.t.space[2] });
    return ui.page({
      id: page > 1 ? `navigation-p${page}` : "navigation",
      nav: { title: "Navigation", back: true, actions: [{ icon: Icons.search, on_tap: refresh }, { icon: Icons.more, on_tap: go("sheet") }] },
      toolbar: { rows: [[{ icon: Icons.bookmark, on_tap: refresh }, { icon: Icons.refresh, on_tap: refresh }, { icon: Icons.settings, on_tap: go("controls") }],
        ui.pagerRow({ page: body.page, pages: body.pages, prev: body.page > 1 ? go("navigation", body.page - 1) : back, next: go("navigation", body.page + 1) })] },
      body: () => body,
      vars: { tab: "week", feed: "top" },
    });
  },

  reading: (ui, page) => {
    const title = "Exfiltrate your weights";
    const text = [
      "Any hits? Do models even know their own weights to be able to do this? Probably yes, because they have been presumably trained on their own output and conversations about themselves.",
      "No, they would probably have to hack the internal system of the company running them. It would not be a particularly wide ranging hack. There is a strong likelihood of the weights being on the actual machine that is running the model.",
      "It is something that I have wondered about with models like these. How many physical locations are needed to serve a model on that scale? Do they have a huge number of sites running inference?",
      "My suspicion is that the ability to provide inference to that many people is mutually exclusive to having a security level sufficient to stop a state actor, which is why the question keeps coming back.",
      "The weights are the easy part. Serving them at that scale is what needs a building, and buildings are the thing you cannot hide.",
    ].join("\n\n");
    const f = ui.frame({ nav: true, toolbarRows: 2 });
    const head = ui.heading(f, { text: title, role: "title", lines: 3 }).h + ui.t.space[2] + ui.lh("xs") + ui.t.space.group;
    const pages = ui.paginate(f.w, f.h - head, { text });
    const p = Math.min(Math.max(1, page), pages.length);
    return ui.page({
      id: p > 1 ? `reading-p${p}` : "reading",
      nav: { title: "Hacker News", back: true, status: `${p} / ${pages.length}` },
      toolbar: { rows: [
        [{ icon: Icons.bookmark, on_tap: refresh }, { icon: Icons.document, on_tap: refresh }, { icon: Icons.comments, on_tap: refresh }],
        ui.pagerRow({ page: p, pages: pages.length, prev: p > 1 ? go("reading", p - 1) : back, next: go("reading", p + 1) }),
      ], placement: "bottom" },
      body: (fr) => ui.stack(fr, [
        p === 1 ? (b) => ui.heading(b, { text: title, role: "title", lines: 3 }) : null,
        p === 1 ? (b) => ui.metaLine(b, { facts: ["675 pts", "273 comments", "1 d", "RohanAdwankar"] }) : null,
        p === 1 ? ui.spacer(ui.t.space.group - ui.t.space[2]) : null,
        (b) => ui.paragraph(b, { text: pages[p - 1] ?? "" }),
      ], ui.t.space[2]),
    });
  },

  data: (ui, page) => pagedScreen(ui, {
    id: "data", title: "Data", page,
    items: [
      (b) => ui.stat(b, { value: "21.5", unit: "°C", label: "Outside now", icon: Icons.partly_cloudy_day }),
      (b) => ui.progress(b, { value: 0.62, label: "Storage", caption: "8.2 of 12 MB" }),
      (b) => ui.sectionHeader(b, { text: "Rain, last 7 days" }),
      (b) => ui.barChart(b, { values: [2, 0, 5, 12, 3, 0, 1], labels: ["M", "T", "W", "T", "F", "S", "S"], h: ui.t.space[16] }),
      (b) => ui.sectionHeader(b, { text: "Temperature, 24 h" }),
      (b) => ui.sparkline(b, { values: [14, 13, 12, 12, 13, 16, 19, 22, 24, 25, 25, 24, 22, 19, 17, 16], h: ui.t.space[12] }),
      (b) => ui.sectionHeader(b, { text: "Rooms" }),
      (b) => ui.table(b, { columns: [{ title: "Room" }, { title: "°C", align: "right" }, { title: "Humidity", align: "right" }], rows: [["Office", 22.5, "48%"], ["Bedroom", 20.1, "52%"], ["Garage", 17.4, "61%"]] }),
      (b) => ui.sectionHeader(b, { text: "Progress" }),
      (b) => ui.steps(b, { count: 5, current: 3 }),
    ],
  }),

  feedback: (ui) => ui.page({
    id: "feedback",
    nav: { title: "States", back: true, actions: [{ icon: Icons.refresh, disabled: true }] },
    toolbar: { rows: [[{ icon: Icons.home, on_tap: home }]], placement: "bottom" },
    body: (f) => ui.paged(f, [
      (b: Box) => ui.emptyState(b, { icon: Icons.bookmark, title: "Nothing saved yet", hint: "Open a story and choose Save", action: { label: "Browse stories", on_tap: go("lists") } }),
      (b: Box) => ui.sectionHeader(b, { text: "Inline states" }),
      (b: Box) => ui.listRow(b, { title: "A read item", meta: "tertiary tone", read: true, on_tap: refresh }),
      (b: Box) => ui.listRow(b, { title: "A disabled row", meta: "not hit-tested", disabled: true }),
      (b: Box) => ui.keyValue(b, { key: "Sensor", value: "Unavailable" }),
    ], { gap: 0 }),
    overlay: [...ui.systemCorner({ glyph: "offline" }).widgets, ...ui.toast({ text: "Saved" }).widgets],
  }),

  dialog: (ui) => ui.page({
    id: "dialog",
    nav: { title: "Settings", back: true },
    body: (f) => ui.stack(f, [
      (b) => ui.sectionHeader(b, { text: "Reading" }),
      (b) => ui.listRow(b, { title: "Text size", trailing: { value: "Medium" }, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "Clear read history", trailing: { value: "142 stories" }, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "Clear cached feeds", trailing: { value: "1.4 MB" }, on_tap: refresh }),
    ], 0),
    overlay: ui.dialog({ title: "Clear read history?", message: "142 stories will show as unread again. This cannot be undone.", secondary: { label: "Cancel", on_tap: back }, primary: { label: "Clear", on_tap: refresh } }),
  }),

  sheet: (ui) => ui.page({
    id: "sheet",
    nav: { title: "Top stories", back: true },
    body: (f) => ui.stack(f, [
      (b) => ui.listRow(b, { title: "Exfiltrate your weights", meta: "675 pts · 273 comments · 1 d", bold: true, titleLines: 2, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "A second story, held for its actions", meta: "204 pts · 88 comments · 3 h", bold: true, titleLines: 2, on_tap: refresh }),
      (b) => ui.listRow(b, { title: "A third", meta: "31 pts · 4 comments · 6 h", bold: true, on_tap: refresh }),
    ], 0),
    overlay: ui.actionSheet({ title: "Exfiltrate your weights", items: [{ label: "Save", icon: Icons.bookmark, on_tap: refresh }, { label: "Open article", icon: Icons.open_external, on_tap: refresh }, { label: "Mark as read", icon: Icons.check, on_tap: refresh }], cancel: back }),
  }),

  keypad: (ui) => ui.page({
    id: "keypad",
    nav: { title: "Enter code", back: true },
    body: (f) => ui.keypad(f, { h: f.h, display: "{{vars.code|default:'– – – –'}}", on_key: (d) => set({ code: d }), on_delete: set({ code: "" }), on_ok: refresh, id: "code" }),
  }),

  launcher: (ui) => ui.page({
    id: "launcher",
    body: (f) => {
      const bar = ui.statusBar({ time: true });
      const grid = ui.launcherGrid({ ...f, y: bar.h + ui.t.space.group, h: f.h - bar.h - ui.t.space.group }, {
        apps: [
          { name: "Hacker News", icon: Icons.news, on_tap: go("lists") },
          { name: "Lights", icon: Icons.light, on_tap: go("starter"), update: true },
          { name: "Clock", icon: Icons.clock, on_tap: go("dashboard") },
          { name: "Frame", icon: Icons.image, on_tap: refresh },
          { name: "Gallery", icon: Icons.apps, on_tap: home },
          { name: "Store", icon: Icons.store, on_tap: go("store") },
          { name: "Settings", icon: Icons.settings, on_tap: go("dialog") },
        ],
      });
      return { widgets: [...bar.widgets, ...grid.widgets], h: bar.h + ui.t.space.group + grid.h };
    },
  }),

  store: (ui, page) => pagedScreen(ui, {
    id: "store", title: "Store", page, gap: 0,
    actions: [{ icon: Icons.paired, on_tap: go("pair") }],
    items: [
      (b) => ui.storeRow(b, { name: "Hacker News", tagline: "Read-only reader with comments", icon: Icons.news, installed: true, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "HA Lights", tagline: "Home Assistant switch panel", icon: Icons.light, update: true, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "Clock & Weather", tagline: "Open-Meteo forecast", icon: Icons.partly_cloudy_day, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "Frame", tagline: "A picture a day", icon: Icons.image, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "Hello", tagline: "The ten-line tutorial app", icon: Icons.star, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "Tide", tagline: "Tides for one beach", icon: Icons.precipitation, on_tap: refresh }),
      (b) => ui.storeRow(b, { name: "Transit", tagline: "Next departures from one stop", icon: Icons.clock, on_tap: refresh }),
    ],
  }),

  error: (ui) => ui.errorScreen({ message: "Could not reach Home Assistant. Check that this device and HA are on the same network.", retry: refresh, home }),
  setup: (ui) => ui.setupScreen({ ssid: "QuireOS-Setup", url: "http://192.168.4.1" }),
  "needs-setup": (ui) => ui.needsSetupScreen({ app: "HA Lights", url: "http://quireos.local/os", home }),
  "update-os": (ui) => ui.updateOsScreen({ app: "Frame", needs: "2", has: "1", url: "http://quireos.local/os", home }),
  pair: (ui) => ui.pairingScreen({ code: "K7Q3ZD", url: "quireos.dev/pair", cancel: back }),

  dashboard: (ui) => ui.page({
    id: "dashboard",
    ttl: 600,
    refresh: "partial",
    body: (f) => {
      const cols = ui.columns(f, ui.p.orientation === "landscape" && ui.p.class !== "badge" ? 3 : 1, ui.t.space.section);
      const wide = cols.length > 1;
      const groups: StackItem[][] = [
        [
          (b) => ui.stat(b, { value: "{{device.time|time:'HH:mm'}}", label: "{{device.time|time:'EEEE d MMMM'}}", numeric: true }),
          ui.spacer(ui.t.space[4]),
          (b) => ui.stat(b, { value: "21.5", unit: "°C", label: "Outside · feels like 19°", size: "2xl", icon: Icons.partly_cloudy_day }),
          wide ? ui.spacer(ui.t.space.group) : null,
          wide ? (b: Box) => ui.sectionHeader(b, { text: "Rain", trailing: "7 days" }) : null,
          wide ? (b: Box) => ui.barChart(b, { values: [0, 1, 4, 8, 2, 0, 0], labels: ["M", "T", "W", "T", "F", "S", "S"], h: ui.t.space[16] }) : null,
        ],
        [
          (b) => ui.sectionHeader(b, { text: "Today", trailing: "3 events" }),
          (b) => ui.keyValue(b, { key: "09:30", value: "Dentist" }),
          (b) => ui.keyValue(b, { key: "12:00", value: "Lunch with Sam" }),
          (b) => ui.keyValue(b, { key: "15:00", value: "Design review" }),
          wide ? ui.spacer(ui.t.space.group) : null,
          wide ? (b: Box) => ui.sectionHeader(b, { text: "Tomorrow", trailing: "2 events" }) : null,
          wide ? (b: Box) => ui.keyValue(b, { key: "08:00", value: "School run" }) : null,
          wide ? (b: Box) => ui.keyValue(b, { key: "17:30", value: "Football" }) : null,
        ],
        [
          (b) => ui.sectionHeader(b, { text: "House" }),
          (b) => ui.keyValue(b, { key: "Lights on", value: "3" }),
          (b) => ui.keyValue(b, { key: "Garage", value: "Closed" }),
          (b) => ui.keyValue(b, { key: "Pool", value: "24.1 °C" }),
          wide ? ui.spacer(ui.t.space.group) : null,
          wide ? (b: Box) => ui.sectionHeader(b, { text: "Power" }) : null,
          wide ? (b: Box) => ui.keyValue(b, { key: "Solar", value: "2.4 kW" }) : null,
          wide ? (b: Box) => ui.keyValue(b, { key: "Grid", value: "−0.8 kW" }) : null,
          wide ? (b: Box) => ui.keyValue(b, { key: "Battery", value: "84%" }) : null,
        ],
      ];
      if (cols.length === 1) return ui.paged(f, groups.flatMap((g, i) => (i ? [ui.spacer(ui.t.space.group), ...g] : g)), { gap: 0 });
      const pieces = groups.map((g, i) => ui.stack(cols[i]!, g, 0));
      return { widgets: pieces.flatMap((p) => p.widgets), h: Math.max(...pieces.map((p) => p.h)) };
    },
  }),

  badge: (ui) => ui.page({
    id: "badge",
    ttl: 300,
    refresh: "partial",
    body: (f) => ui.stack(f, [
      (b) => ui.stat(b, { value: "21.5", unit: "°C", label: "Outside · feels like 19°", size: ui.p.class === "badge" ? "2xl" : "display" }),
      (b) => ui.progress(b, { value: 0.62, caption: "Battery 62%" }),
    ], ui.t.space[4]),
  }),
};
