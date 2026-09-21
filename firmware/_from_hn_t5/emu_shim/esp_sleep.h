#pragma once
enum { ESP_SLEEP_WAKEUP_UNDEFINED = 0, ESP_SLEEP_WAKEUP_EXT0 = 2, ESP_SLEEP_WAKEUP_EXT1 = 3, ESP_SLEEP_WAKEUP_TIMER = 4 };
enum { ESP_EXT1_WAKEUP_ALL_LOW = 0, ESP_EXT1_WAKEUP_ANY_HIGH = 1 };
inline void esp_sleep_enable_ext1_wakeup(unsigned long long, int) {}
int  esp_sleep_get_wakeup_cause();
void esp_sleep_enable_ext0_wakeup(int pin, int level);
void esp_deep_sleep_start();
