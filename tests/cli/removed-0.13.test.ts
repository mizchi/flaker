import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/cli/config.js";
import { parseSamplingMode } from "../../src/cli/commands/exec/sampling-options.js";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function configDir(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-removed-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${toml}`);
  return dir;
}

function help(...args: string[]): string {
  const res = spawnSync("node", [CLI, ...args, "--help"], { encoding: "utf8" });
  return res.stdout;
}

describe("strategies removed in 0.13.0", () => {
  for (const mode of ["random", "gbdt", "coverage-guided"]) {
    it(`rejects ${mode}`, () => {
      expect(() => parseSamplingMode(mode)).toThrow(
        /Expected one of: weighted, affected, hybrid, full/,
      );
    });
  }

  it("run --help no longer offers cluster mode or a model path", () => {
    const out = help("run");
    expect(out).not.toContain("--cluster-mode");
    expect(out).not.toContain("--model-path");
    expect(out).not.toContain("--profile");
  });

  for (const [key, value] of [["cluster_mode", `"spread"`], ["model_path", `"m.json"`]]) {
    it(`rejects [sampling] ${key}`, () => {
      expect(() => loadConfig(configDir(`[sampling]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[sampling\\] was removed in 0.13.0`),
      );
    });
    it(`rejects [gate.merge] ${key}`, () => {
      expect(() => loadConfig(configDir(`[gate.merge]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[gate\\.merge\\] was removed in 0.13.0`),
      );
    });
  }

  it("rejects [coverage]", () => {
    expect(() => loadConfig(configDir(`[coverage]\nformat = "istanbul"\ninput = "c.json"\n`))).toThrow(
      /\[coverage\] was removed in 0.13.0/,
    );
  });

  it("rejects a removed strategy value in config", () => {
    expect(() => loadConfig(configDir(`[gate.merge]\nstrategy = "gbdt"\n`))).toThrow(
      /strategy "gbdt" in \[gate\.merge\] was removed in 0.13.0/,
    );
  });

  it("dev train is gone", () => {
    const res = spawnSync("node", [CLI, "dev", "train"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});
