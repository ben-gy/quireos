// Tiny test helpers shared by the host tests (plain C++17, no framework).
#pragma once
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include "../../src/runtime/third_party/ArduinoJson.h"

static int g_checks = 0, g_failures = 0;
#define CHECK(cond, ...) do { g_checks++; if (!(cond)) { g_failures++; printf("  FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static inline bool read_file(const std::string &path, std::string &out) {
  FILE *f = fopen(path.c_str(), "rb");
  if (!f) return false;
  char buf[8192];
  size_t n;
  out.clear();
  while ((n = fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
  fclose(f);
  return true;
}

static inline std::string repo_root(int argc, char **argv) {
  if (argc > 1) return argv[1];
  const char *e = getenv("QUIREOS_ROOT");
  return e ? e : "../..";
}

static inline int finish(const char *name) {
  printf("%s: %d checks, %d failures\n", name, g_checks, g_failures);
  return g_failures ? 1 : 0;
}
