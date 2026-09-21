// hal system functions for the T5 E-Paper S3 Pro: FreeRTOS threads and mutexes, timing, PSRAM
// allocation, logging to the USB serial port, reboot and the hardware id.
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "board_t5pro.h"

namespace quire {
namespace hal {

namespace {
struct ThreadArgs {
  ThreadFn fn;
  void *arg;
};
void trampoline(void *p) {
  ThreadArgs a = *(ThreadArgs *)p;
  delete (ThreadArgs *)p;
  a.fn(a.arg);
  vTaskDelete(nullptr);   // a returning thread must not fall off the end of a FreeRTOS task
}
}  // namespace

bool thread_start(const char *name, ThreadFn fn, void *arg, size_t stack_bytes, int priority) {
  ThreadArgs *a = new ThreadArgs{fn, arg};
  TaskHandle_t h = nullptr;
  BaseType_t ok = xTaskCreatePinnedToCore(trampoline, name, stack_bytes, a, (UBaseType_t)priority, &h, 0);
  if (ok != pdPASS) {
    delete a;
    log(LOG_ERROR, "sys", "thread %s: cannot create (%u bytes)", name, (unsigned)stack_bytes);
    return false;
  }
  return true;
}

void *mutex_create() { return (void *)xSemaphoreCreateMutex(); }
void mutex_lock(void *m) {
  if (m) xSemaphoreTake((SemaphoreHandle_t)m, portMAX_DELAY);
}
void mutex_unlock(void *m) {
  if (m) xSemaphoreGive((SemaphoreHandle_t)m);
}

uint32_t millis() { return ::millis(); }
void delay_ms(uint32_t ms) { ::delay(ms); }

void yield() {
  esp_task_wdt_reset();   // no-op when the calling task is not subscribed
  vTaskDelay(1);
}

uint32_t random_u32() { return esp_random(); }

void *alloc_big(size_t bytes) {
  if (!bytes) bytes = 1;
  void *p = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!p) p = heap_caps_malloc(bytes, MALLOC_CAP_8BIT);
  return p;
}
void free_big(void *p) {
  if (p) heap_caps_free(p);
}

void log(LogLevel level, const char *tag, const char *fmt, ...) {
#ifdef QUIREOS_LOG_LEVEL
  if ((int)level > QUIREOS_LOG_LEVEL) return;
#endif
  static const char L[] = {'E', 'W', 'I', 'D'};
  char buf[256];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  Serial.printf("[%8lu] %c %s: %s\n", (unsigned long)::millis(), L[level & 3], tag ? tag : "-", buf);
}

void reboot() {
  log(LOG_INFO, "sys", "rebooting");
  t5pro::display_save_glass();
  Serial.flush();
  ::delay(50);
  ESP.restart();
}

const char *device_hw_id() {
  static char id[13] = {0};
  if (!id[0]) {
    uint64_t mac = ESP.getEfuseMac();   // byte 0 first
    for (int i = 0; i < 6; i++) snprintf(id + i * 2, 3, "%02x", (unsigned)((mac >> (8 * i)) & 0xFF));
  }
  return id;
}

}  // namespace hal
}  // namespace quire
