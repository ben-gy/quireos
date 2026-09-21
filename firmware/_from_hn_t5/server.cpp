// Emulator host: runs the real UI on a tiny HTTP server so the device screen
// can be viewed and driven from a browser.
//   GET  /            page
//   GET  /frame.bmp   current framebuffer
//   GET  /ver         "<frame version> <asleep 0|1>"
//   POST /g?k=short|long|double   button gesture
//   POST /tap?x=&y=               touch (queued; UI support is the next step)
#include "emu.h"
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_sleep.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>
#include <unistd.h>
#include <sys/stat.h>
#include <string>
#include <vector>

SerialClass  Serial;
EspClass     ESP;
WiFiClass    WiFi;
LittleFSClass LittleFS;
bool emu_asleep = false;
static int g_wakeCause = ESP_SLEEP_WAKEUP_UNDEFINED;

struct SleepReq {};
struct RestartReq {};
void EspClass::restart() { fprintf(stderr, "[emu] ESP.restart()\n"); throw RestartReq{}; }
int  esp_sleep_get_wakeup_cause() { return g_wakeCause; }
void esp_sleep_enable_ext0_wakeup(int, int) {}
void esp_deep_sleep_start() { fprintf(stderr, "[emu] deep sleep (any gesture wakes)\n"); throw SleepReq{}; }

static int PORT = 8087;                       // override: hn-emu <port>

// Emulated devices. The Pro is a phone-shaped portrait handheld with touch;
// the TRMNL is a landscape 1-bit panel with no input at all.
struct Device { const char *name, *title; int w, h, bits; bool touch; };
static const Device DEVICES[] = {
    {"t5pro", "LilyGo T5 E-Paper S3 Pro", 540, 960, 4, true},
    {"trmnl", "TRMNL",                    800, 480, 1, false},
};
static const Device *dev = &DEVICES[0];

// ---- framebuffer -> 8-bit greyscale BMP ----------------------------------
static std::vector<uint8_t> frameBmp() {
    const int W = gfx::W(), H = gfx::H();
    const uint32_t pix = W * H, off = 14 + 40 + 256 * 4, total = off + pix;
    std::vector<uint8_t> o(total, 0);
    auto p32 = [&](size_t at, uint32_t v) { o[at] = v; o[at+1] = v >> 8; o[at+2] = v >> 16; o[at+3] = v >> 24; };
    auto p16 = [&](size_t at, uint16_t v) { o[at] = v; o[at+1] = v >> 8; };
    o[0] = 'B'; o[1] = 'M'; p32(2, total); p32(10, off);
    p32(14, 40); p32(18, W); p32(22, H); p16(26, 1); p16(28, 8); p32(34, pix); p32(46, 256); p32(50, 256);
    for (int i = 0; i < 256; i++) { o[54 + i*4] = o[55 + i*4] = o[56 + i*4] = i; }
    for (int y = 0; y < H; y++) {
        uint8_t *row = &o[off + (size_t)(H - 1 - y) * W];
        const uint8_t *src = gfx::fb + (size_t)y * (W / 2);
        for (int x = 0; x < W; x++) {
            uint8_t nib = (x & 1) ? (src[x / 2] >> 4) : (src[x / 2] & 0x0F);
            row[x] = (dev->bits == 1) ? (nib < 12 ? 0 : 255) : nib * 17;   // 1-bit: greys are ink
        }
    }
    return o;
}

