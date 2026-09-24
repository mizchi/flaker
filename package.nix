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

    # src/cmd/flaker_native/moon.pkg names -lduckdb, so moon links the
    # binary itself; LIBRARY_PATH lets the linker find the nix libduckdb.
    C_INCLUDE_PATH="${duckdb.dev}/include:${zlib.dev}/include" \
    LIBRARY_PATH="${duckdb.dev}/lib:${duckdb.lib}/lib:${zlib}/lib" \
    NIX_LDFLAGS="$NIX_LDFLAGS -rpath ${duckdb.lib}/lib" \
    moon build --target native --release src/cmd/flaker_native

    cp _build/native/release/build/cmd/flaker_native/flaker_native.exe flaker

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
