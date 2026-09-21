// Host stand-in for the Arduino core: just enough for the HN reader sources.
#pragma once
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cctype>
#include <ctime>
#include <chrono>
#include <thread>
#include <algorithm>
#include <cstdarg>
#include "esp_attr.h"

using std::min;
using std::max;
template <typename T> T constrain(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

inline uint32_t millis() {
    static auto t0 = std::chrono::steady_clock::now();
    return (uint32_t)std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - t0).count();
}
inline void delay(uint32_t ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
typedef int gpio_num_t;
inline void pinMode(int, int) {}
inline int  digitalRead(int) { return HIGH; }
inline void digitalWrite(int, int) {}
inline int  analogRead(int) { return 0; }

class String {
public:
    std::string s;
    String() {}
    String(const char *p) : s(p ? p : "") {}
    String(const std::string &v) : s(v) {}
    String(char c) { s.push_back(c); }
    String(int v)           { s = std::to_string(v); }
    String(unsigned v)      { s = std::to_string(v); }
    String(long v)          { s = std::to_string(v); }
    String(unsigned long v) { s = std::to_string(v); }

    size_t length() const { return s.size(); }
    const char *c_str() const { return s.c_str(); }
    char operator[](size_t i) const { return i < s.size() ? s[i] : '\0'; }
    void reserve(size_t n) { s.reserve(n); }
    String &operator+=(const String &o) { s += o.s; return *this; }
    String &operator+=(const char *o)   { s += o;   return *this; }
    String &operator+=(char c)          { s += c;   return *this; }
    bool concat(const char *p, size_t n) { s.append(p, n); return true; }
    bool concat(const char *p)           { s.append(p); return true; }
    bool concat(char c)                  { s.push_back(c); return true; }
    int indexOf(char c, int from = 0) const {
        auto p = s.find(c, from < 0 ? 0 : from); return p == std::string::npos ? -1 : (int)p; }
    int indexOf(const char *n, int from = 0) const {
        auto p = s.find(n, from < 0 ? 0 : from); return p == std::string::npos ? -1 : (int)p; }
    String substring(int a) const {
        if (a < 0) a = 0; if (a > (int)s.size()) a = s.size(); return String(s.substr(a)); }
    String substring(int a, int b) const {
        if (a < 0) a = 0; if (b > (int)s.size()) b = s.size(); if (b < a) b = a;
        return String(s.substr(a, b - a)); }
    bool startsWith(const char *p) const { return s.rfind(p, 0) == 0; }
    void trim() {
        size_t a = 0, b = s.size();
        while (a < b && isspace((unsigned char)s[a])) a++;
        while (b > a && isspace((unsigned char)s[b - 1])) b--;
        s = s.substr(a, b - a);
    }
    void toLowerCase() { for (auto &c : s) c = tolower((unsigned char)c); }
    bool operator==(const String &o) const { return s == o.s; }
    bool operator==(const char *o) const { return s == o; }
    bool operator!=(const String &o) const { return s != o.s; }
    bool operator!=(const char *o) const { return s != o; }
};
inline String operator+(const String &a, const String &b) { String r(a); r += b; return r; }
inline String operator+(const String &a, const char *b)   { String r(a); r += b; return r; }
inline String operator+(const char *a, const String &b)   { String r(a); r += b; return r; }
inline String operator+(const String &a, char b)          { String r(a); r += b; return r; }
inline String operator+(const String &a, int b)           { return a + String(b); }
inline String operator+(const String &a, unsigned b)      { return a + String(b); }
inline String operator+(const String &a, long b)          { return a + String(b); }
inline String operator+(const String &a, unsigned long b) { return a + String(b); }

// Print / Stream base classes so ArduinoJson can read from and write to files.
class Print {
public:
    virtual ~Print() {}
    virtual size_t write(uint8_t) = 0;
    virtual size_t write(const uint8_t *d, size_t n) { size_t k = 0; while (k < n && write(d[k])) k++; return k; }
};
class Printable {
public:
    virtual ~Printable() {}
    virtual size_t printTo(Print &p) const = 0;
};
class Stream : public Print {
public:
    virtual int available() = 0;
    virtual int read() = 0;
    virtual int peek() = 0;
    size_t readBytes(char *buf, size_t n) {
        size_t k = 0;
        while (k < n) { int c = read(); if (c < 0) break; buf[k++] = (char)c; }
        return k;
    }
    size_t readBytes(uint8_t *buf, size_t n) { return readBytes((char *)buf, n); }
};

struct SerialClass {
    void begin(int) {}
    void flush() { fflush(stdout); }
    void print(const char *s) { fputs(s, stdout); }
    void print(const String &s) { fputs(s.c_str(), stdout); }
    void println(const char *s = "") { puts(s); }
    void println(const String &s) { puts(s.c_str()); }
    int  printf(const char *f, ...) { va_list a; va_start(a, f); int n = vprintf(f, a); va_end(a); return n; }
    size_t write(const uint8_t *d, size_t n) { return fwrite(d, 1, n, stdout); }
};
extern SerialClass Serial;

struct EspClass {
    uint32_t getFreeHeap()  { return 220000; }
    uint32_t getPsramSize() { return 8 * 1024 * 1024; }
    uint32_t getFreePsram() { return 7 * 1024 * 1024; }
    uint32_t getFlashChipSize() { return 16 * 1024 * 1024; }
    const char *getChipModel() { return "ESP32-S3 (emulated)"; }
    void restart();
};
extern EspClass ESP;

#define log_e(f, ...) fprintf(stderr, "[E] " f "\n", ##__VA_ARGS__)
#define log_w(f, ...) fprintf(stderr, "[W] " f "\n", ##__VA_ARGS__)
#define log_i(f, ...) fprintf(stderr, "[I] " f "\n", ##__VA_ARGS__)
#define log_d(f, ...) do {} while (0)
