#pragma once
#include "Arduino.h"
#include <map>
#include <fstream>

// Key/value store persisted to emu/data/prefs_<namespace>.txt
class Preferences {
public:
    bool begin(const char *ns, bool = false) {
        path = std::string("emu/data/prefs_") + ns + ".txt";
        kv.clear();
        std::ifstream f(path);
        std::string k, v;
        while (std::getline(f, k) && std::getline(f, v)) kv[k] = v;
        return true;
    }
    void end() {}
    String getString(const char *k, const String &d = "") { auto i = kv.find(k); return i == kv.end() ? d : String(i->second); }
    void   putString(const char *k, const String &v) { kv[k] = v.c_str(); save(); }
    bool   getBool(const char *k, bool d = false) { auto i = kv.find(k); return i == kv.end() ? d : i->second == "1"; }
    void   putBool(const char *k, bool v) { kv[k] = v ? "1" : "0"; save(); }
    int    getInt(const char *k, int d = 0) { auto i = kv.find(k); return i == kv.end() ? d : atoi(i->second.c_str()); }
    void   putInt(const char *k, int v) { kv[k] = std::to_string(v); save(); }
    void   remove(const char *k) { kv.erase(k); save(); }
private:
    void save() {
        std::ofstream f(path, std::ios::trunc);
        for (auto &p : kv) f << p.first << '\n' << p.second << '\n';
    }
    std::string path;
    std::map<std::string, std::string> kv;
};
