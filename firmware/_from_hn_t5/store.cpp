#include "app.h"
#include "json_psram.h"
#include <LittleFS.h>
#include <Preferences.h>

PsramAllocator gPsram;

namespace store {

static Preferences prefs;
static std::vector<Story> gBookmarks;
static std::vector<uint32_t> gRead;      // oldest first, trimmed from the front
static bool fsOk = false;

static const char *BM_PATH = "/bookmarks.json";
static const char *RD_PATH = "/read.json";
static String cachePath(Feed f) { return String("/feed") + (int)f + ".json"; }

static void storyToJson(const Story &s, JsonObject o) {
    o["id"]  = s.id;
    o["t"]   = s.title;
    o["u"]   = s.url;
    o["a"]   = s.author;
    o["p"]   = s.points;
    o["c"]   = s.comments;
    o["ts"]  = s.time;
    if (s.text.length()) o["x"] = s.text;
}

static Story storyFromJson(JsonObjectConst o) {
    Story s;
    s.id       = o["id"] | 0u;
    s.title    = (const char *)(o["t"]  | "");
    s.url      = (const char *)(o["u"]  | "");
    s.author   = (const char *)(o["a"]  | "");
    s.points   = o["p"]  | 0u;
    s.comments = o["c"]  | 0u;
    s.time     = o["ts"] | 0u;
    s.text     = (const char *)(o["x"] | "");
    return s;
}

static void loadBookmarks() {
    gBookmarks.clear();
    if (!fsOk || !LittleFS.exists(BM_PATH)) return;
    File f = LittleFS.open(BM_PATH, "r");
    if (!f) return;
    JsonDocument doc(&gPsram);
    if (deserializeJson(doc, f) == DeserializationError::Ok) {
        for (JsonObjectConst o : doc.as<JsonArrayConst>()) gBookmarks.push_back(storyFromJson(o));
    }
    f.close();
    log_i("loaded %u bookmarks", (unsigned)gBookmarks.size());
}

static void loadRead() {
    gRead.clear();
    if (!fsOk || !LittleFS.exists(RD_PATH)) return;
    File f = LittleFS.open(RD_PATH, "r");
    if (!f) return;
    JsonDocument doc(&gPsram);
    if (deserializeJson(doc, f) == DeserializationError::Ok)
        for (JsonVariantConst v : doc.as<JsonArrayConst>()) gRead.push_back(v.as<uint32_t>());
    f.close();
    log_i("loaded %u read ids", (unsigned)gRead.size());
}

static void saveRead() {
    if (!fsOk) return;
    JsonDocument doc(&gPsram);
    JsonArray a = doc.to<JsonArray>();
    for (uint32_t id : gRead) a.add(id);
    File f = LittleFS.open(RD_PATH, "w");
    if (!f) return;
    serializeJson(doc, f);
    f.close();
}

bool begin() {
    fsOk = LittleFS.begin(true);
    if (!fsOk) log_e("LittleFS mount failed");
    prefs.begin("hn", false);
    loadBookmarks();
    loadRead();
    return fsOk;
}

// ------------------------------------------------------------ read state ---
bool isRead(uint32_t id) {
    for (uint32_t v : gRead) if (v == id) return true;
    return false;
}

void markRead(uint32_t id) {
    if (!id || isRead(id)) return;
    gRead.push_back(id);
    if (gRead.size() > MAX_READ_IDS)
        gRead.erase(gRead.begin(), gRead.begin() + (gRead.size() - MAX_READ_IDS));
    saveRead();
}

void markAllRead(const std::vector<Story> &v) {
    bool changed = false;
    for (auto &s : v)
        if (s.id && !isRead(s.id)) { gRead.push_back(s.id); changed = true; }
    if (!changed) return;
    if (gRead.size() > MAX_READ_IDS)
        gRead.erase(gRead.begin(), gRead.begin() + (gRead.size() - MAX_READ_IDS));
    saveRead();
}

void clearRead() { gRead.clear(); saveRead(); }
size_t readCount() { return gRead.size(); }

// ------------------------------------------------------------------ wifi ---
bool loadWifi(String &ssid, String &pass) {
    ssid = prefs.getString("ssid", "");
    pass = prefs.getString("pass", "");
    return ssid.length() > 0;
}
void saveWifi(const String &ssid, const String &pass) {
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
}
void clearWifi() { prefs.remove("ssid"); prefs.remove("pass"); }

// ------------------------------------------------------------- bookmarks ---
std::vector<Story> &bookmarks() { return gBookmarks; }

bool isBookmarked(uint32_t id) {
    for (auto &b : gBookmarks) if (b.id == id) return true;
    return false;
}

void saveBookmarks() {
    if (!fsOk) return;
    JsonDocument doc(&gPsram);
    JsonArray arr = doc.to<JsonArray>();
    for (auto &b : gBookmarks) storyToJson(b, arr.add<JsonObject>());
    File f = LittleFS.open(BM_PATH, "w");
    if (!f) { log_e("cannot open %s", BM_PATH); return; }
    serializeJson(doc, f);
    f.close();
}

bool toggleBookmark(const Story &s) {
    for (size_t i = 0; i < gBookmarks.size(); i++) {
        if (gBookmarks[i].id == s.id) {
            gBookmarks.erase(gBookmarks.begin() + i);
            saveBookmarks();
            return false;
        }
    }
    gBookmarks.insert(gBookmarks.begin(), s);
    if (gBookmarks.size() > MAX_BOOKMARKS) gBookmarks.resize(MAX_BOOKMARKS);
    saveBookmarks();
    return true;
}

// ----------------------------------------------------------- feed cache ----
bool loadFeedCache(Feed fd, std::vector<Story> &out, uint32_t &fetchedAt) {
    out.clear();
    fetchedAt = 0;
    if (!fsOk) return false;
    String path = cachePath(fd);
    if (!LittleFS.exists(path)) return false;
    File f = LittleFS.open(path, "r");
    if (!f) return false;
    JsonDocument doc(&gPsram);
    bool ok = deserializeJson(doc, f) == DeserializationError::Ok;
    f.close();
    if (!ok) return false;
    fetchedAt = doc["at"] | 0u;
    for (JsonObjectConst o : doc["s"].as<JsonArrayConst>()) out.push_back(storyFromJson(o));
    return !out.empty();
}

void saveFeedCache(Feed fd, const std::vector<Story> &in) {
    if (!fsOk) return;
    JsonDocument doc(&gPsram);
    doc["at"] = (uint32_t)time(nullptr);
    JsonArray arr = doc["s"].to<JsonArray>();
    for (auto &s : in) storyToJson(s, arr.add<JsonObject>());
    File f = LittleFS.open(cachePath(fd), "w");
    if (!f) return;
    serializeJson(doc, f);
    f.close();
}

void clearCache() {
    if (!fsOk) return;
    for (int i = 0; i < FEED_COUNT; i++) {
        String p = cachePath((Feed)i);
        if (LittleFS.exists(p)) LittleFS.remove(p);
    }
}

// -------------------------------------------------------------- settings ---
bool dark()               { return prefs.getBool("dark", false); }
void setDark(bool v)      { prefs.putBool("dark", v); }
int  textSize()           { return prefs.getInt("tsize", 1); }
void setTextSize(int v)   { prefs.putInt("tsize", v); }
bool openArticle()        { return prefs.getBool("openart", false); }
void setOpenArticle(bool v){ prefs.putBool("openart", v); }
int  lastFeed()           { return prefs.getInt("feed", 0); }
void setLastFeed(int v)   { prefs.putInt("feed", v); }
int  frontlight()         { return prefs.getInt("light", 0); }
void setFrontlight(int v) { prefs.putInt("light", v); }

}  // namespace store
