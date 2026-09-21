#!/usr/bin/env python3
"""Two tiny servers for exercising the M3 path in the emulator:
  :8124  the app origin (manifest.json, screens/*.json)  -> install http://127.0.0.1:8124/manifest.json
  :8123  a fake Home Assistant: GET /api/states/<id>, POST /api/services/switch/toggle (needs a Bearer token)
Every request is logged with its Authorization header so secret gating can be verified.
"""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = {"switch.pool": "off"}
TOKEN = os.environ.get("TOKEN", "secret-123")

def log(kind, h):
    print(f"[{kind}] {h.command} {h.path} auth={h.headers.get('Authorization')!r} settings={h.headers.get('X-App-Settings')!r} install={h.headers.get('X-Install-Id')!r}", flush=True)

class App(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        log("app", self)
        p = os.path.normpath(os.path.join(HERE, self.path.lstrip("/").split("?")[0]))
        if not p.startswith(HERE) or not os.path.isfile(p):
            self.send_response(404); self.end_headers(); return
        body = open(p, "rb").read()
        etag = '"%x"' % hash(body)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        log("app", self)
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        print("   body:", body.decode(errors="replace"), flush=True)
        self.send_response(204); self.end_headers()

class HA(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("ETag", '"%x"' % hash(body)); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def authed(self):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            self.reply(401, {"message": "Unauthorized"}); return False
        return True
    def do_GET(self):
        log("ha", self)
        if not self.authed(): return
        ent = self.path.rsplit("/", 1)[-1]
        if ent in STATE: self.reply(200, {"entity_id": ent, "state": STATE[ent], "attributes": {"friendly_name": "Pool Lights"}})
        else: self.reply(404, {"message": "no such entity"})
    def do_POST(self):
        log("ha", self)
        if not self.authed(): return
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        ent = body.get("entity_id", "switch.pool")
        STATE[ent] = "on" if STATE.get(ent) == "off" else "off"
        print("   toggled", ent, "->", STATE[ent], flush=True)
        self.reply(200, [{"entity_id": ent, "state": STATE[ent]}])

if __name__ == "__main__":
    a = ThreadingHTTPServer(("127.0.0.1", 8124), App)
    h = ThreadingHTTPServer(("127.0.0.1", 8123), HA)
    threading.Thread(target=a.serve_forever, daemon=True).start()
    print("app origin http://127.0.0.1:8124/manifest.json ; fake HA on :8123 (token %s)" % TOKEN, flush=True)
    h.serve_forever()
