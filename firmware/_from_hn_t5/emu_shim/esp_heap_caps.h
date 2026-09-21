#pragma once
#include <stdlib.h>
#define MALLOC_CAP_SPIRAM 0
#define MALLOC_CAP_8BIT   0
#define MALLOC_CAP_DMA    0
static inline void *heap_caps_malloc(size_t n, int c)            { (void)c; return malloc(n); }
static inline void *heap_caps_realloc(void *p, size_t n, int c)  { (void)c; return realloc(p, n); }
static inline void  heap_caps_free(void *p)                      { free(p); }
static inline void *ps_calloc(size_t n, size_t m)                { return calloc(n, m); }
static inline void *ps_malloc(size_t n)                          { return malloc(n); }
