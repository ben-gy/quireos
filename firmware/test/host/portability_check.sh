#!/bin/sh
# Fails when the portable core includes anything board-specific.
cd "$(dirname "$0")/../.."
BAD=$(grep -rnE '#include[[:space:]]*[<"](Arduino\.h|Wire\.h|epdiy|epd_|SensorLib|freertos|esp_|driver/|WiFi|HTTPClient|Preferences\.h|LittleFS)' src/os src/runtime src/hal 2>/dev/null | grep -v third_party/)
if [ -n "$BAD" ]; then
  echo "portability_check: forbidden includes in the portable core:"
  echo "$BAD"
  exit 1
fi
BAD2=$(grep -rnE '\b(digitalWrite|pinMode|Wire\.|vTaskDelay|xTaskCreate|heap_caps_|ESP\.|esp_deep_sleep)' src/os src/runtime src/hal 2>/dev/null | grep -v third_party/)
if [ -n "$BAD2" ]; then
  echo "portability_check: board/RTOS calls in the portable core:"
  echo "$BAD2"
  exit 1
fi
echo "portability_check: ok (src/os, src/runtime, src/hal include only hal.h and the standard library)"
