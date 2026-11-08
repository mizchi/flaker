#!/usr/bin/env node

import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

export function resolveDevCliPaths(repoRoot = DEFAULT_REPO_ROOT) {
  return {
    repoRoot,
    buildScript: resolve(repoRoot, "scripts/build-package.mjs"),
    cliEntry: resolve(repoRoot, "dist/cli/main.js"),
    bridgeEntry: resolve(repoRoot, "dist/moonbit/flaker.js"),
  };
}

export function getDevCliSourceInputs(repoRoot = DEFAULT_REPO_ROOT) {
  return [
    resolve(repoRoot, "src"),
    resolve(repoRoot, "scripts"),
    resolve(repoRoot, "package.json"),
    resolve(repoRoot, "tsconfig.json"),
    resolve(repoRoot, "moon.mod"),
  ];
}

export function getMissingDevCliArtifacts(
  paths,
  exists = existsSync,
) {
  return [paths.cliEntry, paths.bridgeEntry].filter((candidate) => !exists(candidate));
}

function getNewestMtimeMs(
  candidate,
  deps,
) {
  if (!deps.exists(candidate)) {
    return 0;
  }

  const stat = deps.stat(candidate);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let newest = stat.mtimeMs;
  for (const entry of deps.readdir(candidate)) {
    newest = Math.max(newest, getNewestMtimeMs(resolve(candidate, entry), deps));
  }
  return newest;
}

export function isDevCliBuildStale(
  paths,
  deps = {
    exists: existsSync,
    stat: statSync,
    readdir: readdirSync,
  },
) {
  const artifacts = [paths.cliEntry, paths.bridgeEntry];
  if (artifacts.some((artifact) => !deps.exists(artifact))) {
    return false;
  }

  const oldestArtifactMtime = Math.min(
    ...artifacts.map((artifact) => deps.stat(artifact).mtimeMs),
  );
  const newestSourceMtime = Math.max(
    ...getDevCliSourceInputs(paths.repoRoot).map((candidate) =>
      getNewestMtimeMs(candidate, deps)
    ),
  );
  return newestSourceMtime > oldestArtifactMtime;
}

export function parseDevCliArgs(argv) {
  const passthroughArgs = [];
  let forceBuild = false;
  let passthroughMode = false;

  for (const arg of argv.slice(2)) {
    if (passthroughMode) {
      passthroughArgs.push(arg);
      continue;
    }
    if (arg === "--") {
      passthroughMode = true;
      continue;
    }
    if (arg === "--rebuild") {
      forceBuild = true;
      continue;
    }
    passthroughArgs.push(arg);
  }

  return {
    forceBuild,
    passthroughArgs,
  };
}

function run(command, args, opts) {
  const result = opts.spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export function main(argv = process.argv, deps = {}) {
  const repoRoot = deps.repoRoot ?? DEFAULT_REPO_ROOT;
  const invocationCwd = deps.invocationCwd
    ?? process.env.INIT_CWD
    ?? process.cwd();
  const spawnSync = deps.spawnSync ?? defaultSpawnSync;
  const execPath = deps.execPath ?? process.execPath;
  const stderr = deps.stderr ?? ((message) => console.error(message));
  const paths = resolveDevCliPaths(repoRoot);
  const { forceBuild, passthroughArgs } = parseDevCliArgs(argv);
  const missingArtifacts = getMissingDevCliArtifacts(
    paths,
    deps.exists ?? existsSync,
  );
  const buildIsStale =
    !forceBuild && missingArtifacts.length === 0
      ? isDevCliBuildStale(paths, {
          exists: deps.exists ?? existsSync,
          stat: deps.stat ?? statSync,
          readdir: deps.readdir ?? readdirSync,
        })
      : false;

  if (forceBuild || missingArtifacts.length > 0 || buildIsStale) {
    const reason = forceBuild
      ? "--rebuild requested"
      : missingArtifacts.length > 0
      ? `missing ${missingArtifacts.map((path) => path.replace(`${repoRoot}/`, "")).join(", ")}`
      : "source is newer than dist";
    stderr(`[flaker dev-cli] building package (${reason})`);
    const buildExitCode = run(execPath, [paths.buildScript], {
      spawnSync,
      cwd: repoRoot,
    });
    if (buildExitCode !== 0) {
      return buildExitCode;
    }
  }

  return run(execPath, [paths.cliEntry, ...passthroughArgs], {
    spawnSync,
    cwd: invocationCwd,
  });
}

function isDirectExecution(metaUrl = import.meta.url, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return fileURLToPath(metaUrl) === resolve(argv1);
}

if (isDirectExecution()) {
  process.exit(main(process.argv));
}
