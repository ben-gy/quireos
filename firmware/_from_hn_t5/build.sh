#!/bin/sh
# Build the HN reader for macOS with host stand-ins for the panel, input and radio.
set -e
cd "$(dirname "$0")/.."
AJ=.pio/libdeps/t5-s3/ArduinoJson/src
OUT=emu/build
mkdir -p "$OUT"
COMMON="-O1 -g -w -I emu/shim -I src -I emu"
clang -std=c11 $COMMON -c src/glyph.c -o "$OUT/glyph.o"
clang++ -std=c++17 $COMMON -I "$AJ" \
  -DARDUINOJSON_ENABLE_ARDUINO_STRING=1 -DARDUINOJSON_ENABLE_ARDUINO_STREAM=1 -DARDUINOJSON_ENABLE_ARDUINO_PRINT=1 \
  src/text.cpp src/reader.cpp src/hn.cpp src/store.cpp src/ui.cpp \
  emu/gfx_host.cpp emu/http_host.cpp emu/net_host.cpp emu/button_host.cpp emu/server.cpp \
  "$OUT/glyph.o" -lcurl -o "$OUT/hn-emu"
echo "built $OUT/hn-emu"
