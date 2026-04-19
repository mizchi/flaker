import { describe, expect, it } from "vitest";
import {
  writeArtifact,
  serializePlanArtifact,
  serializeApplyArtifact,
} from "../../src/cli/commands/apply/artifact.js";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("artifact serializers", () => {
  it("plan artifact JSON is valid and contains diff / actions / probe", () => {
    const json = serializePlanArtifact({
      generatedAt: "2026-04-19T00:00:00Z",
      diff: { ok: false, drifts: [{ kind: "local_history_missing", actual: false, desired: true }] },
      actions: [{ kind: "cold_start_run", reason: "seed" } as any],
      probe: { hasGitRemote: true, hasGithubToken: false, hasLocalHistory: false },
    });
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("diff");
    expect(parsed).toHaveProperty("actions");
    expect(parsed).toHaveProperty("probe");
    expect(parsed.diff.drifts).toHaveLength(1);
  });

  it("apply artifact JSON includes executed", () => {
    const json = serializeApplyArtifact({
      generatedAt: "2026-04-19T00:00:00Z",
      diff: { ok: false, drifts: [] },
      actions: [],
      executed: [{ kind: "cold_start_run", status: "ok" } as any],
      probe: { hasGitRemote: true, hasGithubToken: false, hasLocalHistory: false },
    });
    const parsed = JSON.parse(json);
    expect(parsed.executed[0].status).toBe("ok");
  });

  it("writeArtifact creates parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-artifact-"));
    try {
      const target = join(dir, "nested/deep/artifact.json");
      writeArtifact(target, '{"hello":"world"}');
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, "utf8")).toContain("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("apply --emit CLI smoke", () => {
  it("`flaker apply --help` mentions --emit", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--emit");
  });
  it("`flaker apply --help` mentions --output", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.stdout).toContain("--output");
  });
  it("`flaker plan --help` mentions --output", () => {
    const res = spawnSync("node", [CLI, "plan", "--help"], { encoding: "utf8" });
    expect(res.stdout).toContain("--output");
  });
});
