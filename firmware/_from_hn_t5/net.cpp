#include "app.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <esp_sntp.h>

namespace net {

static bool timeSynced = false;

bool haveCreds() {
    String s, p;
    return store::loadWifi(s, p);
}

int rssi() { return WiFi.isConnected() ? WiFi.RSSI() : 0; }
bool isUp() { return WiFi.status() == WL_CONNECTED; }

bool connect(uint32_t timeoutMs) {
    String ssid, pass;
    if (!store::loadWifi(ssid, pass)) return false;
    if (WiFi.status() == WL_CONNECTED) return true;
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(true);
    WiFi.begin(ssid.c_str(), pass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(120);
    bool ok = WiFi.status() == WL_CONNECTED;
    log_i("wifi %s (%s)", ok ? "connected" : "failed", ssid.c_str());
    return ok;
}

void ensureUp() {
    if (isUp()) return;
    connect(15000);
    syncTime();
}

void syncTime() {
    if (timeSynced || !isUp()) return;
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    uint32_t t0 = millis();
    while (time(nullptr) < 1600000000 && millis() - t0 < 8000) delay(150);
    timeSynced = time(nullptr) > 1600000000;
    log_i("time sync %s", timeSynced ? "ok" : "failed");
}

// --------------------------------------------------------------- portal ----
static WebServer *server = nullptr;
static DNSServer *dns = nullptr;
static String scanOptions;

static void drawPortalScreen(const char *status) {
    gfx::clearBuffer();
    int y = 70;
    gfx::drawText(fonts::xl, "Wi-Fi setup", MARGIN_X, y);
    y += 30;
    gfx::hline(MARGIN_X, y, CONTENT_W, gfx::inkC());
    y += 54;

    gfx::drawText(fonts::md, "1.  Join this Wi-Fi network from your phone or laptop:", MARGIN_X, y);
    y += 56;
    gfx::rect(MARGIN_X + 28, y - 40, gfx::textW(fonts::lg, AP_SSID) + 28, 56, gfx::faintC());
    gfx::drawText(fonts::lg, AP_SSID, MARGIN_X + 42, y);
    y += 62;

    gfx::drawText(fonts::md, "2.  A setup page should open by itself. If it does not,", MARGIN_X, y);
    y += 44;
    gfx::drawText(fonts::md, "     browse to  http://192.168.4.1", MARGIN_X, y);
    y += 56;
    gfx::drawText(fonts::md, "3.  Choose your network, enter the password, press Save.", MARGIN_X, y);

    gfx::hline(MARGIN_X, EPD_HEIGHT - FOOTER_H, CONTENT_W, gfx::ruleC());
    gfx::drawText(fonts::sm, status, MARGIN_X, EPD_HEIGHT - 14, TONE_DIM);
    gfx::flushFull();
}

static String htmlEscape(const String &in) {
    String o;
    for (size_t i = 0; i < in.length(); i++) {
        char c = in[i];
        if (c == '&') o += "&amp;";
        else if (c == '<') o += "&lt;";
        else if (c == '>') o += "&gt;";
        else if (c == '"') o += "&quot;";
        else o += c;
    }
    return o;
}

static void buildScan() {
    int n = WiFi.scanNetworks(false, false);
    scanOptions = "";
    for (int i = 0; i < n && i < 30; i++) {
        String s = WiFi.SSID(i);
        if (s.length() == 0) continue;
        scanOptions += "<option value=\"" + htmlEscape(s) + "\">" + htmlEscape(s) +
                       "  (" + WiFi.RSSI(i) + " dBm)</option>";
    }
    if (scanOptions.length() == 0) scanOptions = "<option value=\"\">(no networks found)</option>";
}

static void handleRoot() {
    String page =
        "<!doctype html><html><head><meta name=viewport content=\"width=device-width,initial-scale=1\">"
        "<title>HN Reader setup</title><style>"
        "body{font:16px -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#f6f6ef;color:#111}"
        "h1{font-size:20px;margin:0 0 4px}p.s{color:#666;margin:0 0 20px;font-size:14px}"
        "label{display:block;margin:14px 0 4px;font-weight:600}"
        "select,input{width:100%;padding:11px;font-size:16px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}"
        "button{margin-top:20px;width:100%;padding:13px;font-size:16px;background:#ff6600;color:#fff;"
        "border:0;border-radius:6px;font-weight:600}a{color:#666;font-size:13px}"
        "</style></head><body><h1>Hacker News reader</h1>"
        "<p class=s>Connect your LilyGo T5 to Wi-Fi.</p>"
        "<form method=POST action=/save>"
        "<label>Network</label><select name=ssid>" + scanOptions + "</select>"
        "<label>Password</label><input type=password name=pass autocomplete=off placeholder=\"leave blank if open\">"
        "<button type=submit>Save &amp; restart</button></form>"
        "<p style=\"margin-top:18px\"><a href=/rescan>Rescan networks</a></p>"
        "</body></html>";
    server->send(200, "text/html", page);
}

static void handleSave() {
    String ssid = server->arg("ssid");
    String pass = server->arg("pass");
    if (ssid.length() == 0) { server->sendHeader("Location", "/"); server->send(302); return; }
    store::saveWifi(ssid, pass);
    server->send(200, "text/html",
                 "<!doctype html><meta name=viewport content=\"width=device-width,initial-scale=1\">"
                 "<body style=\"font:16px system-ui;padding:24px;background:#f6f6ef\">"
                 "<h2>Saved</h2><p>The reader is restarting and will connect to <b>" +
                 htmlEscape(ssid) + "</b>.</p></body>");
    delay(600);
    drawPortalScreen("Saved. Restarting...");
    delay(400);
    ESP.restart();
}

void runPortal() {
    WiFi.persistent(false);
    WiFi.mode(WIFI_AP_STA);
    buildScan();
    WiFi.softAP(AP_SSID);
    delay(400);
    IPAddress ip = WiFi.softAPIP();
    log_i("portal at %s", ip.toString().c_str());

    dns = new DNSServer();
    dns->setErrorReplyCode(DNSReplyCode::NoError);
    dns->start(53, "*", ip);

    server = new WebServer(80);
    server->on("/", handleRoot);
    server->on("/save", HTTP_POST, handleSave);
    server->on("/rescan", []() {
        buildScan();
        server->sendHeader("Location", "/");
        server->send(302);
    });
    // captive-portal probes from iOS / Android / Windows
    server->onNotFound([]() {
        server->sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/");
        server->send(302, "text/plain", "");
    });
    server->begin();

    drawPortalScreen("Waiting for setup...  Hold the button 3s to skip.");

    // Stay here until credentials are saved (handleSave reboots), or the user
    // holds the button for 3s to keep whatever is already stored.
    pinMode(BUTTON_1, INPUT_PULLUP);
    uint32_t heldSince = 0;
    while (true) {
        dns->processNextRequest();
        server->handleClient();
        if (digitalRead(BUTTON_1) == LOW) {
            if (!heldSince) heldSince = millis();
            else if (millis() - heldSince > 3000) break;
        } else heldSince = 0;
        delay(2);
    }
    server->stop();
    dns->stop();
    delete server; server = nullptr;
    delete dns;    dns = nullptr;
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
}

}  // namespace net
