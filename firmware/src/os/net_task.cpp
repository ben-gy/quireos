#include "net_task.h"
#include <stdio.h>
#include <string.h>
#include <deque>
#include <vector>
#include "../hal/hal.h"
#include "os.h"
#include "prefs.h"

namespace quire {
namespace os {
namespace net {

namespace {
struct Job {
  Owner owner;
  uint32_t tag;
  std::string method, url, body;
  std::vector<std::string> headers;
  size_t max_bytes;
  uint32_t timeout_ms;
};
void *g_mutex = nullptr;
std::deque<Job> g_queue;
std::deque<Response> g_done;
int g_running = 0;
std::string g_locale = "en-AU";
bool g_started = false;

void worker(void *) {
  while (true) {
    hal::mutex_lock(g_mutex);
    if (g_queue.empty()) { hal::mutex_unlock(g_mutex); hal::delay_ms(10); continue; }
    Job job = g_queue.front();
    g_queue.pop_front();
    g_running++;
    hal::mutex_unlock(g_mutex);

    Response res;
    res.owner = job.owner; res.tag = job.tag; res.url = job.url;
    hal::Net *n = hal::board().net;
    if (!n || !n->connected()) {
      res.error = hal::HTTP_ERR_OFFLINE;
    } else {
      std::vector<const char *> hp;
      for (const std::string &h : job.headers) hp.push_back(h.c_str());
      hal::HttpRequest req;
      req.method = job.method.c_str();
      req.url = job.url.c_str();
      req.body = job.body.empty() ? nullptr : (const uint8_t *)job.body.data();
      req.body_len = job.body.size();
      req.headers = hp.data();
      req.header_count = hp.size();
      req.timeout_ms = job.timeout_ms;
      req.max_bytes = job.max_bytes;
      hal::HttpResponse out;
      n->http(req, out);
      res.status = out.status; res.error = out.error; res.body = out.body; res.len = out.len; res.elapsed_ms = out.elapsed_ms;
      memcpy(res.etag, out.etag, sizeof res.etag);
      memcpy(res.content_type, out.content_type, sizeof res.content_type);
    }
    hal::mutex_lock(g_mutex);
    g_done.push_back(res);
    g_running--;
    hal::mutex_unlock(g_mutex);
  }
}
}  // namespace

void begin() {
  if (g_started) return;
  g_mutex = hal::mutex_create();
  g_started = hal::thread_start("net", worker, nullptr, 16 * 1024, 1);
}

void set_locale(const char *l) { if (l && *l) g_locale = l; }

bool submit(Owner owner, const rt::FetchRequest &req) {
  if (!g_started) begin();
  hal::mutex_lock(g_mutex);
  if ((int)g_queue.size() >= QUEUE_DEPTH) { hal::mutex_unlock(g_mutex); return false; }
  Job job;
  job.owner = owner; job.tag = req.tag; job.method = req.method; job.url = req.url; job.body = req.body;
  job.max_bytes = req.max_bytes; job.timeout_ms = 10000;
  hal::Board &b = hal::board();
  char screen[32];
  hal::screen_string(screen, sizeof screen);
  job.headers.push_back(std::string("User-Agent: QuireOS/") + b.os_version + " (" + b.profile + ")");
  job.headers.push_back(std::string("X-Device-Id: ") + hal::device_hw_id());
  job.headers.push_back(std::string("X-OS-Version: ") + b.os_version);
  job.headers.push_back("X-Spec-Version: 1");
  job.headers.push_back(std::string("X-Screen: ") + screen);
  job.headers.push_back("X-Timezone: " + prefs::tz());
  job.headers.push_back("X-Locale: " + g_locale);
  job.headers.push_back(std::string("Accept: ") + (req.accept ? req.accept : "application/json"));
  for (const std::string &h : req.headers) job.headers.push_back(h);
  g_queue.push_back(job);
  hal::mutex_unlock(g_mutex);
  return true;
}

bool take(Response &out) {
  if (!g_started) return false;
  hal::mutex_lock(g_mutex);
  if (g_done.empty()) { hal::mutex_unlock(g_mutex); return false; }
  out = g_done.front();
  g_done.pop_front();
  hal::mutex_unlock(g_mutex);
  return true;
}

void release(Response &res) {
  if (res.body && hal::board().net) hal::board().net->http_free(res.body);
  res.body = nullptr; res.len = 0;
}

int inflight() {
  if (!g_started) return 0;
  hal::mutex_lock(g_mutex);
  int n = (int)g_queue.size() + g_running;
  hal::mutex_unlock(g_mutex);
  return n;
}
bool idle() { return inflight() == 0; }

}  // namespace net
}  // namespace os
}  // namespace quire