// ---- page ----------------------------------------------------------------
static const char *PAGE = R"HTML(<!doctype html><html><head><meta charset=utf-8><title>HN reader - device emulator</title>
<style>
 body{margin:0;background:#1a1a1a;color:#ccc;font:14px -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:16px;gap:14px}
 .pick{display:flex;gap:8px;align-items:center;color:#888}
 .pick button.on{background:#ff6600;color:#000;border-color:#ff6600}
 .dev{display:flex;flex-direction:column;align-items:center;transition:padding .2s}
 .dev.phone{background:#111;border:2px solid #2a2a2a;border-radius:44px;padding:44px 16px 26px;box-shadow:0 18px 50px #000c}
 .dev.phone .btn{width:46px;height:46px;border-radius:50%;border:2px solid #444;margin-top:16px;background:#1c1c1c;box-shadow:inset 0 2px 4px #000}
 .dev.slab{background:#e6e2da;border-radius:14px;padding:26px 30px;box-shadow:0 14px 40px #000a}
 .dev.slab .btn{display:none}
 img{display:block;max-height:78vh;max-width:96vw;width:auto;height:auto;image-rendering:auto;background:#fff;cursor:pointer}
 img.fixed{max-height:none;max-width:none}
 .dev.phone img{border-radius:6px}
 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
 button{background:#333;color:#eee;border:1px solid #555;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer}
 button:hover{background:#444} button:active{background:#ff6600;color:#000}
 kbd{background:#222;border:1px solid #555;border-radius:4px;padding:1px 6px;font-size:12px;color:#aaa}
 #st{color:#888;font-size:12px;min-width:200px}
 p{color:#777;max-width:720px;font-size:13px;line-height:1.5;margin:0}
</style></head><body>
<div class=pick>Size:
 <button id=s-1 onclick="setScale(1)">Actual</button>
 <button id=s-2 onclick="setScale(2)">2x</button>
 <button id=s-0 onclick="setScale(0)">Fit</button>
 &nbsp;&nbsp; Device:
 <button id=d-t5pro onclick="setDev('t5pro')">T5 E-Paper S3 Pro (phone, touch)</button>
 <button id=d-trmnl onclick="setDev('trmnl')">TRMNL (7.5", 1-bit)</button>
</div>
<div class=dev id=dev>
 <img id=f src="/frame.bmp" alt="device screen">
 <div class=btn title="hardware button"></div>
</div>
<div class=bar>
  <button data-g=short>Short press <kbd>Space</kbd></button>
  <button data-g=long>Long press <kbd>Enter</kbd></button>
  <button data-g=double>Double press <kbd>Backspace</kbd></button>
  <span id=st>connecting</span>
</div>
<p>The real firmware UI built for macOS: the panel, button and radio are swapped for host versions, and text is drawn by the device's own glyph renderer. Live Hacker News data. Tap stories, pills and pages directly on the phone; the physical-button gestures (short = move, long = activate, double = back) work on both devices.</p>
<script>
 const f=document.getElementById('f'), st=document.getElementById('st'), devEl=document.getElementById('dev');
 let ver=-1, info={w:540,h:960,name:'t5pro',touch:true};
 let scale=0;
 function applyScale(){
   if(scale===0){ f.classList.remove('fixed'); f.style.width=''; f.style.height=''; }
   else { const dpi = info.name==='trmnl' ? 125 : 235;      // panel pixel density
          const cssW = info.w / dpi * 96 * scale;           // 96 css px per inch
          f.classList.add('fixed'); f.style.width=cssW+'px'; f.style.height=(cssW*info.h/info.w)+'px'; }
   document.querySelectorAll('.pick button[id^=s-]').forEach(b=>b.classList.toggle('on',b.id==='s-'+scale));
 }
 function setScale(v){ scale=v; applyScale(); }
 async function loadInfo(){ info=await (await fetch('/info')).json();
   f.width=info.w; f.height=info.h; applyScale();
   devEl.className='dev '+(info.w<info.h?'phone':'slab');
   document.querySelectorAll('.pick button').forEach(b=>b.classList.toggle('on',b.id==='d-'+info.name));
   ver=-1; }
 async function tick(){
   try{ const t=await (await fetch('/ver')).text(); const [v,a]=t.trim().split(' ');
        if(+v!==ver){ ver=+v; f.src='/frame.bmp?'+ver; }
        st.textContent=(a==='1'?'asleep - any press wakes it':'awake')+'  |  '+info.w+'x'+info.h+'  |  frame '+ver; }
   catch(e){ st.textContent='emulator not responding'; }
   setTimeout(tick,250);
 }
 async function setDev(n){ await fetch('/dev?d='+n,{method:'POST'}); await loadInfo(); }
 function g(k){ fetch('/g?k='+k,{method:'POST'}); st.textContent='sent '+k; }
 document.querySelectorAll('button[data-g]').forEach(b=>b.onclick=()=>g(b.dataset.g));
 document.addEventListener('keydown',e=>{
   if(e.code==='Space'){e.preventDefault();g('short');}
   else if(e.code==='Enter'){e.preventDefault();g('long');}
   else if(e.code==='Backspace'){e.preventDefault();g('double');}
 });
 f.addEventListener('click',e=>{
   const r=f.getBoundingClientRect();
   const x=Math.round((e.clientX-r.left)*info.w/r.width), y=Math.round((e.clientY-r.top)*info.h/r.height);
   fetch('/tap?x='+x+'&y='+y,{method:'POST'}); st.textContent='tap '+x+','+y;
 });
 loadInfo().then(tick);
</script></body></html>)HTML";

// ---- minimal HTTP --------------------------------------------------------
static void sendAll(int fd, const void *d, size_t n) {
    const char *p = (const char *)d;
    while (n) { ssize_t k = send(fd, p, n, 0); if (k <= 0) return; p += k; n -= k; }
}
static void respond(int fd, const char *status, const char *ctype, const void *body, size_t n) {
    char h[256];
    int hl = snprintf(h, sizeof h, "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\n"
                      "Cache-Control: no-store\r\nConnection: close\r\n\r\n", status, ctype, n);
    sendAll(fd, h, hl);
    sendAll(fd, body, n);
}
static int qint(const std::string &q, const char *key, int def) {
    size_t p = q.find(std::string(key) + "=");
    return p == std::string::npos ? def : atoi(q.c_str() + p + strlen(key) + 1);
}
static std::string qstr(const std::string &q, const char *key) {
    size_t p = q.find(std::string(key) + "=");
    if (p == std::string::npos) return "";
    p += strlen(key) + 1;
    size_t e = q.find('&', p);
    return q.substr(p, e == std::string::npos ? std::string::npos : e - p);
}

static void runBegin() {
    try { ui::begin(); }
    catch (SleepReq &) { emu_asleep = true; }
    catch (RestartReq &) { runBegin(); }
}

// Returns an action to run after the response has been sent (so the page is
// never left waiting on a network fetch).
enum Deferred { D_NONE, D_WAKE, D_TAP, D_DEV };
static int pendingX = 0, pendingY = 0;
static const Device *pendingDev = nullptr;

static Deferred handle(int fd) {
    char buf[8192];
    ssize_t n = recv(fd, buf, sizeof buf - 1, 0);
    if (n <= 0) return D_NONE;
    buf[n] = 0;
    std::string req(buf), method, target;
    size_t sp1 = req.find(' '), sp2 = req.find(' ', sp1 + 1);
    if (sp1 == std::string::npos || sp2 == std::string::npos) return D_NONE;
    method = req.substr(0, sp1);
    target = req.substr(sp1 + 1, sp2 - sp1 - 1);
    std::string path = target, query;
    size_t qm = target.find('?');
    if (qm != std::string::npos) { path = target.substr(0, qm); query = target.substr(qm + 1); }

    if (path == "/") { respond(fd, "200 OK", "text/html; charset=utf-8", PAGE, strlen(PAGE)); return D_NONE; }
    if (path == "/frame.bmp") { auto b = frameBmp(); respond(fd, "200 OK", "image/bmp", b.data(), b.size()); return D_NONE; }
    if (path == "/info") {
        char s[160];
        int l = snprintf(s, sizeof s, "{\"name\":\"%s\",\"title\":\"%s\",\"w\":%d,\"h\":%d,\"bits\":%d,\"touch\":%s}",
                         dev->name, dev->title, dev->w, dev->h, dev->bits, dev->touch ? "true" : "false");
        respond(fd, "200 OK", "application/json", s, l); return D_NONE;
    }
    if (path == "/dev") {
        std::string d = qstr(query, "d");
        for (auto &D : DEVICES) if (d == D.name) pendingDev = &D;
        respond(fd, "200 OK", "text/plain", "ok", 2);
        return pendingDev ? D_DEV : D_NONE;
    }
    if (path == "/ver") {
        char s[32]; int l = snprintf(s, sizeof s, "%d %d", emu_frameVersion, emu_asleep ? 1 : 0);
        respond(fd, "200 OK", "text/plain", s, l); return D_NONE;
    }
    if (path == "/g") {
        std::string k = qstr(query, "k");
        Gesture g = k == "long" ? G_LONG : k == "double" ? G_DOUBLE : G_SHORT;
        respond(fd, "200 OK", "text/plain", "ok", 2);
        if (emu_asleep) return D_WAKE;          // the press itself is the wake-up
        emu_pushGesture(g);
        return D_NONE;
    }
    if (path == "/tap") {
        int x = qint(query, "x", -1), y = qint(query, "y", -1);
        respond(fd, "200 OK", "text/plain", "ok", 2);
        fprintf(stderr, "[emu] tap %d,%d\n", x, y);
        if (emu_asleep) return D_WAKE;
        pendingX = x; pendingY = y;
        return D_TAP;
    }
    respond(fd, "404 Not Found", "text/plain", "no", 2);
    return D_NONE;
}

int main(int argc, char **argv) {
    if (argc > 1 && atoi(argv[1]) > 0) PORT = atoi(argv[1]);
    mkdir("emu", 0755); mkdir("emu/data", 0755);   // state lives under the working directory
    store::begin();
    if (!gfx::begin()) { fprintf(stderr, "framebuffer alloc failed\n"); return 1; }
    gfx_host_setSize(dev->w, dev->h);
    gfx::setDark(store::dark());

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(PORT); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(srv, (sockaddr *)&a, sizeof a) != 0) { perror("bind"); return 1; }
    listen(srv, 8);
    fprintf(stderr, "\n  HN reader emulator:  http://127.0.0.1:%d/\n\n", PORT);

    runBegin();
    while (true) {
        pollfd pf{srv, POLLIN, 0};
        if (poll(&pf, 1, 15) > 0) {
            int fd = accept(srv, nullptr, nullptr);
            if (fd >= 0) {
                timeval tv{2, 0};
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
                Deferred d = handle(fd);
                close(fd);
                if (d == D_WAKE) { emu_asleep = false; g_wakeCause = ESP_SLEEP_WAKEUP_EXT0; runBegin(); }
                else if (d == D_TAP) {
                    try { ui::tap(pendingX, pendingY); }
                    catch (SleepReq &) { emu_asleep = true; }
                    catch (RestartReq &) { runBegin(); }
                }
                else if (d == D_DEV) {
                    dev = pendingDev; pendingDev = nullptr;
                    fprintf(stderr, "[emu] device -> %s (%dx%d)\n", dev->title, dev->w, dev->h);
                    gfx_host_setSize(dev->w, dev->h);
                    gfx::setDark(store::dark());
                    emu_asleep = false; g_wakeCause = ESP_SLEEP_WAKEUP_UNDEFINED;
                    runBegin();
                }
            }
        }
        if (!emu_asleep) {
            try { ui::tick(); }
            catch (SleepReq &) { emu_asleep = true; }
            catch (RestartReq &) { runBegin(); }
        }
    }
}
