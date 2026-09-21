#!/bin/sh
# Build the QuireOS emulator for macOS: src/hal + src/runtime + src/os + boards/host + emu.
# Objects are rebuilt when their source (or any header under src/) is newer.
set -e
cd "$(dirname "$0")/.."
OUT=emu/build
mkdir -p "$OUT/obj"
CXX="${CXX:-clang++}"
CC="${CC:-clang}"
CXXFLAGS="-std=c++17 -O1 -g -Wall -Wno-unused-parameter -Wno-deprecated-declarations -I src -DQUIREOS_BOARD_HOST"
CFLAGS="-std=c11 -O2 -w"
NEWEST_HDR=$(find src -name '*.h' -newer "$OUT/obj/.stamp" 2>/dev/null | head -1)

compile() {  # compile <src> <obj>
  src=$1; obj=$2
  if [ -f "$obj" ] && [ ! "$src" -nt "$obj" ] && [ -z "$NEWEST_HDR" ]; then return; fi
  case "$src" in
    *.c) echo "  cc  $src"; $CC $CFLAGS -c "$src" -o "$obj" ;;
    *)   echo "  c++ $src"; $CXX $CXXFLAGS -c "$src" -o "$obj" ;;
  esac
}

OBJS=""
JOBS=0
for src in src/hal/hal.cpp src/runtime/*.cpp src/os/*.cpp src/boards/host/*.cpp emu/*.cpp src/runtime/third_party/pngle.c src/runtime/third_party/miniz.c; do
  obj="$OUT/obj/$(echo "$src" | tr '/' '_').o"
  OBJS="$OBJS $obj"
  compile "$src" "$obj" &
  JOBS=$((JOBS + 1))
  if [ $JOBS -ge 8 ]; then wait; JOBS=0; fi
done
wait
touch "$OUT/obj/.stamp"
$CXX $OBJS -lcurl -lz -o "$OUT/quireos-emu"
echo "built $OUT/quireos-emu"
