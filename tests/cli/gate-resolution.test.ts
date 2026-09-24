import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/cli/config.js";
import { resolveGate, resolveGateName } from "../../src/cli/gate-config.js";
import { LEGACY_PROFILE_TO_GATE } from "../../src/cli/gate.js";

describe("loadConfig with gate sections", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-gate-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses [gate.*] sections into config.gate", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
flaky_tag_pattern = "@flaky"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.02

[gate.release]
strategy = "weighted"
sample_percentage = 30

[gate.merge]
strategy = "full"
max_duration_seconds = 300

[gate.iteration]
strategy = "weighted"
sample_percentage = 10
skip_flaky_tagged = true
`.trim(),
    );

    const config = loadConfig(dir);

    expect(config.gate).toBeDefined();
    expect(config.gate?.release).toEqual({
      strategy: "weighted",
      sample_percentage: 30,
    });
    expect(config.gate?.merge).toEqual({
      strategy: "full",
      max_duration_seconds: 300,
    });
    expect(config.gate?.iteration).toMatchObject({
      strategy: "weighted",
      sample_percentage: 10,
      skip_flaky_tagged: true,
    });
    expect(config.runner.flaky_tag_pattern).toBe("@flaky");
  });

  it("no gate sections → gate is undefined", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.02
`.trim(),
    );

    const config = loadConfig(dir);
    expect(config.gate).toBeUndefined();
  });
});

describe("resolveGateName", () => {
  it("returns the explicit gate when provided", () => {
    expect(resolveGateName("release", {})).toBe("release");
  });

  it("normalizes case and whitespace", () => {
    expect(resolveGateName(" Merge ", {})).toBe("merge");
  });

  it("returns FLAKER_GATE when set", () => {
    expect(resolveGateName(undefined, { FLAKER_GATE: "release" })).toBe("release");
  });

  it("returns 'merge' when CI=true", () => {
    expect(resolveGateName(undefined, { CI: "true" })).toBe("merge");
  });

  it("returns 'merge' when GITHUB_ACTIONS=true", () => {
    expect(resolveGateName(undefined, { GITHUB_ACTIONS: "true" })).toBe("merge");
  });

  it("explicit overrides FLAKER_GATE", () => {
    expect(resolveGateName("release", { FLAKER_GATE: "merge" })).toBe("release");
  });

  it("explicit overrides CI env var", () => {
    expect(resolveGateName("iteration", { CI: "true" })).toBe("iteration");
  });

  it("returns 'iteration' as default when nothing is set", () => {
    expect(resolveGateName(undefined, {})).toBe("iteration");
  });

  it("rejects an unknown FLAKER_GATE value", () => {
    expect(() => resolveGateName(undefined, { FLAKER_GATE: "nightly" })).toThrow(/Unknown gate 'nightly'/);
  });

  it("rejects FLAKER_PROFILE even without a known mapping", () => {
    expect(() => resolveGateName("merge", { FLAKER_PROFILE: "nightly" })).toThrow(
      /FLAKER_PROFILE was replaced by FLAKER_GATE/,
    );
  });
});

describe("legacy profile → gate mapping", () => {
  it("maps each 0.12 profile to its gate", () => {
    expect(LEGACY_PROFILE_TO_GATE).toEqual({
      local: "iteration",
      ci: "merge",
      scheduled: "release",
    });
  });
});

describe("resolveGate", () => {
  it("uses strategy from gate config", () => {
    const result = resolveGate("merge", { merge: { strategy: "full" } }, undefined);
    expect(result.name).toBe("merge");
    expect(result.strategy).toBe("full");
  });

  it("forces sample_percentage=100 and holdout_ratio=0 when strategy is 'full'", () => {
    const result = resolveGate("merge", { merge: { strategy: "full" } }, undefined);
    expect(result.sample_percentage).toBe(100);
    expect(result.holdout_ratio).toBe(0);
  });

  it("merges gate over sampling defaults", () => {
    const result = resolveGate(
      "release",
      { release: { strategy: "weighted", sample_percentage: 30 } },
      { strategy: "weighted", sample_percentage: 50, holdout_ratio: 0.1, skip_quarantined: true, skip_flaky_tagged: true },
    );
    expect(result.strategy).toBe("weighted");
    expect(result.sample_percentage).toBe(30); // gate wins
    expect(result.holdout_ratio).toBe(0.1); // from sampling
    expect(result.skip_flaky_tagged).toBe(true); // from sampling
  });

  it("allows gate to override skip_flaky_tagged", () => {
    const result = resolveGate(
      "merge",
      { merge: { strategy: "hybrid", skip_flaky_tagged: false } },
      { strategy: "hybrid", skip_flaky_tagged: true },
    );
    expect(result.skip_flaky_tagged).toBe(false);
  });

  it("falls back to sampling when the gate has no section", () => {
    const result = resolveGate("release", {}, { strategy: "weighted", sample_percentage: 20 });
    expect(result.strategy).toBe("weighted");
    expect(result.sample_percentage).toBe(20);
  });

  it("handles max_duration_seconds and fallback_strategy", () => {
    const result = resolveGate(
      "merge",
      { merge: { strategy: "full", max_duration_seconds: 300, fallback_strategy: "weighted" } },
      undefined,
    );
    expect(result.max_duration_seconds).toBe(300);
    expect(result.fallback_strategy).toBe("weighted");
  });

  it("uses 'weighted' as default strategy when no gate or sampling", () => {
    const result = resolveGate("release", undefined, undefined);
    expect(result.strategy).toBe("weighted");
  });
});
