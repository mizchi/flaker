#!/bin/bash
# Build the native flaker binary into dist/flaker.
# Requires libduckdb: brew install duckdb, or DUCKDB_PREFIX pointing at a
# directory with include/duckdb.h and lib/libduckdb.* (a release zip unpacked
# flat works too: set DUCKDB_PREFIX to that directory).
set -e

BREW_PREFIX="${HOMEBREW_PREFIX:-$(brew --prefix 2>/dev/null || echo /opt/homebrew)}"
DUCKDB_PREFIX="${DUCKDB_PREFIX:-$BREW_PREFIX}"
INCLUDE_DIR="$DUCKDB_PREFIX/include"; [ -f "$INCLUDE_DIR/duckdb.h" ] || INCLUDE_DIR="$DUCKDB_PREFIX"
LIB_DIR="$DUCKDB_PREFIX/lib"; [ -d "$LIB_DIR" ] || LIB_DIR="$DUCKDB_PREFIX"

# src/cmd/flaker_native/moon.pkg names -lduckdb, so moon links the binary itself.
C_INCLUDE_PATH="$INCLUDE_DIR" LIBRARY_PATH="$LIB_DIR" \
  moon build --target native --release src/cmd/flaker_native

mkdir -p dist
cp _build/native/release/build/cmd/flaker_native/flaker_native.exe dist/flaker
echo ""
ls -lh dist/flaker
file dist/flaker
echo ""
echo "Run: dist/flaker --help (DYLD_LIBRARY_PATH / LD_LIBRARY_PATH=$LIB_DIR if libduckdb is not on the default path)"
