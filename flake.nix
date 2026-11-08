{
  description = "flaker – Intelligent test selection toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    moonbit-overlay.url = "github:moonbit-community/moonbit-overlay";
    moonbit-overlay.inputs.nixpkgs.follows = "nixpkgs";
    moon-nix.url = "github:moonbit-community/moon-nix";
    moon-nix.inputs.nixpkgs.follows = "nixpkgs";
    moon-nix.inputs.moonbit-overlay.follows = "moonbit-overlay";
    moon-registry = {
      url = "git+https://mooncakes.io/git/index";
      flake = false;
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      flake = {
        overlays.default = final: _prev: {
          flaker = final.callPackage ./package.nix {
            moonHome = import ./nix/moon-home.nix {
              pkgs = final;
              toolchain = inputs.moonbit-overlay.packages.${final.stdenv.hostPlatform.system}.latest;
              moonNix = inputs.moon-nix.lib.mkMoonNix {
                pkgs = final;
                toolchain = inputs.moonbit-overlay.packages.${final.stdenv.hostPlatform.system}.latest;
              };
              registry = inputs.moon-registry.outPath;
            };
          };
        };
      };

      perSystem =
        { system, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ inputs.moonbit-overlay.overlays.default ];
            config.allowBroken = true;
          };

          toolchain = pkgs.moonbit-bin.latest;
          moonNix = inputs.moon-nix.lib.mkMoonNix {
            inherit pkgs toolchain;
          };
          moonHome = import ./nix/moon-home.nix {
            inherit pkgs toolchain moonNix;
            registry = inputs.moon-registry.outPath;
          };
          flaker = pkgs.callPackage ./package.nix { inherit moonHome; };
        in
        {
          packages = {
            default = flaker;
            inherit flaker;
          };

          apps = {
            default = {
              type = "app";
              program = "${flaker}/bin/flaker";
            };
            flaker = {
              type = "app";
              program = "${flaker}/bin/flaker";
            };
          };

          devShells.default = pkgs.mkShellNoCC {
            packages = [
              toolchain
              pkgs.git
              pkgs.just
              pkgs.pnpm
              pkgs.nodejs_24
              pkgs.duckdb
              pkgs.zlib
            ];
            shellHook = ''
              export MOON_HOME="''${XDG_CACHE_HOME:-$HOME/.cache}/flaker/moonbit-${toolchain.version}"
              mkdir -p "$MOON_HOME"
              for directory in bin lib include; do
                ln -sfn "${toolchain}/$directory" "$MOON_HOME/$directory"
              done
            '';
          };
        };
    };
}
