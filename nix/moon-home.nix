{ pkgs, toolchain, moonNix, registry }:
let
  manifest = moonNix.parseManifest "module" (builtins.readFile ../moon.mod);
  resolution = moonNix.resolveDependencies { root = manifest; inherit registry; };
  archives = map (module: {
    inherit (module) name version;
    src = pkgs.fetchurl {
      url = module.entry.url or "https://download.mooncakes.io/user/${module.name}/${module.version}.zip";
      sha256 = module.entry.checksum;
    };
  }) (builtins.attrValues resolution.modules);
  cachedRegistry = pkgs.runCommand "flaker-moon-registry" { } (''
    mkdir -p $out/registry/index
    cp -r ${registry}/user $out/registry/index/
  '' + pkgs.lib.concatMapStringsSep "\n" (module: ''
    mkdir -p $out/registry/cache/${module.name}
    cp ${module.src} $out/registry/cache/${module.name}/${module.version}.zip
  '') archives);
in
pkgs.symlinkJoin {
  name = "flaker-moon-home";
  paths = [ toolchain cachedRegistry ];
}
