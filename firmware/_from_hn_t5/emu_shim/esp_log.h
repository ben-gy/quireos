#pragma once
#include <stdio.h>
#define ESP_LOGE(tag, f, ...) fprintf(stderr, "[E][%s] " f "\n", tag, ##__VA_ARGS__)
#define ESP_LOGW(tag, f, ...) fprintf(stderr, "[W][%s] " f "\n", tag, ##__VA_ARGS__)
#define ESP_LOGI(tag, f, ...) fprintf(stderr, "[I][%s] " f "\n", tag, ##__VA_ARGS__)
#define ESP_LOGD(tag, f, ...)
