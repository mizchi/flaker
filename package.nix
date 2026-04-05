{
  lib,
  git,
  duckdb,
  zlib,
  autoPatchelfHook,
  stdenv,
  moonPlatform,
  moonRegistryIndex,
}:
let
  moonHome = moonPlatform.bundleWithRegistry {
    cachedRegistry = moonPlatform.buildCachedRegistry {
      moonModJson = ./moon.mod.json;
      registryIndexSrc = moonRegistryIndex;
    };
  };
in
stdenv.mkDerivation {
  pname = "flaker";
  version = "0.0.3";
  src = ./.;

  nativeBuildInputs = [
    moonHome
  ] ++ lib.optionals stdenv.isLinux [ autoPatchelfHook ];

  buildInputs = [
    duckdb.dev
    zlib.dev
  ];

  propagatedBuildInputs = [
    git
    duckdb.lib
    zlib
  ];

  buildPhase = ''
    runHook preBuild

    export MOON_HOME=$(mktemp -d)
    cp -rL ${moonHome}/* $MOON_HOME/
    chmod -R u+w $MOON_HOME
    export HOME=$TMPDIR

    # Step 1: Generate C sources (link will fail due to missing -L flags)
    C_INCLUDE_PATH="${duckdb.dev}/include:${zlib.dev}/include" \
    LIBRARY_PATH="${duckdb.dev}/lib:${zlib}/lib" \
    moon build --target native --release src/cmd/flaker_native 2>/dev/null || true

    BUILD_DIR="_build/native/release/build"
    BINARY="$BUILD_DIR/cmd/flaker_native/flaker_native"

    if [ ! -f "$BINARY.c" ]; then
      echo "Error: MoonBit compilation failed to generate C source."
      exit 1
    fi

    # Step 2: Link with explicit library paths
    cc -O2 -o flaker \
      -I"$MOON_HOME/include" \
      "$MOON_HOME/lib/libmoonbitrun.o" \
      "$BINARY.c" \
      "$BUILD_DIR/runtime.o" \
      $BUILD_DIR/cmd/flaker_native/shell_native.o \
      $BUILD_DIR/.mooncakes/f4ah6o/duckdb/libduckdb.a \
      $BUILD_DIR/.mooncakes/moonbitlang/async/internal/*/lib*.a \
      $BUILD_DIR/.mooncakes/moonbitlang/async/os_error/lib*.a \
      $BUILD_DIR/.mooncakes/moonbitlang/async/socket/lib*.a \
      $BUILD_DIR/.mooncakes/moonbitlang/async/tls/lib*.a \
      $BUILD_DIR/.mooncakes/moonbitlang/async/fs/lib*.a \
      $BUILD_DIR/.mooncakes/moonbitlang/x/fs/lib*.a \
      $BUILD_DIR/.mooncakes/mizchi/zlib/lib*.a \
      -L"${duckdb.dev}/lib" -L"${zlib}/lib" \
      -lduckdb -lz -lm \
      "$MOON_HOME/lib/libbacktrace.a" \
      ${lib.optionalString stdenv.isDarwin ''-Wl,-rpath,${duckdb.lib}/lib''}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    install -Dm755 flaker $out/bin/flaker
    runHook postInstall
  '';

  meta = {
    description = "Intelligent test selection toolkit";
    homepage = "https://github.com/mizchi/flaker";
    mainProgram = "flaker";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
  };
}
