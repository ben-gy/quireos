// Host HTTP: libcurl standing in for WiFiClientSecure + HTTPClient.
#include "emu.h"
#include <curl/curl.h>

namespace http {

struct Buf { char *p = nullptr; size_t len = 0, cap = 0, max = 0; bool over = false; };

static size_t onData(char *d, size_t sz, size_t nm, void *ud) {
    Buf *b = (Buf *)ud;
    size_t n = sz * nm;
    if (b->len + n + 1 > b->max) { b->over = true; return 0; }
    if (b->len + n + 1 > b->cap) {
        size_t nc = b->cap ? b->cap * 2 : 65536;
        while (nc < b->len + n + 1) nc *= 2;
        b->p = (char *)realloc(b->p, nc);
        b->cap = nc;
    }
    memcpy(b->p + b->len, d, n);
    b->len += n;
    b->p[b->len] = 0;
    return n;
}

void freeBody(char *b) { free(b); }

bool get(const String &url, char **body, size_t *len, String *contentType, String &err, size_t maxBytes) {
    *body = nullptr; *len = 0;
    static bool inited = false;
    if (!inited) { curl_global_init(CURL_GLOBAL_DEFAULT); inited = true; }
    CURL *c = curl_easy_init();
    if (!c) { err = "curl init failed"; return false; }
    Buf b; b.max = maxBytes;
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_MAXREDIRS, 6L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, HTTP_UA);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, 25L);
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, onData);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &b);
    CURLcode rc = curl_easy_perform(c);
    long code = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
    char *ct = nullptr;
    curl_easy_getinfo(c, CURLINFO_CONTENT_TYPE, &ct);
    if (contentType) *contentType = ct ? ct : "";
    curl_easy_cleanup(c);
    fprintf(stderr, "[http] %ld %zu bytes  %s\n", code, b.len, url.c_str());
    if (b.over) { free(b.p); err = "Page too large"; return false; }
    if (rc != CURLE_OK) { free(b.p); err = String("Connection failed (") + curl_easy_strerror(rc) + ")"; return false; }
    if (code != 200) { free(b.p); err = String("HTTP ") + (int)code; return false; }
    if (b.len == 0) { free(b.p); err = "Empty response"; return false; }
    *body = b.p; *len = b.len;
    return true;
}

}  // namespace http
