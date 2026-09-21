#include "app.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_heap_caps.h>

namespace http {

// HTTPClient::writeToStream() unwraps chunked transfer-encoding for us, but it
// pushes rather than pulls, so collect the body into a growable PSRAM buffer.
class PsramSink : public Stream {
public:
    explicit PsramSink(size_t maxBytes) : maxB(maxBytes) {}
    int available() override { return 0; }
    int read() override      { return -1; }
    int peek() override      { return -1; }
    void flush() override    {}
    size_t write(uint8_t b) override { return write(&b, 1); }
    size_t write(const uint8_t *d, size_t n) override {
        if (!ensure(len + n + 1)) return 0;
        memcpy(buf + len, d, n);
        len += n;
        buf[len] = 0;
        return n;
    }
    char *release() { char *b = buf; buf = nullptr; return b; }
    size_t size() const { return len; }
    bool overflowed = false;
    ~PsramSink() { if (buf) heap_caps_free(buf); }

private:
    bool ensure(size_t need) {
        if (need <= cap) return true;
        if (need > maxB) { overflowed = true; return false; }
        size_t ncap = cap ? cap * 2 : 32768;
        while (ncap < need) ncap *= 2;
        if (ncap > maxB) ncap = maxB;
        char *nb = (char *)heap_caps_realloc(buf, ncap, MALLOC_CAP_SPIRAM);
        if (!nb) { overflowed = true; return false; }
        buf = nb;
        cap = ncap;
        return true;
    }
    char  *buf = nullptr;
    size_t cap = 0, len = 0, maxB;
};

void freeBody(char *body) { if (body) heap_caps_free(body); }

bool get(const String &url, char **body, size_t *len, String *contentType, String &err,
         size_t maxBytes) {
    *body = nullptr;
    *len = 0;
    if (WiFi.status() != WL_CONNECTED) { err = "No Wi-Fi connection"; return false; }

    WiFiClientSecure secure;
    secure.setInsecure();                 // no cert pinning; nothing secret is sent
    secure.setTimeout(20);
    WiFiClient plain;
    bool https = url.startsWith("https:");

    HTTPClient h;
    h.setUserAgent(HTTP_UA);
    h.setTimeout(20000);
    h.setConnectTimeout(10000);
    h.setReuse(false);
    h.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    h.setRedirectLimit(6);
    const char *hdrs[] = {"Content-Type"};
    bool started = https ? h.begin(secure, url) : h.begin(plain, url);
    if (!started) { err = "Bad URL"; return false; }
    h.collectHeaders(hdrs, 1);

    int code = h.GET();
    if (code != HTTP_CODE_OK) {
        err = (code > 0) ? String("HTTP ") + code : String("Connection failed (") + code + ")";
        h.end();
        return false;
    }
    if (contentType) *contentType = h.header("Content-Type");

    PsramSink sink(maxBytes);
    h.writeToStream(&sink);
    h.end();

    if (sink.overflowed) { err = "Page too large"; return false; }
    if (sink.size() == 0) { err = "Empty response"; return false; }
    *len = sink.size();
    *body = sink.release();
    return true;
}

}  // namespace http
