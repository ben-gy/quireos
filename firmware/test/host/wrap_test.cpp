// Checks wrap() against spec/conformance/wrap.json; with --generate writes that file from the
// firmware's own implementation (the SDK verifies against it).
#include "../../src/runtime/wrap.h"
#include "test_util.h"
#include <vector>

using namespace quire;

struct Case { const char *size, *weight; int w, lines; const char *text; };
static const Case GEN_CASES[] = {
  {"md", "regular", 300, 3, "The quick brown fox jumps over the lazy dog"},
  {"md", "regular", 300, 1, "The quick brown fox jumps over the lazy dog"},
  {"md", "regular", 300, 2, "The quick brown fox jumps over the lazy dog"},
  {"md", "bold", 300, 3, "The quick brown fox jumps over the lazy dog"},
  {"sm", "regular", 200, 4, "Home Assistant is reachable on your LAN at homeassistant.local:8123"},
  {"xs", "regular", 120, 8, "Supercalifragilisticexpialidocious is a long word"},
  {"lg", "bold", 400, 2, "Pool Lights"},
  {"md", "regular", 492, 3, "This screen is a static JSON file. The device draws it and handles taps; there is no server."},
  {"md", "regular", 300, 2, "Line one\nLine two\nLine three"},
  {"md", "regular", 300, 4, "Line one\nLine two\nLine three"},
  {"md", "regular", 300, 3, "a\n\nb"},
  {"md", "regular", 300, 3, ""},
  {"md", "regular", 300, 3, "Ends with a newline\n"},
  {"md", "regular", 300, 2, "double  space  between  words"},
  {"md", "regular", 300, 2, " leading and trailing spaces "},
  {"2xl", "bold", 500, 2, "Zürich café — 21.5°C"},
  {"md", "regular", 10, 3, "tiny width forces one glyph per line"},
  {"md", "regular", 300, 1, "Short"},
  {"md", "regular", 300, 1, "An overflowing single line that must end with an ellipsis character"},
  {"sm", "bold", 238, 2, "Kitchen ceiling downlights"},
  {"xl", "regular", 540, 2, "Hello, Kitchen"},
  {"3xl", "bold", 540, 1, "Wednesday afternoon"},
  {"digits", "bold", 540, 1, "21.5°"},
  {"md", "regular", 300, 3, "https://example.com/a/very/long/path/without/any/spaces/in/it/at/all"},
  {"xs", "regular", 300, 2, "Tabs\tand\tunknown glyphs → fall back to ? advances"},
  {"md", "regular", 300, 8, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"},
};

static std::string json_escape(const std::string &s) {
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o.push_back('\\'); o.push_back((char)c); }
    else if (c == '\n') o += "\\n";
    else if (c == '\t') o += "\\t";
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o.push_back((char)c);
  }
  return o;
}

static int do_wrap(const char *size, const char *weight, int w, int lines, const char *text, std::vector<std::string> &out) {
  fontlib::Size s; fontlib::Weight wt;
  if (!fontlib::size_from_name(size, s) || !fontlib::weight_from_name(weight, wt)) return -1;
  const fontlib::Font *f = fontlib::font(s, wt);
  std::string buf(strlen(text) + 64, '\0');
  wrap::Line ls[8];
  int n = wrap::wrap(f, text, w, lines, &buf[0], buf.size(), ls, 8);
  out.clear();
  for (int i = 0; i < n; i++) out.push_back(std::string(ls[i].text, ls[i].len));
  return n;
}

int main(int argc, char **argv) {
  std::string root = repo_root(argc, argv);
  bool generate = false;
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "--generate")) generate = true;
  std::string path = root + "/spec/conformance/wrap.json";
  if (generate) {
    FILE *f = fopen(path.c_str(), "wb");
    if (!f) { printf("cannot write %s\n", path.c_str()); return 1; }
    fprintf(f, "[\n");
    size_t n = sizeof GEN_CASES / sizeof GEN_CASES[0];
    for (size_t i = 0; i < n; i++) {
      const Case &c = GEN_CASES[i];
      std::vector<std::string> lines;
      do_wrap(c.size, c.weight, c.w, c.lines, c.text, lines);
      fprintf(f, "  { \"profile\": \"t5pro\", \"size\": \"%s\", \"weight\": \"%s\", \"w\": %d, \"lines\": %d, \"text\": \"%s\", \"expected\": [",
              c.size, c.weight, c.w, c.lines, json_escape(c.text).c_str());
      for (size_t j = 0; j < lines.size(); j++) fprintf(f, "%s\"%s\"", j ? ", " : "", json_escape(lines[j]).c_str());
      fprintf(f, "] }%s\n", i + 1 < n ? "," : "");
    }
    fprintf(f, "]\n");
    fclose(f);
    printf("wrote %zu cases to %s\n", n, path.c_str());
  }
  std::string text;
  if (!read_file(path, text)) { printf("missing %s (run with --generate)\n", path.c_str()); return 1; }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, text);
  CHECK(!err, "wrap.json: %s", err.c_str());
  int n = 0;
  for (JsonObjectConst c : doc.as<JsonArrayConst>()) {
    n++;
    if (strcmp(c["profile"] | "t5pro", "t5pro")) continue;
    std::vector<std::string> got;
    int cnt = do_wrap(c["size"] | "md", c["weight"] | "regular", c["w"] | 0, c["lines"] | 1, c["text"] | "", got);
    JsonArrayConst want = c["expected"];
    CHECK(cnt == (int)want.size(), "case %d '%s': %d lines, want %d", n, c["text"] | "", cnt, (int)want.size());
    for (size_t i = 0; i < got.size() && i < want.size(); i++)
      CHECK(got[i] == (want[i] | ""), "case %d line %zu: got '%s' want '%s'", n, i, got[i].c_str(), want[i] | "");
  }
  // Invariants: every produced line fits (except the unavoidable single-glyph case).
  {
    std::vector<std::string> lines;
    const fontlib::Font *f = fontlib::font(fontlib::Size::MD, fontlib::Weight::REGULAR);
    do_wrap("md", "regular", 300, 8, "The quick brown fox jumps over the lazy dog and keeps running", lines);
    for (auto &l : lines) CHECK(fontlib::text_width(f, l.c_str()) <= 300, "line '%s' too wide", l.c_str());
    CHECK(fontlib::text_width(f, "…") > 0, "ellipsis glyph present");
  }
  printf("  %d wrap cases\n", n);
  return finish("wrap_test");
}
