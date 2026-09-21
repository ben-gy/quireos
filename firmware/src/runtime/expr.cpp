#include "expr.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../hal/hal.h"

namespace quire {
namespace expr {

namespace {

const char *TAG = "expr";

bool is_ident_char(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
}
bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

// Strict decimal number: [+-]digits[.digits][e[+-]digits] or [+-].digits ; whole string.
bool parse_number_strict(const char *s, size_t n, double &out) {
  size_t i = 0;
  while (i < n && is_space(s[i])) i++;
  size_t e = n;
  while (e > i && is_space(s[e - 1])) e--;
  if (i >= e) return false;
  size_t j = i;
  if (s[j] == '+' || s[j] == '-') j++;
  size_t digits = 0;
  while (j < e && s[j] >= '0' && s[j] <= '9') { j++; digits++; }
  if (j < e && s[j] == '.') { j++; while (j < e && s[j] >= '0' && s[j] <= '9') { j++; digits++; } }
  if (!digits) return false;
  if (j < e && (s[j] == 'e' || s[j] == 'E')) {
    j++;
    if (j < e && (s[j] == '+' || s[j] == '-')) j++;
    size_t ed = 0;
    while (j < e && s[j] >= '0' && s[j] <= '9') { j++; ed++; }
    if (!ed) return false;
  }
  if (j != e) return false;
  char tmp[64];
  size_t len = e - i;
  if (len >= sizeof tmp) return false;
  memcpy(tmp, s + i, len);
  tmp[len] = 0;
  out = strtod(tmp, nullptr);
  return isfinite(out);
}

Value from_json(JsonVariantConst v) {
  if (v.isNull()) return Value::null();
  if (v.is<bool>()) return Value::boolean(v.as<bool>());
  if (v.is<const char *>()) { const char *s = v.as<const char *>(); return Value::string(s, strlen(s)); }
  if (v.is<long long>()) return Value::number(v.as<double>());
  if (v.is<double>()) {
    Value n = Value::number(v.as<double>());
    // ArduinoJson keeps short decimals as float (parsed in float arithmetic, so possibly a ulp off
    // the nearest float); remember that so rendering can recover the original decimal text.
    n.from_float = (n.num == (double)v.as<float>());
    return n;
  }
  Value c; c.type = Value::COMPLEX; return c;
}

// The float ArduinoJson's deserializer would produce for this decimal text.
float arduinojson_float(const char *text) {
  return ArduinoJson::detail::parseNumber(text).convertTo<float>();
}

struct Filter { const char *name; size_t nlen; const char *arg; size_t alen; bool quoted; };

// Parses a literal: 'quoted', bare-word or number. Advances *p. Returns false at end.
bool parse_literal(const char *&p, const char *end, std::string &out, bool &quoted) {
  quoted = false;
  while (p < end && is_space(*p)) p++;
  if (p >= end) return false;
  if (*p == '\'') {
    quoted = true;
    p++;
    while (p < end && *p != '\'') {
      if (*p == '\\' && p + 1 < end) p++;   // \' inside a literal
      out.push_back(*p++);
    }
    if (p < end) p++;
    return true;
  }
  while (p < end && !is_space(*p) && *p != '|') out.push_back(*p++);
  return true;
}

Value apply_filter(const Value &in, const Filter &f, Resolver &r) {
  if (f.nlen == 5 && !strncmp(f.name, "fixed", 5)) {
    int n = f.arg ? atoi(std::string(f.arg, f.alen).c_str()) : 0;
    if (n < 0) n = 0;
    if (n > 20) n = 20;
    double d;
    if (is_numeric(in, d)) return Value::string(format_fixed(d, n));
    return in;
  }
  if (f.nlen == 7 && !strncmp(f.name, "default", 7)) {
    if (to_string(in).empty()) return Value::string(f.arg ? f.arg : "", f.arg ? f.alen : 0);
    return in;
  }
  if (f.nlen == 5 && !strncmp(f.name, "upper", 5)) {
    std::string s = to_string(in);
    for (char &c : s) if (c >= 'a' && c <= 'z') c = (char)(c - 32);
    return Value::string(s);
  }
  if (f.nlen == 5 && !strncmp(f.name, "lower", 5)) {
    std::string s = to_string(in);
    for (char &c : s) if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
    return Value::string(s);
  }
  if (f.nlen == 4 && !strncmp(f.name, "time", 4)) {
    std::string fmt(f.arg ? f.arg : "", f.arg ? f.alen : 0);
    int64_t epoch = 0;
    double d;
    if (in.type == Value::NUM) epoch = (int64_t)floor(in.num);
    else if (in.type == Value::STR) {
      if (parse_number_strict(in.str.c_str(), in.str.size(), d)) epoch = (int64_t)floor(d);
      else if (!parse_iso8601(in.str.c_str(), r.zone(), epoch)) return in;   // not a time: pass through
    } else return in;
    return Value::string(format_time(r.zone(), epoch, fmt.c_str()));
  }
  hal::log(hal::LOG_WARN, TAG, "unknown filter '%.*s'", (int)f.nlen, f.name);
  return Value::string("", 0);
}

}  // namespace

// ------------------------------------------------------------------------------- values ---

std::string format_number(double d, bool from_float) {
  if (isnan(d)) return "NaN";
  if (isinf(d)) return d < 0 ? "-Infinity" : "Infinity";
  if (d == 0) return "0";
  char buf[40];
  if (d == floor(d) && fabs(d) < 1e21) { snprintf(buf, sizeof buf, "%.0f", d); return buf; }
  // Shortest digits that round-trip: through strtod for real doubles, or through ArduinoJson's own
  // float parser for values it stored as float (so "21.456" comes back as 21.456, not 21.456001).
  int prec = 1;
  for (; prec <= 17; prec++) {
    snprintf(buf, sizeof buf, "%.*e", prec - 1, d);
    if (from_float ? (arduinojson_float(buf) == (float)d) : (strtod(buf, nullptr) == d)) break;
  }
  // buf: [-]d[.ddd]e[+-]xx
  std::string s(buf);
  bool neg = s[0] == '-';
  if (neg) s.erase(0, 1);
  size_t epos = s.find('e');
  int exp10 = atoi(s.c_str() + epos + 1);
  std::string digits;
  for (size_t i = 0; i < epos; i++) if (s[i] != '.') digits.push_back(s[i]);
  while (digits.size() > 1 && digits.back() == '0') digits.pop_back();
  int k = (int)digits.size();
  int n = exp10 + 1;
  std::string out;
  if (k <= n && n <= 21) { out = digits; out.append((size_t)(n - k), '0'); }
  else if (0 < n && n <= 21) { out = digits.substr(0, (size_t)n); out.push_back('.'); out += digits.substr((size_t)n); }
  else if (-6 < n && n <= 0) { out = "0."; out.append((size_t)(-n), '0'); out += digits; }
  else {
    int e = n - 1;
    out = digits.substr(0, 1);
    if (k > 1) { out.push_back('.'); out += digits.substr(1); }
    out.push_back('e');
    out.push_back(e < 0 ? '-' : '+');
    out += std::to_string(e < 0 ? -e : e);
  }
  return neg ? "-" + out : out;
}

std::string format_fixed(double d, int decimals) {
  if (isnan(d)) return "NaN";
  if (fabs(d) >= 1e21) return format_number(d);
  bool neg = d < 0;
  double m = fabs(d);
  // Detect an exact decimal tie (…5000) which JS rounds up while printf rounds half to even.
  char big[400];
  snprintf(big, sizeof big, "%.*f", decimals + 30, m);
  const char *dot = strchr(big, '.');
  bool tie = false;
  if (dot) {
    const char *tail = dot + 1 + decimals;
    if (*tail == '5') {
      tie = true;
      for (const char *p = tail + 1; *p; p++) if (*p != '0') { tie = false; break; }
    }
  }
  char buf[400];
  if (tie) {
    // Round half up: add half a unit in the last place and truncate.
    snprintf(buf, sizeof buf, "%.*f", decimals + 30, m);   // exact digits
    std::string s(buf);
    size_t cut = s.find('.') + 1 + (size_t)decimals;
    std::string kept = s.substr(0, cut);
    // increment the decimal string `kept` by one unit at its last digit
    int i = (int)kept.size() - 1;
    while (i >= 0) {
      if (kept[(size_t)i] == '.') { i--; continue; }
      if (kept[(size_t)i] == '9') { kept[(size_t)i] = '0'; i--; continue; }
      kept[(size_t)i]++;
      break;
    }
    if (i < 0) kept.insert(0, "1");
    if (decimals == 0 && !kept.empty() && kept.back() == '.') kept.pop_back();
    s = kept;
    if (neg && s.find_first_not_of("0.") != std::string::npos) s.insert(0, "-");
    return s;
  }
  snprintf(buf, sizeof buf, "%.*f", decimals, m);
  std::string s(buf);
  if (neg && s.find_first_not_of("0.") != std::string::npos) s.insert(0, "-");
  return s;
}

std::string to_string(const Value &v) {
  switch (v.type) {
    case Value::NUL: return "";
    case Value::BOOL: return v.b ? "true" : "false";
    case Value::NUM: return format_number(v.num, v.from_float);
    case Value::STR: return v.str;
    default: return "";
  }
}

bool truthy(const Value &v) {
  switch (v.type) {
    case Value::NUL: return false;
    case Value::BOOL: return v.b;
    case Value::NUM: return v.num != 0;
    case Value::STR: return !(v.str.empty() || v.str == "0" || v.str == "false" || v.str == "off");
    default: return false;   // objects and arrays render as "" and are falsy
  }
}

bool is_numeric(const Value &v, double &out) {
  if (v.type == Value::NUM) { out = v.num; return true; }
  if (v.type == Value::STR) return parse_number_strict(v.str.c_str(), v.str.size(), out);
  return false;
}

// --------------------------------------------------------------------------------- time ---

static const char *const MONTHS[] = {"January", "February", "March", "April", "May", "June", "July",
                                     "August", "September", "October", "November", "December"};
static const char *const DAYS[] = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};

std::string format_time(const tz::Zone &z, int64_t epoch, const char *fmt) {
  tz::Civil c;
  tz::local_time(z, epoch, c);
  std::string out;
  char b[16];
  const char *p = fmt;
  auto starts = [&](const char *tok) { return strncmp(p, tok, strlen(tok)) == 0; };
  while (*p) {
    int h12 = c.hour % 12; if (h12 == 0) h12 = 12;
    if (starts("yyyy")) { snprintf(b, sizeof b, "%04d", c.year); out += b; p += 4; }
    else if (starts("MMMM")) { out += MONTHS[c.month - 1]; p += 4; }
    else if (starts("MMM")) { out.append(MONTHS[c.month - 1], 3); p += 3; }
    else if (starts("MM")) { snprintf(b, sizeof b, "%02d", c.month); out += b; p += 2; }
    else if (starts("M")) { snprintf(b, sizeof b, "%d", c.month); out += b; p += 1; }
    else if (starts("EEEE")) { out += DAYS[c.dow]; p += 4; }
    else if (starts("EEE")) { out.append(DAYS[c.dow], 3); p += 3; }
    else if (starts("HH")) { snprintf(b, sizeof b, "%02d", c.hour); out += b; p += 2; }
    else if (starts("H")) { snprintf(b, sizeof b, "%d", c.hour); out += b; p += 1; }
    else if (starts("hh")) { snprintf(b, sizeof b, "%02d", h12); out += b; p += 2; }
    else if (starts("h")) { snprintf(b, sizeof b, "%d", h12); out += b; p += 1; }
    else if (starts("mm")) { snprintf(b, sizeof b, "%02d", c.minute); out += b; p += 2; }
    else if (starts("ss")) { snprintf(b, sizeof b, "%02d", c.second); out += b; p += 2; }
    else if (starts("dd")) { snprintf(b, sizeof b, "%02d", c.day); out += b; p += 2; }
    else if (starts("d")) { snprintf(b, sizeof b, "%d", c.day); out += b; p += 1; }
    else if (starts("a")) { out += c.hour < 12 ? "am" : "pm"; p += 1; }
    else out.push_back(*p++);
  }
  return out;
}

bool parse_iso8601(const char *s, const tz::Zone &local, int64_t &epoch) {
  // YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH:MM|±HHMM]; values without a zone are device-local.
  int y, mo, d, hh = 0, mm = 0, ss = 0;
  const char *p = s;
  auto num = [&](int digits, int &out) {
    out = 0;
    for (int i = 0; i < digits; i++) { if (*p < '0' || *p > '9') return false; out = out * 10 + (*p++ - '0'); }
    return true;
  };
  if (!num(4, y) || *p++ != '-' || !num(2, mo) || *p++ != '-' || !num(2, d)) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  bool date_only = (*p == 0);
  bool has_zone = false;
  int zone_min = 0;
  if (!date_only) {
    if (*p != 'T' && *p != 't' && *p != ' ') return false;
    p++;
    if (!num(2, hh) || *p++ != ':' || !num(2, mm)) return false;
    if (*p == ':') { p++; if (!num(2, ss)) return false; }
    if (*p == '.' || *p == ',') { p++; while (*p >= '0' && *p <= '9') p++; }
    if (*p == 'Z' || *p == 'z') { has_zone = true; p++; }
    else if (*p == '+' || *p == '-') {
      int sign = *p == '-' ? -1 : 1;
      p++;
      int zh, zm = 0;
      if (!num(2, zh)) return false;
      if (*p == ':') p++;
      if (*p >= '0' && *p <= '9') { if (!num(2, zm)) return false; }
      has_zone = true;
      zone_min = sign * (zh * 60 + zm);
    }
    if (*p) return false;
  }
  int64_t t = tz::epoch_from_civil(y, mo, d, hh, mm, ss);
  if (has_zone) { epoch = t - (int64_t)zone_min * 60; return true; }
  // Zone-less date-times and date-only values are local wall time: subtract the offset in effect
  // (approximated with the offset at that UTC guess).
  int off = tz::offset_minutes(local, t - (int64_t)local.std_min * 60);
  epoch = t - (int64_t)off * 60;
  return true;
}

// --------------------------------------------------------------------------------- paths ---

JsonVariantConst lookup(JsonVariantConst root, const char *path, size_t len) {
  JsonVariantConst cur = root;
  size_t i = 0;
  while (i < len && !cur.isNull()) {
    size_t j = i;
    while (j < len && path[j] != '.') j++;
    std::string seg(path + i, j - i);
    bool numeric = !seg.empty();
    for (char c : seg) if (c < '0' || c > '9') { numeric = false; break; }
    if (numeric && cur.is<JsonArrayConst>()) cur = cur[(size_t)atoi(seg.c_str())];
    else if (cur.is<JsonObjectConst>()) cur = cur[seg.c_str()];
    else return JsonVariantConst();
    i = j + 1;
  }
  return cur;
}

// --------------------------------------------------------------------------- expressions ---

Value eval_expr(const char *s, size_t len, Resolver &r) {
  const char *p = s, *end = s + len;
  while (p < end && is_space(*p)) p++;
  const char *path = p;
  while (p < end && (is_ident_char(*p) || *p == '.')) p++;
  size_t plen = (size_t)(p - path);
  Value v;
  if (plen) {
    size_t dot = 0;
    while (dot < plen && path[dot] != '.') dot++;
    std::string root(path, dot);
    if (root == "settings" && dot < plen) {
      size_t k = dot + 1, ke = k;
      while (ke < plen && path[ke] != '.') ke++;
      std::string key(path + k, ke - k);
      r.note_settings_ref(key.c_str());
    }
    JsonVariantConst rv = r.root(root.c_str());
    if (dot < plen) v = from_json(lookup(rv, path + dot + 1, plen - dot - 1));
    else v = from_json(rv);
  }
  // filters
  while (true) {
    while (p < end && is_space(*p)) p++;
    if (p >= end || *p != '|') break;
    p++;
    while (p < end && is_space(*p)) p++;
    Filter f = {p, 0, nullptr, 0, false};
    while (p < end && is_ident_char(*p)) p++;
    f.nlen = (size_t)(p - f.name);
    std::string arg;
    if (p < end && *p == ':') {
      p++;
      bool quoted;
      if (parse_literal(p, end, arg, quoted)) { f.arg = arg.c_str(); f.alen = arg.size(); f.quoted = quoted; }
    }
    v = apply_filter(v, f, r);
  }
  return v;
}

bool eval_cond(const char *s, size_t len, Resolver &r) {
  // Split at the comparison operator (outside quotes).
  const char *p = s, *end = s + len;
  const char *op = nullptr;
  int oplen = 0;
  bool inq = false;
  for (const char *q = p; q < end; q++) {
    if (*q == '\'') inq = !inq;
    if (inq) continue;
    if ((*q == '=' || *q == '!' || *q == '<' || *q == '>')) {
      op = q;
      oplen = (q + 1 < end && q[1] == '=') ? 2 : 1;
      if (*q == '!' && oplen == 1) { op = nullptr; continue; }   // stray '!'
      if (*q == '=' && oplen == 1) { op = nullptr; continue; }   // single '=' is not an operator
      break;
    }
  }
  if (!op) return truthy(eval_expr(s, len, r));
  // Malformed: nothing before the operator, or nothing after it.
  {
    const char *q0 = s;
    while (q0 < op && is_space(*q0)) q0++;
    if (q0 >= op || !(is_ident_char(*q0))) return false;
  }
  Value lhs = eval_expr(s, (size_t)(op - s), r);
  const char *q = op + oplen;
  std::string lit;
  bool quoted = false;
  if (!parse_literal(q, end, lit, quoted)) return false;
  Value rhs = Value::string(lit);
  double a, b;
  int cmp;
  bool numeric = is_numeric(lhs, a) && is_numeric(rhs, b);
  if (numeric) {
    if (lhs.from_float || rhs.from_float) {
      // Compare the way the JSON parser saw both sides: as ArduinoJson floats of their decimal text.
      float fa = lhs.from_float ? (float)a : arduinojson_float(to_string(lhs).c_str());
      float fb = rhs.from_float ? (float)b : arduinojson_float(to_string(rhs).c_str());
      cmp = fa < fb ? -1 : (fa > fb ? 1 : 0);
    } else cmp = a < b ? -1 : (a > b ? 1 : 0);
  }
  else {
    std::string ls = to_string(lhs);
    int c = strcmp(ls.c_str(), lit.c_str());
    cmp = c < 0 ? -1 : (c > 0 ? 1 : 0);
  }
  if (oplen == 2) {
    switch (op[0]) {
      case '=': return cmp == 0;
      case '!': return cmp != 0;
      case '<': return cmp <= 0;
      case '>': return cmp >= 0;
    }
  }
  return op[0] == '<' ? cmp < 0 : cmp > 0;
}

bool has_template(const char *s) { return s && strstr(s, "{{") != nullptr; }

std::string render_template(const char *tpl, size_t len, Resolver &r) {
  std::string out;
  if (!tpl) return out;
  size_t i = 0;
  while (i < len) {
    if (tpl[i] == '{' && i + 1 < len && tpl[i + 1] == '{') {
      size_t j = i + 2;
      while (j + 1 < len && !(tpl[j] == '}' && tpl[j + 1] == '}')) j++;
      if (j + 1 >= len) { out.append(tpl + i, len - i); break; }   // unterminated: copy literally
      out += to_string(eval_expr(tpl + i + 2, j - i - 2, r));
      i = j + 2;
    } else {
      out.push_back(tpl[i++]);
    }
  }
  return out;
}

Value eval_value(JsonVariantConst v, Resolver &r, int depth) {
  if (v.is<const char *>()) {
    const char *s = v.as<const char *>();
    if (has_template(s)) return Value::string(render_template(s, strlen(s), r));
    return Value::string(s, strlen(s));
  }
  if (v.is<JsonObjectConst>()) {
    JsonVariantConst cond = v["if"];
    if (cond.is<const char *>()) {
      if (depth >= 3) { hal::log(hal::LOG_WARN, TAG, "conditional nested deeper than 3"); return Value::null(); }
      bool t = eval_cond(cond.as<const char *>(), r);
      JsonVariantConst branch = t ? v["then"] : v["else"];
      return eval_value(branch, r, depth + 1);
    }
    Value c; c.type = Value::COMPLEX; return c;
  }
  return from_json(v);
}

bool eval_int(JsonVariantConst v, Resolver &r, int &out) {
  if (v.isNull()) return false;
  Value val = eval_value(v, r);
  double d;
  if (!is_numeric(val, d)) return false;
  out = (int)llround(d);
  return true;
}

}  // namespace expr
}  // namespace quire
