// QuireOS emulator: the OS core on the host board with an HTTP frame server.
//   quireos-emu [--device t5pro|trmnl] [--port 8087] [--data emu/data] [--log error|warn|info|debug]
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <string>
#include <vector>
#include "../src/boards/host/host_board.h"
#include "../src/os/os.h"
#include "server.h"

using namespace quire;

static std::vector<std::string> g_argv;
static std::string g_device = "t5pro";

static void restart_with(const char *preset) {
  fprintf(stderr, "[emu] restarting as %s\n", preset);
  std::vector<std::string> args;
  args.push_back(g_argv[0]);
  bool had = false;
  for (size_t i = 1; i < g_argv.size(); i++) {
    if (g_argv[i] == "--device" && i + 1 < g_argv.size()) { args.push_back("--device"); args.push_back(preset); had = true; i++; continue; }
    args.push_back(g_argv[i]);
  }
  if (!had) { args.push_back("--device"); args.push_back(preset); }
  std::vector<char *> cargs;
  for (std::string &s : args) cargs.push_back(&s[0]);
  cargs.push_back(nullptr);
  execv(cargs[0], cargs.data());
  perror("execv");
  exit(1);
}
static void reboot_self() { restart_with(g_device.c_str()); }
static void wake(hal::WakeCause cause) {
  fprintf(stderr, "[emu] wake (%s)\n", cause == hal::WakeCause::TIMER ? "timer" : "input");
  host::wake(cause);
  os::setup();                     // deep sleep on a real board ends in a reboot
}

int main(int argc, char **argv) {
  int port = 8087;
  std::string data = "emu/data";
  hal::LogLevel level = hal::LOG_INFO;
  for (int i = 0; i < argc; i++) g_argv.push_back(argv[i]);
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--device") && i + 1 < argc) g_device = argv[++i];
    else if (!strcmp(argv[i], "--port") && i + 1 < argc) port = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--data") && i + 1 < argc) data = argv[++i];
    else if (!strcmp(argv[i], "--log") && i + 1 < argc) {
      const char *l = argv[++i];
      level = !strcmp(l, "error") ? hal::LOG_ERROR : !strcmp(l, "warn") ? hal::LOG_WARN : !strcmp(l, "debug") ? hal::LOG_DEBUG : hal::LOG_INFO;
    } else if (!strcmp(argv[i], "--help")) {
      printf("usage: quireos-emu [--device t5pro|trmnl] [--port N] [--data DIR] [--log LEVEL]\n");
      return 0;
    }
  }
  if (!host::find_preset(g_device.c_str())) { fprintf(stderr, "unknown device preset '%s'\n", g_device.c_str()); return 1; }
  host::set_log_level(level);
  host::set_reboot_handler(reboot_self);
  host::init(g_device.c_str(), data, QUIREOS_VERSION);
  emu::ServerHooks hooks;
  hooks.restart = restart_with;
  hooks.wake = wake;
  if (!emu::start(port, hooks)) return 1;
  fprintf(stderr, "\n  QuireOS emulator (%s):  http://127.0.0.1:%d/   settings page: http://127.0.0.1:%d/os\n\n",
          host::current_preset()->title, port, port);
  os::setup();
  while (true) {
    emu::poll_once(host::asleep() ? 50 : 5);
    if (host::asleep()) {
      uint32_t dl = host::sleep_deadline_ms();
      if (dl && (int32_t)(hal::millis() - dl) >= 0) wake(hal::WakeCause::TIMER);
      continue;
    }
    os::loop();
  }
}
