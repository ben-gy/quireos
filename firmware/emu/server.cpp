// Emulator HTTP server (port 8087 by default). Runs on the main thread between os::loop() calls.
//   GET  /             page showing the frame; taps and button gestures post back
//   GET  /frame.bmp    current panel as an 8-bit grey BMP (quantised to the preset's greys)
//   GET  /frame.png    same as PNG
//   GET  /info         JSON: device, size, mode, heap, frame version, asleep
//   GET  /ver          "<frame> <asleep>"
//   POST /tap?x=&y=[&hold=1]   touch; wakes the device when asleep
//   POST /g?k=short|long|double[&b=<id>]   button gesture
//   POST /dev?d=t5pro|trmnl    switch preset and restart
//   *    /os/*         forwarded to quire::os::web::handle()
#include "server.h"
#include <arpa/inet.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include <zlib.h>
#include <string>
#include <vector>
#include "../src/boards/host/host_board.h"
#include "../src/os/web_api.h"

namespace emu {

using namespace quire;

static int g_srv = -1;
static ServerHooks g_hooks;
static std::string g_pending_restart;

static std::vector<uint8_t> frame_bmp() {
  const hal::Framebuffer &p = host::panel();
  const int W = p.w, H = p.h;
  const uint32_t rowbytes = (uint32_t)((W + 3) & ~3), off = 14 + 40 + 256 * 4, total = off + rowbytes * (uint32_t)H;
  std::vector<uint8_t> o(total, 0);
  auto p32 = [&](size_t at, uint32_t v) { o[at] = (uint8_t)v; o[at + 1] = (uint8_t)(v >> 8); o[at + 2] = (uint8_t)(v >> 16); o[at + 3] = (uint8_t)(v >> 24); };
  auto p16 = [&](size_t at, uint16_t v) { o[at] = (uint8_t)v; o[at + 1] = (uint8_t)(v >> 8); };
  o[0] = 'B'; o[1] = 'M'; p32(2, total); p32(10, off);
  p32(14, 40); p32(18, (uint32_t)W); p32(22, (uint32_t)H); p16(26, 1); p16(28, 8); p32(34, rowbytes * (uint32_t)H); p32(46, 256); p32(50, 256);
  for (int i = 0; i < 256; i++) o[54 + i * 4] = o[55 + i * 4] = o[56 + i * 4] = (uint8_t)i;
  for (int y = 0; y < H; y++) {
    uint8_t *row = &o[off + (size_t)(H - 1 - y) * rowbytes];
    for (int x = 0; x < W; x++) row[x] = (uint8_t)(p.get(x, y) * 17);
  }
  return o;
}

static void put32(std::vector<uint8_t> &o, uint32_t v) { o.push_back((uint8_t)(v >> 24)); o.push_back((uint8_t)(v >> 16)); o.push_back((uint8_t)(v >> 8)); o.push_back((uint8_t)v); }
static void chunk(std::vector<uint8_t> &o, const char *type, const std::vector<uint8_t> &data) {
  put32(o, (uint32_t)data.size());
  size_t start = o.size();
  o.insert(o.end(), type, type + 4);
  o.insert(o.end(), data.begin(), data.end());
  uint32_t crc = (uint32_t)crc32(0, o.data() + start, (uInt)(o.size() - start));
  put32(o, crc);
}
static std::vector<uint8_t> frame_png() {
  const hal::Framebuffer &p = host::panel();
  const int W = p.w, H = p.h;
  std::vector<uint8_t> raw((size_t)(W + 1) * H);
  for (int y = 0; y < H; y++) {
    raw[(size_t)y * (W + 1)] = 0;
    for (int x = 0; x < W; x++) raw[(size_t)y * (W + 1) + 1 + x] = (uint8_t)(p.get(x, y) * 17);
  }
  uLongf clen = compressBound((uLong)raw.size());
  std::vector<uint8_t> comp(clen);
  compress2(comp.data(), &clen, raw.data(), (uLong)raw.size(), 6);
  comp.resize(clen);
  std::vector<uint8_t> o = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
  std::vector<uint8_t> ihdr;
  put32(ihdr, (uint32_t)W); put32(ihdr, (uint32_t)H);
  ihdr.push_back(8); ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);
  chunk(o, "IHDR", ihdr);
  chunk(o, "IDAT", comp);
  chunk(o, "IEND", {});
  return o;
}

