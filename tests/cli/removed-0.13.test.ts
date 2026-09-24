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

describe("adaptive sampling removed in 0.13.0", () => {
  for (const key of [
    "adaptive",
    "adaptive_fnr_low_ratio",
    "adaptive_fnr_high_ratio",
    "adaptive_min_percentage",
    "adaptive_step",
    "adaptive_fnr_low",
    "adaptive_fnr_high",
  ]) {
    it(`rejects [gate.merge] ${key}`, () => {
      const value = key === "adaptive" ? "true" : "1";
      expect(() => loadConfig(configDir(`[gate.merge]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[gate\\.merge\\] was removed in 0.13.0`),
      );
    });
  }
});

describe("apply and ops surface in 0.13.0", () => {
  it("apply no longer takes --emit, --target or --incident-*", () => {
    const out = help("apply");
    for (const flag of ["--emit", "--target", "--incident-run", "--incident-suite", "--incident-test", "--incident-repeat", "--incident-runner"]) {
      expect(out).not.toContain(flag);
    }
    for (const flag of ["--json", "--output", "--refresh-only", "--plan-file", "--force"]) {
      expect(out).toContain(flag);
    }
  });

  for (const sub of ["weekly", "incident"]) {
    it(`ops ${sub} is gone`, () => {
      const res = spawnSync("node", [CLI, "ops", sub], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});

describe("help text in 0.13.0", () => {
  const top = spawnSync("node", [CLI, "--help"], { encoding: "utf8" }).stdout;

  it("does not list dev or ops", () => {
    expect(top).not.toMatch(/^\s+dev\b/m);
    expect(top).not.toMatch(/^\s+ops\b/m);
  });

  it("init no longer claims to alias setup init", () => {
    expect(top).not.toContain("setup init");
  });

  it("dev is still runnable", () => {
    const res = spawnSync("node", [CLI, "dev", "test-key", "--suite", "a", "--test-name", "b"], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
