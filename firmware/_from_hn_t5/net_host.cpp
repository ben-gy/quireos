// Host network: the Mac is always online, so Wi-Fi is a no-op.
#include "emu.h"
namespace net {
bool haveCreds() { return true; }
bool connect(uint32_t) { return true; }
bool isUp() { return true; }
void syncTime() {}
void ensureUp() {}
void runPortal() { fprintf(stderr, "[emu] Wi-Fi setup portal is not applicable on the host\n"); }
}

namespace light { void set(int level) { fprintf(stderr, "[emu] frontlight %d\n", level); } }
int batteryPercent() { return 72; }
