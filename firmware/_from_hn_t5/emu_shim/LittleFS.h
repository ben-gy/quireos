#pragma once
#include "Arduino.h"
#include <sys/stat.h>
#include <unistd.h>

// Files live under emu/data/, one host file per device path.
class File : public Stream {
public:
    File() {}
    explicit File(FILE *fp) : f(fp) {}
    File(const File &) = delete;
    File &operator=(const File &) = delete;
    File(File &&o) noexcept : f(o.f) { o.f = nullptr; }
    File &operator=(File &&o) noexcept { if (this != &o) { close(); f = o.f; o.f = nullptr; } return *this; }
    ~File() { close(); }
    operator bool() const { return f != nullptr; }
    void close() { if (f) { fclose(f); f = nullptr; } }
    int available() override { if (!f) return 0; int c = fgetc(f); if (c == EOF) return 0; ungetc(c, f); return 1; }
    int read() override { return f ? fgetc(f) : -1; }
    int peek() override { if (!f) return -1; int c = fgetc(f); if (c != EOF) ungetc(c, f); return c; }
    size_t write(uint8_t b) override { return f ? fputc(b, f) != EOF : 0; }
    size_t write(const uint8_t *d, size_t n) override { return f ? fwrite(d, 1, n, f) : 0; }
    size_t size() { if (!f) return 0; long c = ftell(f); fseek(f, 0, SEEK_END); long e = ftell(f); fseek(f, c, SEEK_SET); return e; }
private:
    FILE *f = nullptr;
};

class LittleFSClass {
public:
    bool begin(bool = false) { mkdir("emu", 0755); mkdir("emu/data", 0755); return true; }
    bool exists(const String &p) { struct stat st; return stat(host(p).c_str(), &st) == 0; }
    File open(const String &p, const char *mode = "r") { return File(fopen(host(p).c_str(), mode)); }
    bool remove(const String &p) { return ::unlink(host(p).c_str()) == 0; }
private:
    std::string host(const String &p) { return std::string("emu/data/") + (p.c_str()[0] == '/' ? p.c_str() + 1 : p.c_str()); }
};
extern LittleFSClass LittleFS;
