// The network task: a queue of FetchRequests served by one worker thread that owns the blocking
// hal::Net::http() call. Responses come back through a mutex-protected queue drained by os::loop().
#pragma once
#include <string>
#include "../runtime/session.h"

namespace quire {
namespace os {
namespace net {

enum Owner : uint8_t { OWNER_SESSION = 1, OWNER_STORE = 2, OWNER_OS = 3 };
static const int QUEUE_DEPTH = 4;

struct Response {
  Owner owner = OWNER_OS;
  uint32_t tag = 0;
  int status = 0;
  int error = 0;
  uint8_t *body = nullptr;      // NUL-terminated; release() frees it
  size_t len = 0;
  char etag[96] = {0};
  char content_type[64] = {0};
  uint32_t elapsed_ms = 0;
  std::string url;
  rt::FetchResult as_result() const {
    rt::FetchResult r;
    r.tag = tag; r.status = status; r.error = error; r.body = body; r.len = len; r.etag = etag; r.content_type = content_type;
    return r;
  }
};

void begin();
bool submit(Owner owner, const rt::FetchRequest &req);   // false when the queue is full
bool take(Response &out);                                 // one completed response, if any
void release(Response &res);
int inflight();                                           // queued + running
bool idle();
void set_locale(const char *locale);

}  // namespace net
}  // namespace os
}  // namespace quire
