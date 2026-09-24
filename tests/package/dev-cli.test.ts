import { describe, expect, it, vi } from "vitest";
import {
  getMissingDevCliArtifacts,
  isDevCliBuildStale,
  main,
  parseDevCliArgs,
  resolveDevCliPaths,
} from "../../scripts/dev-cli.mjs";

describe("dev-cli helpers", () => {
  it("parses --rebuild and forwards remaining args", () => {
    expect(
      parseDevCliArgs(["node", "scripts/dev-cli.mjs", "--rebuild", "eval", "--markdown"]),
    ).toEqual({
      forceBuild: true,
      passthroughArgs: ["eval", "--markdown"],
    });
  });

  it("detects missing CLI artifacts", () => {
    const paths = resolveDevCliPaths("/workspace/flaker");

    expect(
      getMissingDevCliArtifacts(paths, (candidate) => candidate.endsWith("dist/cli/main.js")),
    ).toEqual([
      paths.bridgeEntry,
    ]);
  });

  it("treats newer source files as a stale build", () => {
    const paths = resolveDevCliPaths("/workspace/flaker");
    const mtimes = new Map([
      ["/workspace/flaker/dist/cli/main.js", 10],
      ["/workspace/flaker/dist/moonbit/flaker.js", 12],
      ["/workspace/flaker/src", 5],
      ["/workspace/flaker/src/cli", 5],
      ["/workspace/flaker/src/cli/main.ts", 20],
      ["/workspace/flaker/scripts", 5],
      ["/workspace/flaker/scripts/build-package.mjs", 9],
      ["/workspace/flaker/package.json", 8],
      ["/workspace/flaker/tsconfig.json", 8],
      ["/workspace/flaker/moon.mod.json", 8],
    ]);
    const directories = new Set([
      "/workspace/flaker/src",
      "/workspace/flaker/src/cli",
      "/workspace/flaker/scripts",
    ]);
    const children = new Map([
      ["/workspace/flaker/src", ["cli"]],
      ["/workspace/flaker/src/cli", ["main.ts"]],
      ["/workspace/flaker/scripts", ["build-package.mjs"]],
    ]);
    const exists = (candidate: string) => mtimes.has(candidate) || directories.has(candidate);
    const stat = (candidate: string) => ({
      mtimeMs: mtimes.get(candidate) ?? 0,
      isDirectory: () => directories.has(candidate),
    });
    const readdir = (candidate: string) => children.get(candidate) ?? [];

    expect(isDevCliBuildStale(paths, { exists, stat, readdir })).toBe(true);
  });

  it("builds missing artifacts and preserves the caller cwd for CLI execution", () => {
    const spawnSync = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    const exitCode = main(
      ["node", "scripts/dev-cli.mjs", "eval", "--json"],
      {
        repoRoot: "/workspace/flaker",
        invocationCwd: "/workspace/sample-webapp-2026",
        exists: () => false,
        spawnSync,
        execPath: "/usr/local/bin/node",
        stderr: () => {},
      },
    );

    expect(exitCode).toBe(0);
    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "/usr/local/bin/node",
      ["/workspace/flaker/scripts/build-package.mjs"],
      expect.objectContaining({
        cwd: "/workspace/flaker",
        stdio: "inherit",
      }),
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "/usr/local/bin/node",
      ["/workspace/flaker/dist/cli/main.js", "eval", "--json"],
      expect.objectContaining({
        cwd: "/workspace/sample-webapp-2026",
        stdio: "inherit",
      }),
    );
  });

  it("forces a rebuild when --rebuild is given", () => {
    const spawnSync = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });

    main(
      ["node", "scripts/dev-cli.mjs", "--rebuild", "run", "--gate", "iteration"],
      {
        repoRoot: "/workspace/flaker",
        invocationCwd: "/workspace/sample-webapp-2026",
        exists: () => true,
        spawnSync,
        execPath: "/usr/local/bin/node",
        stderr: () => {},
      },
    );

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "/usr/local/bin/node",
      ["/workspace/flaker/scripts/build-package.mjs"],
      expect.objectContaining({
        cwd: "/workspace/flaker",
      }),
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "/usr/local/bin/node",
      ["/workspace/flaker/dist/cli/main.js", "run", "--gate", "iteration"],
      expect.objectContaining({
        cwd: "/workspace/sample-webapp-2026",
      }),
    );
  });

  it("rebuilds automatically when source files are newer than dist", () => {
    const spawnSync = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });
    const mtimes = new Map([
      ["/workspace/flaker/dist/cli/main.js", 10],
      ["/workspace/flaker/dist/moonbit/flaker.js", 10],
      ["/workspace/flaker/src", 5],
      ["/workspace/flaker/src/cli", 5],
      ["/workspace/flaker/src/cli/main.ts", 20],
      ["/workspace/flaker/scripts", 5],
      ["/workspace/flaker/scripts/build-package.mjs", 9],
      ["/workspace/flaker/package.json", 8],
      ["/workspace/flaker/tsconfig.json", 8],
      ["/workspace/flaker/moon.mod.json", 8],
    ]);
    const directories = new Set([
      "/workspace/flaker/src",
      "/workspace/flaker/src/cli",
      "/workspace/flaker/scripts",
    ]);
    const children = new Map([
      ["/workspace/flaker/src", ["cli"]],
      ["/workspace/flaker/src/cli", ["main.ts"]],
      ["/workspace/flaker/scripts", ["build-package.mjs"]],
    ]);
    const exists = (candidate: string) => mtimes.has(candidate) || directories.has(candidate);
    const stat = (candidate: string) => ({
      mtimeMs: mtimes.get(candidate) ?? 0,
      isDirectory: () => directories.has(candidate),
    });
    const readdir = (candidate: string) => children.get(candidate) ?? [];

    main(
      ["node", "scripts/dev-cli.mjs", "affected", "--changed", "src/cli/main.ts"],
      {
        repoRoot: "/workspace/flaker",
        invocationCwd: "/workspace/flaker",
        exists,
        stat,
        readdir,
        spawnSync,
        execPath: "/usr/local/bin/node",
        stderr: () => {},
      },
    );

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "/usr/local/bin/node",
      ["/workspace/flaker/scripts/build-package.mjs"],
      expect.objectContaining({
        cwd: "/workspace/flaker",
      }),
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "/usr/local/bin/node",
      ["/workspace/flaker/dist/cli/main.js", "affected", "--changed", "src/cli/main.ts"],
      expect.objectContaining({
        cwd: "/workspace/flaker",
      }),
    );
  });
});
