// Exercises the host board through hal.h only: every interface a port must satisfy.
#include "../../src/boards/host/host_board.h"
#include "../../src/hal/hal.h"
#include "test_util.h"
#include <unistd.h>

using namespace quire;

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  char dir[] = "/tmp/quireos-hal-XXXXXX";
  std::string data = mkdtemp(dir);
  host::init("trmnl", data, "0.0.0-test");
  hal::Board &b = hal::board();
  CHECK(b.display && b.input && b.power && b.clock && b.storage && b.net, "all devices present");
  CHECK(strlen(hal::device_hw_id()) == 12, "hw id is 12 hex chars: %s", hal::device_hw_id());

  // Display: begin, rotation, logical size, quantisation on a 1-bit preset.
  CHECK(b.display->begin(b.default_rotation), "display begin");
  CHECK(b.display->width() == 800 && b.display->height() == 480, "trmnl logical size %ux%u", b.display->width(), b.display->height());
  b.display->set_rotation(hal::Rotation::R90);
  CHECK(b.display->width() == 480 && b.display->height() == 800, "rotated size");
  b.display->set_rotation(b.default_rotation);
  char s[32];
  hal::screen_string(s, sizeof s);
  CHECK(!strcmp(s, "800x480x2@125"), "screen string %s", s);

  hal::Framebuffer fb;
  fb.w = b.display->width(); fb.h = b.display->height();
  fb.data = (uint8_t *)hal::alloc_big(fb.bytes());
  fb.fill(15);
  hal::Rect r; r.x = 10; r.y = 10; r.w = 20; r.h = 5;
  fb.fill_rect(r, 3);
  CHECK(fb.get(10, 10) == 3 && fb.get(29, 14) == 3 && fb.get(30, 10) == 15 && fb.get(9, 10) == 15, "fill_rect bounds");
  fb.invert_rect(r);
  CHECK(fb.get(10, 10) == 12 && fb.get(30, 10) == 15, "invert_rect");
  hal::Rect a; a.x = 0; a.y = 0; a.w = 10; a.h = 10;
  hal::Rect c; c.x = 5; c.y = 5; c.w = 10; c.h = 10;
  hal::Rect u = a.united(c), k = a.clipped(c);
  CHECK(u.x == 0 && u.w == 15 && k.x == 5 && k.w == 5, "united/clipped");
  CHECK(a.clipped(hal::Rect{20, 20, 5, 5}).empty(), "disjoint clip is empty");
  uint32_t v0 = host::frame_version();
  fb.fill(9);
  b.display->present(fb, r, hal::UpdateMode::PARTIAL);
  CHECK(host::frame_version() > v0, "present bumps the frame version");
  CHECK(host::panel().get(0, 0) == 15, "1-bit quantisation: 9 -> white");
  fb.fill(6);
  b.display->present(fb, r, hal::UpdateMode::FULL);
  CHECK(host::panel().get(0, 0) == 0, "1-bit quantisation: 6 -> black");
  CHECK(!b.display->caps().partial_update, "trmnl has no partial updates");

  // Input.
  CHECK(b.input->begin(), "input begin");
  hal::Event e;
  CHECK(!b.input->poll(e), "no events initially");
  host::push_tap(12, 34, false);
  host::push_button(1, hal::Gesture::LONG);
  CHECK(b.input->poll(e) && e.kind == hal::Event::TAP && e.x == 12 && e.y == 34, "tap event");
  CHECK(b.input->poll(e) && e.kind == hal::Event::BUTTON && e.button == 1 && e.gesture == hal::Gesture::LONG, "button event");
  CHECK(!b.input->caps().touch, "trmnl has no touch");

  // Power.
  CHECK(b.power->battery_percent() >= -1 && b.power->battery_percent() <= 100, "battery range");
  CHECK(b.power->wake_cause() == hal::WakeCause::POWER_ON, "initial wake cause");
  hal::WakeSources ws; ws.touch = true; ws.timer_ms = 1000;
  b.power->sleep(ws);
  CHECK(host::asleep(), "host sleep marks asleep");
  host::wake(hal::WakeCause::TIMER);
  CHECK(!host::asleep() && b.power->wake_cause() == hal::WakeCause::TIMER, "wake");

  // Clock.
  int64_t now = b.clock->now();
  CHECK(now > 1700000000, "clock is sane");
  b.clock->set(now + 100);
  CHECK(b.clock->now() >= now + 99, "clock set");
  b.clock->set(now);

  // Storage.
  CHECK(b.storage->begin(), "storage begin");
  char buf[64];
  CHECK(!b.storage->kv_get("missing", buf, sizeof buf), "missing key");
  CHECK(b.storage->kv_set("k1", "hello \"world\"\n") && b.storage->kv_get("k1", buf, sizeof buf) && !strcmp(buf, "hello \"world\"\n"), "kv roundtrip with escapes");
  CHECK(b.storage->kv_remove("k1") && !b.storage->kv_get("k1", buf, sizeof buf), "kv remove");
  const uint8_t blob[] = {1, 2, 3, 0, 255};
  CHECK(b.storage->file_mkdir("/apps/x"), "mkdir");
  CHECK(b.storage->file_write("/apps/x/f.bin", blob, sizeof blob), "file write");
  CHECK(b.storage->file_exists("/apps/x/f.bin"), "file exists");
  uint8_t *rd = nullptr; size_t len = 0;
  CHECK(b.storage->file_read("/apps/x/f.bin", &rd, &len) && len == 5 && rd[4] == 255, "file read");
  b.storage->file_free(rd);
  int entries = b.storage->file_list("/apps/x", [](const char *n, size_t sz, bool d, void *ctx) { (void)n; (void)sz; (void)d; (*(int *)ctx)++; }, &entries);
  CHECK(entries >= 1, "file list");
  CHECK(b.storage->file_remove("/apps/x") && !b.storage->file_exists("/apps/x/f.bin"), "recursive remove");
  CHECK(b.storage->free_bytes() > 0, "free bytes");

  // Net (no real network needed: an unreachable local port maps to a connect error).
  CHECK(b.net->begin() && b.net->connected(), "net begin");
  hal::HttpRequest req; req.url = "http://127.0.0.1:9"; req.timeout_ms = 2000;
  hal::HttpResponse res;
  bool ok = b.net->http(req, res);
  CHECK(!ok && (res.error == hal::HTTP_ERR_CONNECT || res.error == hal::HTTP_ERR_TIMEOUT || res.error == hal::HTTP_ERR_PROTOCOL), "connect error mapped (%d)", res.error);
  b.net->http_free(res.body);

  // System.
  uint32_t t0 = hal::millis();
  hal::delay_ms(15);
  CHECK(hal::millis() - t0 >= 10, "millis/delay");
  void *m = hal::mutex_create();
  hal::mutex_lock(m); hal::mutex_unlock(m);
  static volatile int ran = 0;
  CHECK(hal::thread_start("t", [](void *) { ran = 1; }, nullptr, 4096, 1), "thread start");
  for (int i = 0; i < 100 && !ran; i++) hal::delay_ms(5);
  CHECK(ran == 1, "thread ran");
  CHECK(hal::random_u32() != hal::random_u32() || hal::random_u32() != hal::random_u32(), "random");
  hal::free_big(fb.data);
  return finish("hal_contract_test");
}
