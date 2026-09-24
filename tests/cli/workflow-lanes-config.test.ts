import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, normalizeWorkflowLanes, validateConfigRanges, type FlakerConfig } from "../../src/cli/config.js";
import { runDoctor } from "../../src/cli/commands/debug/doctor.js";
import { FlakerUsageError } from "../../src/cli/errors.js";

describe("normalizeWorkflowLanes", () => {
  it("keeps the string form as it is", () => {
    expect(normalizeWorkflowLanes({ "ci.yml": "sampled" })).toEqual({
      lanes: { "ci.yml": "sampled" },
      fullByLane: {},
    });
  });

  it("reads { lane, full } and records full per lane", () => {
    expect(normalizeWorkflowLanes({
      "nightly.yml": { lane: "full-batch", full: true },
      "pr.yml": { lane: "sampled", full: false },
      "e2e.yml": { lane: "e2e" },
    })).toEqual({
      lanes: { "nightly.yml": "full-batch", "pr.yml": "sampled", "e2e.yml": "e2e" },
      fullByLane: { "full-batch": true, sampled: false },
    });
  });

  it("is empty for a missing section", () => {
    expect(normalizeWorkflowLanes(undefined)).toEqual({ lanes: {}, fullByLane: {} });
  });

  it("rejects a table without a lane, a non-boolean full, and conflicting full values", () => {
    expect(() => normalizeWorkflowLanes({ x: { full: true } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({ x: { lane: "a", full: "yes" } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({
      x: { lane: "a", full: true },
      y: { lane: "a", full: false },
    })).toThrow(/conflicting full/);
  });
});

describe("[workflow_lanes] validation on load", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const write = (lanes: string) => {
    dir = mkdtempSync(join(tmpdir(), "flaker-lanes-"));
    writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "o"\nname = "r"\n\n[workflow_lanes]\n${lanes}\n`);
    return dir;
  };

  it("loadConfig rejects a table entry without a lane", () => {
    expect(() => loadConfig(write(`"nightly.yml" = { full = true }`))).toThrow(FlakerUsageError);
  });

  it("loadConfig accepts both forms", () => {
    const config = loadConfig(write(`"ci.yml" = "sampled"\n"nightly.yml" = { lane = "full-batch", full = true }`));
    expect(normalizeWorkflowLanes(config.workflow_lanes).fullByLane).toEqual({ "full-batch": true });
  });

  it("validateConfigRanges reports a malformed entry", () => {
    const config = { ...loadConfig(write(`"ci.yml" = "sampled"`)), workflow_lanes: { x: { lane: "a", full: "yes" } } };
    const errors = validateConfigRanges(config as unknown as FlakerConfig);
    expect(errors.map((e) => e.path)).toContain("workflow_lanes");
  });

  it("doctor fails the config check with the lane message", async () => {
    const cwd = write(`"nightly.yml" = { full = true }`);
    const report = await runDoctor(cwd, {
      hasMoonBitBuild: async () => true,
      createStore: () => ({ initialize: async () => {}, close: async () => {} }),
    });
    const config = report.checks.find((c) => c.name === "config");
    expect(config?.ok).toBe(false);
    expect(config?.detail).toMatch(/workflow_lanes/);
  });
});
