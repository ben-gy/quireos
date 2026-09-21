#include "screen_parser.h"
#include <stdio.h>
#include <stdlib.h>

namespace quire {
namespace rt {

namespace {

const char *TAG = "parse";

void fail(ParseResult &r, ParseStatus st, const char *fmt, const char *a = "", int b = 0) {
  r.status = st;
  snprintf(r.error, sizeof r.error, fmt, a, b);
}

// Any string anywhere in the document longer than STRING_MAX_BYTES rejects it.
bool strings_ok(JsonVariantConst v, int depth = 0) {
  if (depth > 12) return true;
  if (v.is<const char *>()) return strlen(v.as<const char *>()) <= STRING_MAX_BYTES;
  if (v.is<JsonArrayConst>()) { for (JsonVariantConst e : v.as<JsonArrayConst>()) if (!strings_ok(e, depth + 1)) return false; }
  else if (v.is<JsonObjectConst>()) { for (JsonPairConst p : v.as<JsonObjectConst>()) if (!strings_ok(p.value(), depth + 1)) return false; }
  return true;
}

bool get_int(JsonVariantConst v, int &out) {
  if (v.is<long long>()) { out = (int)v.as<long long>(); return true; }
  if (v.is<double>()) { out = (int)v.as<double>(); return true; }
  return false;
}
int clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
// -1 = null/absent, else clamped 0..15; a conditional value is left to rebind (returns -2).
int colour_static(JsonVariantConst v) {
  if (v.isNull()) return -1;
  int i;
  if (get_int(v, i)) return clamp(i, 0, 15);
  return -2;
}

bool check_spec_version(JsonObjectConst o, ParseResult &r) {
  JsonVariantConst sv = o["spec_version"];
  if (sv.isNull()) { hal::log(hal::LOG_WARN, TAG, "spec_version missing, assuming 1"); return true; }
  int v;
  if (!get_int(sv, v)) { fail(r, ParseStatus::INVALID, "spec_version must be an integer"); return false; }
  if (v > SPEC_VERSION) { fail(r, ParseStatus::UPDATE_OS, "document needs spec_version %s%d", "", v); return false; }
  return true;
}

bool parse_common(JsonObjectConst o, Widget &w, WidgetTree &tree, int ox, int oy, int dw, int dh, bool need_xy) {
  int x = 0, y = 0, ww = dw, hh = dh;
  bool has_x = get_int(o["x"], x), has_y = get_int(o["y"], y);
  if (need_xy && (!has_x || !has_y)) return false;
  get_int(o["w"], ww);
  get_int(o["h"], hh);
  w.r.x = (int16_t)(ox + x); w.r.y = (int16_t)(oy + y);
  w.r.w = (int16_t)clamp(ww, 0, 4096); w.r.h = (int16_t)clamp(hh, 0, 4096);
  JsonVariantConst id = o["id"];
  if (id.is<const char *>() && valid_id(id.as<const char *>())) w.id = tree.add_str(id.as<const char *>());
  w.src_when = o["when"];
  JsonVariantConst dis = o["disabled"];
  if (dis.is<bool>()) w.disabled = dis.as<bool>(); else if (!dis.isNull()) w.src_disabled = dis;
  w.on_tap = o["on_tap"];
  w.on_hold = o["on_hold"];
  const char *fb = o["feedback"] | (const char *)nullptr;
  if (fb && !strcmp(fb, "invert")) w.feedback = Feedback::INVERT;
  else if (fb && !strcmp(fb, "none")) w.feedback = Feedback::NONE;
  return true;
}

bool parse_widget(JsonObjectConst o, WidgetTree &tree, ScreenMeta &meta, int ox, int oy, int cell_w, int cell_h,
                  int json_index, bool in_grid) {
  const char *type = o["type"] | (const char *)nullptr;
  if (!type) { hal::log(hal::LOG_WARN, TAG, "widget #%d has no type, skipped", json_index); return true; }
  Widget tmp;
  Widget &w = tmp;
  w.json_index = (int16_t)json_index;
  bool in_cell = in_grid;
  int dw = in_cell ? cell_w : 0, dh = in_cell ? cell_h : 0;

  if (!strcmp(type, "text")) {
    w.type = WType::TEXT;
    if (!parse_common(o, w, tree, ox, oy, dw, dh, !in_cell)) return true;
    if (o["text"].isNull()) { hal::log(hal::LOG_WARN, TAG, "text #%d has no text, skipped", json_index); return true; }
    if (!in_cell && o["w"].isNull()) { hal::log(hal::LOG_WARN, TAG, "text #%d has no w, skipped", json_index); return true; }
    w.src_text = o["text"];
    fontlib::size_from_name(o["size"] | "md", w.size);
    fontlib::weight_from_name(o["weight"] | "regular", w.weight);
    const char *al = o["align"] | "left";
    w.align = !strcmp(al, "center") ? Align::CENTER : !strcmp(al, "right") ? Align::RIGHT : Align::LEFT;
    const char *va = o["valign"] | "top";
    w.valign = !strcmp(va, "middle") ? VAlign::MIDDLE : !strcmp(va, "bottom") ? VAlign::BOTTOM : VAlign::TOP;
    int lines = 1; get_int(o["lines"], lines); w.lines = (uint8_t)clamp(lines, 1, 8);
    int c = colour_static(o["color"]);
    if (c == -2) w.src_color = o["color"]; else w.color = (int8_t)(c < 0 ? 0 : c);
    if (o["h"].isNull() && !in_cell) w.r.h = (int16_t)(fontlib::font(w.size, w.weight)->advance_y * w.lines);
  } else if (!strcmp(type, "rect")) {
    w.type = WType::RECT;
    if (!parse_common(o, w, tree, ox, oy, dw, dh, !in_cell)) return true;
    if (!in_cell && (o["w"].isNull() || o["h"].isNull())) return true;
    int f = colour_static(o["fill"]); if (f == -2) w.src_fill = o["fill"]; else w.fill = (int8_t)f;
    int s = colour_static(o["stroke"]); if (s == -2) w.src_stroke = o["stroke"]; else w.stroke = (int8_t)s;
    int sw = 2; get_int(o["stroke_w"], sw); w.stroke_w = (uint8_t)clamp(sw, 1, 8);
    int rad = 0; get_int(o["radius"], rad); w.radius = (uint8_t)clamp(rad, 0, 64);
  } else if (!strcmp(type, "line")) {
    w.type = WType::LINE;
    int x1, y1, x2, y2;
    if (!get_int(o["x1"], x1) || !get_int(o["y1"], y1) || !get_int(o["x2"], x2) || !get_int(o["y2"], y2)) return true;
    parse_common(o, w, tree, ox, oy, 0, 0, false);
    w.x1 = (int16_t)(ox + x1); w.y1 = (int16_t)(oy + y1); w.x2 = (int16_t)(ox + x2); w.y2 = (int16_t)(oy + y2);
    int lw = 1; get_int(o["width"], lw); w.line_w = (uint8_t)clamp(lw, 1, 8);
    int c = colour_static(o["color"]); if (c == -2) w.src_color = o["color"]; else w.color = (int8_t)(c < 0 ? 0 : c);
    int minx = x1 < x2 ? x1 : x2, miny = y1 < y2 ? y1 : y2;
    int maxx = x1 > x2 ? x1 : x2, maxy = y1 > y2 ? y1 : y2;
    w.r.x = (int16_t)(ox + minx - w.line_w); w.r.y = (int16_t)(oy + miny - w.line_w);
    w.r.w = (int16_t)(maxx - minx + 2 * w.line_w + 1); w.r.h = (int16_t)(maxy - miny + 2 * w.line_w + 1);
  } else if (!strcmp(type, "icon")) {
    w.type = WType::ICON;
    icons::size_from_name(o["size"] | "md", w.icon_size);
    int px = icons::pixels(w.icon_size);
    if (!parse_common(o, w, tree, ox, oy, in_cell ? dw : px, in_cell ? dh : px, !in_cell)) return true;
    JsonVariantConst name = o["name"];
    if (name.isNull()) return true;
    if (name.is<const char *>() && !expr::has_template(name.as<const char *>())) {
      w.icon = (int16_t)icons::index_of(name.as<const char *>());
      if (w.icon < 0) hal::log(hal::LOG_WARN, TAG, "unknown icon '%s'", name.as<const char *>());
    } else w.src_icon = name;
    int c = colour_static(o["color"]); if (c == -2) w.src_color = o["color"]; else w.color = (int8_t)(c < 0 ? 0 : c);
  } else if (!strcmp(type, "image")) {
    w.type = WType::IMAGE;
    if (!parse_common(o, w, tree, ox, oy, dw, dh, !in_cell)) return true;
    if (o["src"].isNull() || (!in_cell && (o["w"].isNull() || o["h"].isNull()))) return true;
    if (meta.image_count >= MAX_IMAGES) return false;   // caller rejects the document
    w.src_src = o["src"];
    w.image_slot = (int8_t)meta.image_count;
    ImageSlot &slot = meta.images[meta.image_count++];
    slot.widget = tree.count();
    slot.ttl_set = get_int(o["ttl"], slot.ttl);
  } else if (!strcmp(type, "button")) {
    w.type = WType::BUTTON;
    if (!parse_common(o, w, tree, ox, oy, dw, dh, !in_cell)) return true;
    if (!in_cell && (o["w"].isNull() || o["h"].isNull())) return true;
    w.src_text = o["label"];
    w.src_sub = o["sub"];
    JsonVariantConst ic = o["icon"];
    if (ic.is<const char *>() && !expr::has_template(ic.as<const char *>())) {
      w.icon = (int16_t)icons::index_of(ic.as<const char *>());
      if (w.icon < 0) hal::log(hal::LOG_WARN, TAG, "unknown icon '%s'", ic.as<const char *>());
    } else if (!ic.isNull()) w.src_icon = ic;
    fontlib::size_from_name(o["size"] | "md", w.size);
    fontlib::weight_from_name(o["weight"] | "bold", w.weight);
    int lines = 2; get_int(o["lines"], lines); w.lines = (uint8_t)clamp(lines, 1, 8);
    int f = colour_static(o["fill"]); if (f == -2) w.src_fill = o["fill"]; else w.fill = (int8_t)(o["fill"].isNull() ? 15 : f);
    int s = colour_static(o["stroke"]); if (s == -2) w.src_stroke = o["stroke"]; else w.stroke = (int8_t)(o["stroke"].isNull() ? 0 : s);
    int sw = 2; get_int(o["stroke_w"], sw); w.stroke_w = (uint8_t)clamp(sw, 1, 8);
    int rad = 8; get_int(o["radius"], rad); w.radius = (uint8_t)clamp(rad, 0, 64);
    int c = colour_static(o["color"]); if (c == -2) w.src_color = o["color"]; else w.color = (int8_t)c;   // -1 = auto
    w.feedback = Feedback::INVERT;
    const char *fb = o["feedback"] | (const char *)nullptr;
    if (fb && !strcmp(fb, "none")) w.feedback = Feedback::NONE;
    w.align = Align::CENTER;
  } else if (!strcmp(type, "grid")) {
    if (in_grid) { hal::log(hal::LOG_WARN, TAG, "nested grid skipped"); return true; }
    int gx, gy, cols, rows, cw, ch, gap;
    if (!get_int(o["x"], gx) || !get_int(o["y"], gy) || !get_int(o["cols"], cols) || !get_int(o["rows"], rows) ||
        !get_int(o["cell_w"], cw) || !get_int(o["cell_h"], ch) || !get_int(o["gap"], gap)) {
      hal::log(hal::LOG_WARN, TAG, "grid #%d missing fields, skipped", json_index);
      return true;
    }
    JsonArrayConst children = o["children"];
    if (children.isNull()) return true;
    for (JsonVariantConst cv : children) {
      JsonObjectConst c = cv.as<JsonObjectConst>();
      if (c.isNull()) continue;
      int col = -1, row = -1, cell;
      JsonVariantConst cellv = c["cell"];
      if (get_int(cellv, cell)) { if (cols > 0) { col = cell % cols; row = cell / cols; } }
      else if (cellv.is<JsonArrayConst>() && cellv.size() == 2) { get_int(cellv[0], col); get_int(cellv[1], row); }
      if (col < 0 || row < 0 || col >= cols || row >= rows) { hal::log(hal::LOG_WARN, TAG, "grid child outside grid, skipped"); continue; }
      int cx = gx + col * (cw + gap), cy = gy + row * (ch + gap);
      if (tree.count() >= WidgetTree::CAP) return false;
      if (!parse_widget(c, tree, meta, ox + cx, oy + cy, cw, ch, json_index, true)) return false;
    }
    return true;
  } else {
    hal::log(hal::LOG_WARN, TAG, "unknown widget type '%s' skipped", type);
    return true;
  }
  Widget *dst = tree.add();
  if (!dst) return false;
  *dst = w;
  return true;
}

}  // namespace

bool valid_id(const char *s, bool app_id) {
  if (!s || !*s) return false;
  size_t n = strlen(s);
  if (n > 32) return false;
  if (s[0] < 'a' || s[0] > 'z') return false;
  for (size_t i = 1; i < n; i++) {
    char c = s[i];
    bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || (c == '_' && !app_id);
    if (!ok) return false;
  }
  return true;
}

bool parse_version(const char *s, int out[3]) {
  if (!s) return false;
  int n = sscanf(s, "%d.%d.%d", &out[0], &out[1], &out[2]);
  return n == 3 && out[0] >= 0 && out[1] >= 0 && out[2] >= 0;
}

int compare_versions(const char *a, const char *b) {
  int va[3] = {0, 0, 0}, vb[3] = {0, 0, 0};
  bool oa = parse_version(a, va), ob = parse_version(b, vb);
  if (!oa || !ob) return (oa ? 1 : 0) - (ob ? 1 : 0);
  for (int i = 0; i < 3; i++) if (va[i] != vb[i]) return va[i] < vb[i] ? -1 : 1;
  return 0;
}

static const char *const STYPES[] = {"string", "secret", "url", "number", "bool", "select", "list"};
const char *stype_name(SType t) { return STYPES[(int)t % 7]; }
bool stype_from_name(const char *s, SType &out) {
  if (!s) return false;
  for (int i = 0; i < 7; i++) if (!strcmp(s, STYPES[i])) { out = (SType)i; return true; }
  return false;
}

ParseResult parse_screen(const char *json, size_t len, ParsedScreen &out) {
  ParseResult r;
  out.clear();
  if (len > SCREEN_MAX_BYTES) { fail(r, ParseStatus::TOO_BIG, "screen is %s%d bytes, limit is 32768", "", (int)len); return r; }
  if (!out.tree.valid() && !out.tree.init()) { fail(r, ParseStatus::INVALID, "out of memory"); return r; }
  DeserializationError err = deserializeJson(out.doc, json, len);
  if (err) { fail(r, ParseStatus::INVALID, "invalid JSON: %s", err.c_str()); return r; }
  JsonObjectConst o = out.doc.as<JsonObjectConst>();
  if (o.isNull()) { fail(r, ParseStatus::INVALID, "screen must be a JSON object"); return r; }
  if (!check_spec_version(o, r)) return r;
  if (!strings_ok(out.doc.as<JsonVariantConst>())) { fail(r, ParseStatus::INVALID, "a string exceeds 512 bytes"); return r; }
  const char *id = o["id"] | (const char *)nullptr;
  if (!id || !valid_id(id)) { fail(r, ParseStatus::INVALID, "screen id missing or invalid"); return r; }
  snprintf(out.meta.id, sizeof out.meta.id, "%s", id);
  const char *url = o["url"] | (const char *)nullptr;
  if (url) out.meta.url = url;
  int ttl = 300;
  if (get_int(o["ttl"], ttl)) { if (ttl < 0) ttl = 0; if (ttl > 0 && ttl < 10) ttl = 10; }
  out.meta.ttl = ttl;
  const char *rf = o["refresh"] | "auto";
  out.meta.refresh = !strcmp(rf, "full") ? Refresh::FULL : !strcmp(rf, "partial") ? Refresh::PARTIAL : Refresh::AUTO;

  JsonArrayConst data = o["data"];
  if (!o["data"].isNull() && data.isNull()) { fail(r, ParseStatus::INVALID, "data must be an array"); return r; }
  if (data.size() > (size_t)MAX_DATA) { fail(r, ParseStatus::INVALID, "more than 8 data sources (%s%d)", "", (int)data.size()); return r; }
  for (JsonVariantConst dv : data) {
    JsonObjectConst d = dv.as<JsonObjectConst>();
    const char *did = d["id"] | (const char *)nullptr;
    if (!did || !valid_id(did) || !strcmp(did, "settings") || !strcmp(did, "vars") || !strcmp(did, "device")) {
      fail(r, ParseStatus::INVALID, "data source id '%s' invalid or reserved", did ? did : "");
      return r;
    }
    if (d["url"].isNull()) { fail(r, ParseStatus::INVALID, "data source '%s' has no url", did); return r; }
    for (int i = 0; i < out.meta.data_count; i++)
      if (!strcmp(out.meta.data[i].id, did)) { fail(r, ParseStatus::INVALID, "duplicate data source id '%s'", did); return r; }
    DataSource &ds = out.meta.data[out.meta.data_count++];
    snprintf(ds.id, sizeof ds.id, "%s", did);
    ds.url = d["url"];
    ds.headers = d["headers"];
    ds.body = d["body"];
    const char *m = d["method"] | "GET";
    ds.post = !strcmp(m, "POST");
    ds.body_raw = d["body_raw"] | false;
    ds.required = d["required"] | false;
    int dttl = out.meta.ttl;
    if (get_int(d["ttl"], dttl)) { if (dttl < 0) dttl = 0; if (dttl > 0 && dttl < 10) dttl = 10; }
    ds.ttl = dttl;
  }

  JsonObjectConst vars = o["vars"];
  if (!o["vars"].isNull() && vars.isNull()) { fail(r, ParseStatus::INVALID, "vars must be an object"); return r; }
  if (vars.size() > (size_t)MAX_VARS) { fail(r, ParseStatus::INVALID, "more than 16 vars (%s%d)", "", (int)vars.size()); return r; }
  for (JsonPairConst p : vars) {
    if (!valid_id(p.key().c_str())) { fail(r, ParseStatus::INVALID, "var name '%s' invalid", p.key().c_str()); return r; }
    VarDef &vd = out.meta.vars[out.meta.var_count++];
    snprintf(vd.name, sizeof vd.name, "%s", p.key().c_str());
    vd.value = p.value();
  }

  JsonArrayConst widgets = o["widgets"];
  if (widgets.isNull()) { fail(r, ParseStatus::INVALID, "widgets array missing"); return r; }
  int total = 0;
  for (JsonVariantConst wv : widgets) {
    total++;
    JsonObjectConst wo = wv.as<JsonObjectConst>();
    if (wo.isNull()) continue;
    if (!strcmp(wo["type"] | "", "grid")) total += (int)wo["children"].size();
  }
  if (total > WidgetTree::CAP) { fail(r, ParseStatus::INVALID, "more than 96 widgets (%s%d)", "", total); return r; }
  int idx = 0;
  for (JsonVariantConst wv : widgets) {
    JsonObjectConst wo = wv.as<JsonObjectConst>();
    if (!wo.isNull() && !parse_widget(wo, out.tree, out.meta, 0, 0, 0, 0, idx, false)) {
      fail(r, ParseStatus::INVALID, out.meta.image_count >= MAX_IMAGES ? "more than 2 images" : "too many widgets");
      return r;
    }
    idx++;
  }
  JsonObjectConst keys = o["keys"];
  if (!keys.isNull()) {
    if (keys["short"].is<JsonObjectConst>()) out.meta.key_short = keys["short"];
    if (keys["double"].is<JsonObjectConst>()) out.meta.key_double = keys["double"];
    if (!keys["long"].isNull()) hal::log(hal::LOG_WARN, TAG, "keys.long ignored: a long press is always Home");
  }
  out.meta.uses_device_time = false;
  for (size_t i = 0; i + 11 <= len; i++) {
    if (json[i] == 'd' && !strncmp(json + i, "device.time", 11)) { out.meta.uses_device_time = true; break; }
  }
  return r;
}

ParseResult parse_manifest(const char *json, size_t len, AppManifest &out) {
  ParseResult r;
  out.doc.clear();
  out.hosts.clear(); out.screens.clear(); out.settings.clear();
  if (len > SCREEN_MAX_BYTES) { fail(r, ParseStatus::TOO_BIG, "manifest too large"); return r; }
  DeserializationError err = deserializeJson(out.doc, json, len);
  if (err) { fail(r, ParseStatus::INVALID, "invalid JSON: %s", err.c_str()); return r; }
  JsonObjectConst o = out.doc.as<JsonObjectConst>();
  if (o.isNull()) { fail(r, ParseStatus::INVALID, "manifest must be a JSON object"); return r; }
  if (!check_spec_version(o, r)) return r;
  out.spec_version = o["spec_version"] | 1;
  const char *id = o["id"] | (const char *)nullptr;
  if (!id || !valid_id(id, true)) { fail(r, ParseStatus::INVALID, "manifest id missing or invalid"); return r; }
  snprintf(out.id, sizeof out.id, "%s", id);
  const char *name = o["name"] | (const char *)nullptr;
  if (!name || !*name) { fail(r, ParseStatus::INVALID, "manifest name missing"); return r; }
  out.name = name;
  if (out.name.size() > 24) out.name.resize(24);
  const char *ver = o["version"] | (const char *)nullptr;
  int vv[3];
  if (!ver || !parse_version(ver, vv)) { fail(r, ParseStatus::INVALID, "manifest version missing or invalid"); return r; }
  out.version = ver;
  const char *mo = o["min_os"] | (const char *)nullptr;
  if (!mo || !parse_version(mo, vv)) { fail(r, ParseStatus::INVALID, "manifest min_os missing or invalid"); return r; }
  out.min_os = mo;
  const char *icon = o["icon"] | (const char *)nullptr;
  if (!icon || !*icon) { fail(r, ParseStatus::INVALID, "manifest icon missing"); return r; }
  out.icon = icon;
  const char *entry = o["entry"] | (const char *)nullptr;
  if (!entry || !*entry) { fail(r, ParseStatus::INVALID, "manifest entry missing"); return r; }
  out.entry = entry;
  out.event = o["event"] | "";
  out.orientation = o["orientation"] | "portrait";
  if (out.orientation != "landscape") out.orientation = "portrait";
  for (JsonVariantConst h : o["hosts"].as<JsonArrayConst>()) if (h.is<const char *>()) out.hosts.push_back(h.as<const char *>());
  for (JsonVariantConst s : o["screens"].as<JsonArrayConst>()) if (s.is<const char *>()) out.screens.push_back(s.as<const char *>());
  JsonArrayConst settings = o["settings"];
  if (settings.size() > 8) { fail(r, ParseStatus::INVALID, "more than 8 settings"); return r; }
  for (JsonVariantConst sv : settings) {
    JsonObjectConst s = sv.as<JsonObjectConst>();
    SettingDef d;
    const char *key = s["key"] | (const char *)nullptr;
    if (!key || !valid_id(key)) { fail(r, ParseStatus::INVALID, "setting key '%s' invalid", key ? key : ""); return r; }
    snprintf(d.key, sizeof d.key, "%s", key);
    d.label = s["label"] | key;
    d.help = s["help"] | "";
    if (!stype_from_name(s["type"] | "", d.type)) { fail(r, ParseStatus::INVALID, "setting '%s' has an unknown type", key); return r; }
    d.required = s["required"] | false;
    d.def = s["default"];
    if (d.type == SType::SECRET && !d.def.isNull()) { fail(r, ParseStatus::INVALID, "secret '%s' may not have a default", key); return r; }
    d.options = s["options"];
    d.item = s["item"];
    if (d.type == SType::LIST) {
      if (!d.item.is<JsonArrayConst>()) { fail(r, ParseStatus::INVALID, "list '%s' needs item fields", key); return r; }
      for (JsonVariantConst iv : d.item.as<JsonArrayConst>()) {
        SType it;
        if (!stype_from_name(iv["type"] | "", it) || it == SType::LIST) { fail(r, ParseStatus::INVALID, "list '%s' items must be scalar", key); return r; }
      }
    }
    if (d.type == SType::SELECT && !d.options.is<JsonArrayConst>()) { fail(r, ParseStatus::INVALID, "select '%s' needs options", key); return r; }
    if (s["min"].is<double>() || s["min"].is<long long>()) { d.has_min = true; d.min = s["min"].as<double>(); }
    if (s["max"].is<double>() || s["max"].is<long long>()) { d.has_max = true; d.max = s["max"].as<double>(); }
    if (d.type == SType::LIST && (!d.has_max || d.max > 16)) d.max = 16, d.has_max = true;
    out.settings.push_back(d);
  }
  return r;
}

ParseResult parse_index(const char *json, size_t len, StoreIndex &out) {
  ParseResult r;
  out.apps.clear();
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json, len);
  if (err) { fail(r, ParseStatus::INVALID, "invalid JSON: %s", err.c_str()); return r; }
  JsonObjectConst o = doc.as<JsonObjectConst>();
  if (o.isNull()) { fail(r, ParseStatus::INVALID, "index must be a JSON object"); return r; }
  if (!check_spec_version(o, r)) return r;
  out.name = o["store"]["name"] | "Store";
  out.updated = o["store"]["updated"] | "";
  for (JsonVariantConst av : o["apps"].as<JsonArrayConst>()) {
    JsonObjectConst a = av.as<JsonObjectConst>();
    StoreApp app;
    const char *id = a["id"] | (const char *)nullptr;
    if (!id || !valid_id(id, true)) { hal::log(hal::LOG_WARN, TAG, "index entry with bad id skipped"); continue; }
    app.id = id;
    app.name = a["name"] | id;
    app.tagline = a["tagline"] | "";
    app.icon = a["icon"] | "";
    app.version = a["version"] | "";
    app.manifest = a["manifest"] | "";
    app.min_os = a["min_os"] | "0.0.0";
    app.author = a["author"] | "";
    app.kind = a["kind"] | "";
    app.visibility = a["visibility"] | "";
    app.installs = a["installs"] | 0;
    for (JsonVariantConst s : a["screens"].as<JsonArrayConst>()) if (s.is<const char *>()) app.screens.push_back(s.as<const char *>());
    for (JsonVariantConst s : a["categories"].as<JsonArrayConst>()) if (s.is<const char *>()) app.categories.push_back(s.as<const char *>());
    if (app.manifest.empty()) { hal::log(hal::LOG_WARN, TAG, "index entry '%s' has no manifest url", id); continue; }
    out.apps.push_back(app);
  }
  return r;
}

bool parse_error_body(const char *json, size_t len, std::string &code, std::string &message) {
  code.clear(); message.clear();
  if (!json || !len) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) return false;
  JsonObjectConst e = doc["error"].as<JsonObjectConst>();
  if (e.isNull()) return false;
  code = e["code"] | "";
  message = e["message"] | "";
  if (message.size() > 120) message.resize(120);
  return !message.empty() || !code.empty();
}

}  // namespace rt
}  // namespace quire
