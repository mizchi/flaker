import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function cleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-clean-tree-"));
  writeFileSync(
    join(dir, "flaker.toml"),
    [
      "[repo]", 'owner = "a"', 'name = "b"',
      "[runner]", 'type = "vitest"', 'command = "true"',
      "[affected]", 'resolver = "git"', 'config = ""',
      "[gate.iteration]", 'strategy = "affected"', 'fallback_strategy = "weighted"',
      "[gate.merge]", 'strategy = "hybrid"', "sample_percentage = 30",
      "",
    ].join("\n"),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

describe("run on a clean tree (no changed files)", () => {
  for (const gate of ["iteration", "merge"]) {
    it(`--gate ${gate} --dry-run does not fail for lack of changed files`, () => {
      const res = spawnSync("node", [CLI, "run", "--gate", gate, "--dry-run"], {
        cwd: cleanRepo(),
        encoding: "utf8",
        env: { ...process.env, CI: "", GITHUB_ACTIONS: "", FLAKER_GATE: "" },
      });
      expect(res.stderr).not.toContain("requires");
      expect(res.status).toBe(0);
    });
  }

  it("--gate merge --changed \"\" (an empty-diff PR, issue #90) samples instead of throwing", () => {
    const res = spawnSync("node", [CLI, "run", "--gate", "merge", "--changed", "", "--dry-run"], {
      cwd: cleanRepo(),
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", FLAKER_GATE: "" },
    });
    expect(res.stderr).not.toContain("requires");
    expect(res.status).toBe(0);
  });
});
