// Runs spec/conformance/expr.json (and expr-firmware.json when present) through the evaluator.
#include "../../src/runtime/expr.h"
#include "test_util.h"

using namespace quire;

struct CtxResolver : expr::Resolver {
  JsonDocument doc;
  tz::Zone zone_;
  void load(JsonVariantConst ctx) {
    doc.clear();
    doc.set(ctx);
    const char *tzname = doc["device"]["tz"] | "UTC";
    tz::parse(tzname, zone_);
  }
  JsonVariantConst root(const char *name) override {
    JsonVariantConst d = doc.as<JsonVariantConst>();
    if (!strcmp(name, "settings") || !strcmp(name, "vars") || !strcmp(name, "device")) return d[name];
    return d["data"][name];
  }
  const tz::Zone &zone() override { return zone_; }
};

static std::string json_of(JsonVariantConst v) { std::string s; serializeJson(v, s); return s; }

static void run_file(const std::string &path) {
  std::string text;
  if (!read_file(path, text)) { printf("  (skipped: %s not found)\n", path.c_str()); return; }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, text);
  CHECK(!err, "%s: %s", path.c_str(), err.c_str());
  if (err) return;
  JsonVariantConst top_ctx = doc["ctx"];
  JsonArrayConst cases = doc["cases"].is<JsonArrayConst>() ? doc["cases"].as<JsonArrayConst>() : doc.as<JsonArrayConst>();
  int n = 0;
  for (JsonObjectConst c : cases) {
    n++;
    CtxResolver r;
    r.load(c["ctx"].isNull() ? top_ctx : c["ctx"]);
    const char *name = c["name"] | "?";
    JsonVariantConst expect = c["expect"].isNull() && !c["expected"].isNull() ? c["expected"] : c["expect"];
    if (c["template"].is<const char *>()) {
      std::string got = expr::render_template(c["template"].as<const char *>(), r);
      std::string want = expect | "";
      CHECK(got == want, "[%s] template %s: got '%s' want '%s'", name, c["template"].as<const char *>(), got.c_str(), want.c_str());
    } else if (c["cond"].is<const char *>()) {
      bool got = expr::eval_cond(c["cond"].as<const char *>(), r);
      JsonVariantConst e = expect.isNull() ? c["expected_bool"] : expect;
      bool want = e | false;
      CHECK(got == want, "[%s] cond '%s': got %d want %d", name, c["cond"].as<const char *>(), got, want);
    } else if (!c["value"].isNull() || c["expect"].isNull()) {
      expr::Value v = expr::eval_value(c["value"], r);
      std::string got;
      switch (v.type) {
        case expr::Value::NUL: got = "null"; break;
        case expr::Value::BOOL: got = v.b ? "true" : "false"; break;
        case expr::Value::NUM: got = expr::format_number(v.num); break;
        case expr::Value::STR: got = "\"" + v.str + "\""; break;
        default: got = "{}"; break;
      }
      std::string want = json_of(expect);
      CHECK(got == want, "[%s] value: got %s want %s", name, got.c_str(), want.c_str());
    }
  }
  printf("  %s: %d cases\n", path.c_str(), n);
}

int main(int argc, char **argv) {
  std::string root = repo_root(argc, argv);
  run_file(root + "/spec/conformance/expr.json");
  run_file(root + "/spec/conformance/expr-firmware.json");
  // A few firmware-only checks.
  CHECK(expr::format_number(21.5) == "21.5", "shortest float");
  CHECK(expr::format_number(1e21) == "1e+21", "exponent form: %s", expr::format_number(1e21).c_str());
  CHECK(expr::format_number(0.000001) == "0.000001", "small: %s", expr::format_number(0.000001).c_str());
  CHECK(expr::format_number(1e-7) == "1e-7", "tiny: %s", expr::format_number(1e-7).c_str());
  CHECK(expr::format_fixed(2.5, 0) == "3", "toFixed ties round up: %s", expr::format_fixed(2.5, 0).c_str());
  CHECK(expr::format_fixed(1.005, 2) == "1.00", "toFixed binary: %s", expr::format_fixed(1.005, 2).c_str());
  CHECK(expr::format_fixed(-1.5, 0) == "-2", "toFixed negative: %s", expr::format_fixed(-1.5, 0).c_str());
  tz::Zone syd; tz::parse("Australia/Sydney", syd);
  CHECK(tz::offset_minutes(syd, 1758441600) == 600, "AEST in September");
  CHECK(tz::offset_minutes(syd, 1767225600) == 660, "AEDT in January");
  tz::Zone off; CHECK(tz::parse("UTC+05:30", off) && off.std_min == 330, "fixed offset parse");
  return finish("expr_test");
}
