#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const distDir = resolve(repoRoot, "dist");
const cliOutputFile = resolve(distDir, "cli/main.js");
const bridgeOutputFile = resolve(distDir, "moonbit/flaker.js");
const releaseBridgeFile = resolve(
  repoRoot,
  "_build/js/release/build/cmd/flaker/flaker.js",
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

await run("moon", ["build", "--target", "js", "--release"]);

if (!existsSync(releaseBridgeFile)) {
  throw new Error(`MoonBit bridge was not built: ${releaseBridgeFile}`);
}

rmSync(distDir, { recursive: true, force: true });

await build({
  input: resolve(repoRoot, "src/cli/entry.ts"),
  platform: "node",
  external: ["duckdb"],
  treeshake: false,
  output: {
    file: cliOutputFile,
    format: "esm",
    codeSplitting: false,
    sourcemap: false,
    banner: "#!/usr/bin/env node",
  },
});

mkdirSync(dirname(bridgeOutputFile), { recursive: true });
copyFileSync(releaseBridgeFile, bridgeOutputFile);
chmodSync(cliOutputFile, 0o755);