static const char *PAGE = R"HTML(<!doctype html><html><head><meta charset=utf-8><title>QuireOS emulator</title>
<style>
 body{margin:0;background:#1a1a1a;color:#ccc;font:14px -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:16px;gap:14px}
 .pick{display:flex;gap:8px;align-items:center;color:#888;flex-wrap:wrap;justify-content:center}
 .pick button.on{background:#4a9;color:#000;border-color:#4a9}
 .dev{display:flex;flex-direction:column;align-items:center}
 .dev.phone{background:#111;border:2px solid #2a2a2a;border-radius:44px;padding:44px 16px 26px;box-shadow:0 18px 50px #000c}
 .dev.phone .btn{width:46px;height:46px;border-radius:50%;border:2px solid #444;margin-top:16px;background:#1c1c1c;box-shadow:inset 0 2px 4px #000}
 .dev.slab{background:#e6e2da;border-radius:14px;padding:26px 30px;box-shadow:0 14px 40px #000a}
 .dev.slab .btn{display:none}
 img{display:block;max-height:78vh;max-width:96vw;width:auto;height:auto;background:#fff;cursor:pointer}
 img.fixed{max-height:none;max-width:none}
 .dev.phone img{border-radius:6px}
 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
 button{background:#333;color:#eee;border:1px solid #555;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer}
 button:hover{background:#444} button:active{background:#4a9;color:#000}
 kbd{background:#222;border:1px solid #555;border-radius:4px;padding:1px 6px;font-size:12px;color:#aaa}
 #st{color:#888;font-size:12px;min-width:220px}
 p{color:#777;max-width:720px;font-size:13px;line-height:1.5;margin:0}
 a{color:#4a9}
</style></head><body>
<div class=pick>Size:
 <button id=s-1 onclick="setScale(1)">Actual</button>
 <button id=s-2 onclick="setScale(2)">2x</button>
 <button id=s-0 onclick="setScale(0)">Fit</button>
 &nbsp; Device:
 <button id=d-t5pro onclick="setDev('t5pro')">T5 E-Paper S3 Pro (540x960, 16 grey, touch)</button>
 <button id=d-trmnl onclick="setDev('trmnl')">TRMNL (800x480, 1-bit)</button>
 &nbsp; <a href="/os" target="_blank">LAN settings page</a>
</div>
<div class=dev id=dev>
 <img id=f src="/frame.bmp" alt="device screen">
 <div class=btn title="S3 button: click = short, shift-click = long" onclick="g(event.shiftKey?'long':'short')"></div>
</div>
<div class=bar>
  <button data-g=short>Short press (screen key / Home) <kbd>Space</kbd></button>
  <button data-g=double>Double press (screen key / Redraw) <kbd>Backspace</kbd></button>
  <button data-g=long>Long press (Home) <kbd>Enter</kbd></button>
  <button onclick="hold=!hold;this.textContent='Hold mode: '+(hold?'on':'off')">Hold mode: off</button>
  <span id=st>connecting</span>
</div>
<p>The QuireOS core built for macOS: the panel, touch, storage and radio are host versions; everything drawn here comes from the real renderer. Click the screen to tap.</p>
<script>
 const f=document.getElementById('f'), st=document.getElementById('st'), devEl=document.getElementById('dev');
 let ver=-1, info={w:540,h:960,name:'t5pro',touch:true,dpi:235}, scale=0, hold=false;
 function applyScale(){
   if(scale===0){ f.classList.remove('fixed'); f.style.width=''; f.style.height=''; }
   else { const cssW = info.w / info.dpi * 96 * scale; f.classList.add('fixed'); f.style.width=cssW+'px'; f.style.height=(cssW*info.h/info.w)+'px'; }
   document.querySelectorAll('.pick button[id^=s-]').forEach(b=>b.classList.toggle('on',b.id==='s-'+scale));
 }
 function setScale(v){ scale=v; applyScale(); }
 async function loadInfo(){ info=await (await fetch('/info')).json();
   f.width=info.w; f.height=info.h; applyScale();
   devEl.className='dev '+(info.w<info.h?'phone':'slab');
   document.querySelectorAll('.pick button').forEach(b=>b.classList.toggle('on',b.id==='d-'+info.name));
   ver=-1; }
 async function tick(){
   try{ const i=await (await fetch('/info')).json();
        if(i.w!==info.w||i.h!==info.h||i.name!==info.name){ await loadInfo(); }
        if(i.frame!==ver){ ver=i.frame; f.src='/frame.bmp?'+ver; }
        st.textContent=(i.asleep?'asleep - tap wakes it':'awake')+'  |  '+i.mode+'  |  '+info.w+'x'+info.h+'  |  frame '+ver; }
   catch(e){ st.textContent='emulator not responding'; }
   setTimeout(tick,300);
 }
 async function setDev(n){ await fetch('/dev?d='+n,{method:'POST'}); setTimeout(loadInfo,1500); }
 function g(k){ fetch('/g?k='+k,{method:'POST'}); st.textContent='sent '+k; }
 document.querySelectorAll('button[data-g]').forEach(b=>b.onclick=()=>g(b.dataset.g));
 document.addEventListener('keydown',e=>{
   if(e.target.tagName==='INPUT')return;
   if(e.code==='Space'){e.preventDefault();g('short');}
   else if(e.code==='Enter'){e.preventDefault();g('long');}
   else if(e.code==='Backspace'){e.preventDefault();g('double');}
 });
 f.addEventListener('click',e=>{
   const r=f.getBoundingClientRect();
   const x=Math.round((e.clientX-r.left)*info.w/r.width), y=Math.round((e.clientY-r.top)*info.h/r.height);
   fetch('/tap?x='+x+'&y='+y+(hold?'&hold=1':''),{method:'POST'}); st.textContent='tap '+x+','+y;
 });
 loadInfo().then(tick);
</script></body></html>)HTML";

static void send_all(int fd, const void *d, size_t n) {
  const char *p = (const char *)d;
  while (n) { ssize_t k = send(fd, p, n, 0); if (k <= 0) return; p += (size_t)k; n -= (size_t)k; }
}
static void respond(int fd, int status, const char *ctype, const void *body, size_t n, const char *extra = nullptr, bool gz = false) {
  char h[512];
  const char *reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 401 ? "Unauthorized" : status == 400 ? "Bad Request" : "Error";
  int hl = snprintf(h, sizeof h, "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nConnection: close\r\n%s%s%s\r\n",
                    status, reason, ctype, n, gz ? "Content-Encoding: gzip\r\n" : "", extra ? extra : "", extra ? "\r\n" : "");
  send_all(fd, h, (size_t)hl);
  send_all(fd, body, n);
}
static std::string qstr(const std::string &q, const char *key) {
  size_t p = 0;
  std::string k = std::string(key) + "=";
  while (p < q.size()) {
    if (q.compare(p, k.size(), k) == 0 && (p == 0 || q[p - 1] == '&')) {
      size_t e = q.find('&', p);
      return q.substr(p + k.size(), e == std::string::npos ? std::string::npos : e - p - k.size());
    }
    p++;
  }
  return "";
}
static int qint(const std::string &q, const char *key, int def) { std::string s = qstr(q, key); return s.empty() ? def : atoi(s.c_str()); }

static bool read_request(int fd, std::string &method, std::string &path, std::string &query, std::string &auth, std::string &body) {
  std::string req;
  char buf[4096];
  size_t header_end = std::string::npos;
  while (header_end == std::string::npos) {
    ssize_t n = recv(fd, buf, sizeof buf, 0);
    if (n <= 0) return false;
    req.append(buf, (size_t)n);
    header_end = req.find("\r\n\r\n");
    if (req.size() > 1 << 20) return false;
  }
  size_t sp1 = req.find(' '), sp2 = req.find(' ', sp1 + 1);
  if (sp1 == std::string::npos || sp2 == std::string::npos) return false;
  method = req.substr(0, sp1);
  std::string target = req.substr(sp1 + 1, sp2 - sp1 - 1);
  size_t qm = target.find('?');
  path = qm == std::string::npos ? target : target.substr(0, qm);
  query = qm == std::string::npos ? "" : target.substr(qm + 1);
  size_t clen = 0;
  std::string headers = req.substr(0, header_end);
  for (size_t p = 0; p < headers.size();) {
    size_t e = headers.find("\r\n", p);
    std::string line = headers.substr(p, e == std::string::npos ? std::string::npos : e - p);
    std::string lower = line;
    for (char &c : lower) if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
    if (lower.compare(0, 15, "content-length:") == 0) clen = (size_t)atol(line.c_str() + 15);
    if (lower.compare(0, 14, "authorization:") == 0) { auth = line.substr(14); size_t s = auth.find_first_not_of(' '); auth = s == std::string::npos ? "" : auth.substr(s); }
    if (e == std::string::npos) break;
    p = e + 2;
  }
  body = req.substr(header_end + 4);
  while (body.size() < clen) {
    ssize_t n = recv(fd, buf, sizeof buf, 0);
    if (n <= 0) break;
    body.append(buf, (size_t)n);
  }
  return true;
}

bool start(int port, const ServerHooks &hooks) {
  g_hooks = hooks;
  g_srv = socket(AF_INET, SOCK_STREAM, 0);
  fcntl(g_srv, F_SETFD, FD_CLOEXEC);   // not inherited by a restarted (execv) emulator
  int one = 1;
  setsockopt(g_srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in a{};
  a.sin_family = AF_INET; a.sin_port = htons((uint16_t)port); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(g_srv, (sockaddr *)&a, sizeof a) != 0) { perror("bind"); return false; }
  listen(g_srv, 8);
  return true;
}

static void handle(int fd) {
  std::string method, path, query, auth, body;
  if (!read_request(fd, method, path, query, auth, body)) return;
  if (path == "/") { respond(fd, 200, "text/html; charset=utf-8", PAGE, strlen(PAGE)); return; }
  if (path == "/frame.bmp") { auto b = frame_bmp(); respond(fd, 200, "image/bmp", b.data(), b.size()); return; }
  if (path == "/frame.png") { auto b = frame_png(); respond(fd, 200, "image/png", b.data(), b.size()); return; }
  if (path == "/ver") { char s[32]; int l = snprintf(s, sizeof s, "%u %d", host::frame_version(), host::asleep() ? 1 : 0); respond(fd, 200, "text/plain", s, (size_t)l); return; }
  if (path == "/info") {
    // Mode comes from the OS's own state snapshot.
    os::web::Request wr; wr.method = "GET"; wr.path = "/os/api/state"; wr.query = "";
    os::web::Response st = os::web::handle(wr);
    std::string mode = "?";
    if (st.status == 200 && st.body) {
      std::string s((const char *)st.body, st.len);
      size_t p = s.find("\"mode\":\"");
      if (p != std::string::npos) { p += 8; mode = s.substr(p, s.find('"', p) - p); }
    }
    os::web::release(st);
    const host::Preset *d = host::current_preset();
    char s[400];
    int l = snprintf(s, sizeof s, "{\"name\":\"%s\",\"title\":\"%s\",\"w\":%d,\"h\":%d,\"greys\":%d,\"dpi\":%d,\"touch\":%s,\"mode\":\"%s\",\"heap\":%zu,\"frame\":%u,\"asleep\":%s,\"hw_id\":\"%s\"}",
                     d->name, d->title, hal::board().display->width(), hal::board().display->height(), d->greys, d->dpi,
                     d->touch ? "true" : "false", mode.c_str(), hal::board().power->free_heap(), host::frame_version(),
                     host::asleep() ? "true" : "false", hal::device_hw_id());
    respond(fd, 200, "application/json", s, (size_t)l);
    return;
  }
  if (path == "/dev") {
    std::string d = qstr(query, "d");
    respond(fd, 200, "text/plain", "ok", 2);
    if (host::find_preset(d.c_str())) g_pending_restart = d;   // performed after the reply is closed
    return;
  }
  if (path == "/g") {
    std::string k = qstr(query, "k");
    hal::Gesture g = k == "long" ? hal::Gesture::LONG : k == "double" ? hal::Gesture::DOUBLE : hal::Gesture::SHORT;
    respond(fd, 200, "text/plain", "ok", 2);
    if (host::asleep()) { if (g_hooks.wake) g_hooks.wake(hal::WakeCause::BUTTON); return; }
    host::push_button((uint8_t)qint(query, "b", 1), g);
    return;
  }
  if (path == "/tap") {
    int x = qint(query, "x", -1), y = qint(query, "y", -1);
    bool hold = qint(query, "hold", 0) != 0;
    respond(fd, 200, "text/plain", "ok", 2);
    fprintf(stderr, "[emu] %s %d,%d\n", hold ? "hold" : "tap", x, y);
    if (host::asleep()) { if (g_hooks.wake) g_hooks.wake(hal::WakeCause::TOUCH); return; }
    host::push_tap(x, y, hold);
    return;
  }
  if (path.compare(0, 3, "/os") == 0) {
    os::web::Request wr;
    wr.method = method.c_str();
    wr.path = path.c_str();
    wr.query = query.c_str();
    wr.body = body.empty() ? nullptr : body.c_str();
    wr.body_len = body.size();
    wr.authorization = auth.empty() ? nullptr : auth.c_str();
    wr.remote = "127.0.0.1";
    os::web::Response r = os::web::handle(wr);
    respond(fd, r.status, r.content_type, r.body, r.len, r.extra_header, r.gzip);
    os::web::release(r);
    return;
  }
  respond(fd, 404, "text/plain", "not found", 9);
}

void poll_once(int timeout_ms) {
  if (g_srv < 0) return;
  pollfd pf{g_srv, POLLIN, 0};
  if (::poll(&pf, 1, timeout_ms) <= 0) return;
  int fd = accept(g_srv, nullptr, nullptr);
  if (fd < 0) return;
  fcntl(fd, F_SETFD, FD_CLOEXEC);
  timeval tv{2, 0};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  handle(fd);
  close(fd);
  if (!g_pending_restart.empty() && g_hooks.restart) { std::string d = g_pending_restart; g_pending_restart.clear(); g_hooks.restart(d.c_str()); }
}

}  // namespace emu
