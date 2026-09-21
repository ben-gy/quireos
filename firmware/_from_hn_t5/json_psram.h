#pragma once
#include <ArduinoJson.h>
#include <esp_heap_caps.h>

// Keep the (occasionally very large) HN JSON documents out of internal RAM.
struct PsramAllocator : ArduinoJson::Allocator {
    void *allocate(size_t n) override {
        void *p = heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
        return p ? p : malloc(n);
    }
    void deallocate(void *p) override { heap_caps_free(p); }
    void *reallocate(void *p, size_t n) override {
        void *q = heap_caps_realloc(p, n, MALLOC_CAP_SPIRAM);
        return q ? q : realloc(p, n);
    }
};
extern PsramAllocator gPsram;
