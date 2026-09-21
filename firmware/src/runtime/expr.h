// Templates, expressions, conditions and conditional values (SPEC §3).
#pragma once
#include <stdint.h>
#include <string>
#include "third_party/ArduinoJson.h"
#include "tz.h"

namespace quire {
namespace expr {

struct Value {
  enum Type : uint8_t { NUL, BOOL, NUM, STR, COMPLEX } type = NUL;
  bool b = false;
  bool from_float = false;   // the number came from a JSON value ArduinoJson stored as float
  double num = 0;
  std::string str;
  static Value null() { return Value(); }
  static Value boolean(bool v) { Value r; r.type = BOOL; r.b = v; return r; }
  static Value number(double v) { Value r; r.type = NUM; r.num = v; return r; }
  static Value string(const char *s, size_t n) { Value r; r.type = STR; r.str.assign(s, n); return r; }
  static Value string(const std::string &s) { Value r; r.type = STR; r.str = s; return r; }
};

// Supplies the JSON behind each template root. `root("settings")`, `root("vars")`, `root("device")`
// and `root("<data id>")` return a null variant when unknown. note_settings_ref() is called for every
// settings.<key> reference so the caller can enforce secret gating.
class Resolver {
 public:
  virtual ~Resolver() {}
  virtual JsonVariantConst root(const char *name) = 0;
  virtual void note_settings_ref(const char *key) { (void)key; }
  virtual const tz::Zone &zone() = 0;
};

std::string to_string(const Value &v);           // rendering rules of §3
bool truthy(const Value &v);
bool is_numeric(const Value &v, double &out);    // numbers and numeric strings
std::string format_number(double d, bool from_float = false);   // JS Number#toString
std::string format_fixed(double d, int decimals);// JS Number#toFixed
std::string format_time(const tz::Zone &z, int64_t epoch, const char *fmt);
bool parse_iso8601(const char *s, const tz::Zone &local, int64_t &epoch);

// One expression without braces: path ( "|" filter )*
Value eval_expr(const char *s, size_t len, Resolver &r);
// A condition: expr ( op literal )?
bool eval_cond(const char *s, size_t len, Resolver &r);
inline bool eval_cond(const char *s, Resolver &r) { return eval_cond(s, s ? strlen(s) : 0, r); }
// A template: literal text with any number of {{ expr }}.
std::string render_template(const char *tpl, size_t len, Resolver &r);
inline std::string render_template(const char *tpl, Resolver &r) { return render_template(tpl, tpl ? strlen(tpl) : 0, r); }
bool has_template(const char *s);                 // contains "{{"

// A JSON scalar, template string or {if,then,else} conditional (depth ≤ 3).
Value eval_value(JsonVariantConst v, Resolver &r, int depth = 0);
// Convenience for integer properties (fill, stroke, color): returns false when not a number.
bool eval_int(JsonVariantConst v, Resolver &r, int &out);

// Path lookup used by the evaluator and by the session (data ids, settings rows).
JsonVariantConst lookup(JsonVariantConst root, const char *path, size_t len);

}  // namespace expr
}  // namespace quire
