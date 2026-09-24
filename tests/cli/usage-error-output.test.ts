import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function projectDir(extraToml = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-usage-error-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${extraToml}`);
  return dir;
}

function runCli(cwd: string, args: string[], env: Record<string, string> = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.FLAKER_PROFILE;
  delete baseEnv.FLAKER_GATE;
  return spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...baseEnv, ...env },
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function expectUsageError(res: ReturnType<typeof runCli>, line: string) {
  expect(res.status).toBe(2);
  expect(countOccurrences(res.stderr, line)).toBe(1);
  expect(res.stderr).not.toContain("Run 'flaker init'");
  expect(res.stderr).not.toMatch(/^\s+at /m);
}

describe("usage errors print once without a stack trace", () => {
  it("renamed [profile.ci] section", () => {
    const res = runCli(projectDir(`[profile.ci]\nstrategy = "weighted"\n`), ["status"]);
    expectUsageError(res, "[profile.ci] was renamed to [gate.merge]");
    expect(res.stderr).toMatch(/^Error: flaker\.toml uses removed or renamed keys/m);
  });

  it("FLAKER_PROFILE env var", () => {
    const res = runCli(projectDir(), ["run", "--dry-run"], { FLAKER_PROFILE: "ci" });
    expectUsageError(
      res,
      "Error: FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0 (ci → merge). See docs/migration-0.12-to-0.13.md.",
    );
  });

  it("removed --strategy random", () => {
    const res = runCli(projectDir(), ["run", "--strategy", "random", "--dry-run"]);
    expectUsageError(
      res,
      "Error: Unknown sampling strategy: random. Expected one of: weighted, affected, hybrid, full",
    );
  });

  it("unknown gate", () => {
    const res = runCli(projectDir(), ["run", "--gate", "nope", "--dry-run"]);
    expectUsageError(res, "Error: Unknown gate 'nope'. Expected one of: iteration, merge, release.");
  });

  it("missing config still suggests flaker init", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-usage-error-empty-"));
    const res = runCli(dir, ["status"]);
    expect(res.stderr).toContain("Config file not found");
    expect(res.stderr).toContain("flaker init");
  });
});
