#!/bin/bash
# Build flaker binary.
# Requires: brew install duckdb
set -e

BREW_PREFIX="${HOMEBREW_PREFIX:-$(brew --prefix 2>/dev/null || echo /opt/homebrew)}"
BUILD_DIR="_build/native/debug/build"
BINARY="${BUILD_DIR}/cmd/flaker_native/flaker_native"

# Step 1: Generate C via moon (ignore link failure — moon doesn't pass cc-link-flags)
C_INCLUDE_PATH="$BREW_PREFIX/include" \
LIBRARY_PATH="$BREW_PREFIX/lib" \
moon build --target native src/cmd/flaker_native 2>/dev/null || true

if [ ! -f "${BINARY}.c" ]; then
  echo "Error: MoonBit compilation failed."
  exit 1
fi

# Step 2: Link
echo "Linking..."
cc -O2 -o dist/flaker \
  -I"$HOME/.moon/include" \
  "$HOME/.moon/lib/libmoonbitrun.o" \
  "${BINARY}.c" \
  "${BUILD_DIR}/runtime.o" \
  "${BUILD_DIR}/.mooncakes/mizchi/duckdb/libduckdb.a" \
  ${BUILD_DIR}/.mooncakes/moonbitlang/async/internal/*/lib*.a \
  ${BUILD_DIR}/.mooncakes/moonbitlang/async/os_error/lib*.a \
  ${BUILD_DIR}/.mooncakes/moonbitlang/async/socket/lib*.a \
  ${BUILD_DIR}/.mooncakes/moonbitlang/async/tls/lib*.a \
  ${BUILD_DIR}/.mooncakes/moonbitlang/async/fs/lib*.a \
  ${BUILD_DIR}/.mooncakes/moonbitlang/x/fs/lib*.a \
  ${BUILD_DIR}/.mooncakes/mizchi/zlib/lib*.a \
  -L"$BREW_PREFIX/lib" \
  -lduckdb -lz -lm \
  "$HOME/.moon/lib/libbacktrace.a" \
  -Wl,-rpath,"$BREW_PREFIX/lib" \
  -Wl,-rpath,@executable_path

mkdir -p dist
echo ""
ls -lh dist/flaker
file dist/flaker
echo ""
echo "Run: dist/flaker --help"
