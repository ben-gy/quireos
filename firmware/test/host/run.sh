#!/bin/sh
# Builds and runs the host tests with plain clang. Pass --generate to rewrite spec/conformance/wrap.json.
set -e
cd "$(dirname "$0")"
ROOT=$(cd ../../.. && pwd)
FW=$ROOT/firmware
OUT=build
mkdir -p "$OUT/obj"
CXX="${CXX:-clang++}"
CXXFLAGS="-std=c++17 -O1 -g -Wall -Wno-unused-parameter -Wno-deprecated-declarations -I $FW/src"
NEWEST_HDR=$(find "$FW/src" -name '*.h' -newer "$OUT/obj/.stamp" 2>/dev/null | head -1)

compile() {
  src=$1; obj=$2
  if [ -f "$obj" ] && [ ! "$src" -nt "$obj" ] && [ -z "$NEWEST_HDR" ]; then return; fi
  case "$src" in
    *.c) clang -std=c11 -O2 -w -c "$src" -o "$obj" ;;
    *)   $CXX $CXXFLAGS -c "$src" -o "$obj" ;;
  esac
}
LIBOBJS=""
JOBS=0
for src in $FW/src/hal/hal.cpp $FW/src/runtime/*.cpp $FW/src/boards/host/*.cpp $FW/src/runtime/third_party/pngle.c $FW/src/runtime/third_party/miniz.c; do
  obj="$OUT/obj/$(basename "$src").o"
  LIBOBJS="$LIBOBJS $obj"
  compile "$src" "$obj" &
  JOBS=$((JOBS + 1)); if [ $JOBS -ge 8 ]; then wait; JOBS=0; fi
done
wait
touch "$OUT/obj/.stamp"

STATUS=0
for t in expr_test wrap_test parser_test session_test hal_contract_test; do
  $CXX $CXXFLAGS "$t.cpp" $LIBOBJS -lcurl -lz -o "$OUT/$t"
  if [ "$t" = wrap_test ] && [ "$1" = "--generate" ]; then "$OUT/$t" "$ROOT" --generate || STATUS=1
  else "$OUT/$t" "$ROOT" || STATUS=1; fi
done
sh portability_check.sh || STATUS=1
if [ $STATUS -eq 0 ]; then echo "ALL TESTS PASSED"; else echo "TESTS FAILED"; fi
exit $STATUS
