import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/cli/config.ts";
import { detectProfileName, resolveProfile } from "../../src/cli/profile.ts";

// --- Task 1: ProfileConfig type and TOML parsing ---

describe("loadConfig with profile sections", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-profile-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses [profile.*] sections into config.profile", () => {
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
flaky_rate_threshold = 0.3
min_runs = 5

[flaky]
window_days = 14
detection_threshold = 0.1

[profile.daily]
strategy = "random"
percentage = 30

[profile.ci]
strategy = "full"
max_duration_seconds = 300

[profile.local]
strategy = "random"
percentage = 10
adaptive = true
adaptive_fnr_low = 0.01
adaptive_fnr_high = 0.04
`.trim(),
    );

    const config = loadConfig(dir);

    expect(config.profile).toBeDefined();
    expect(config.profile?.["daily"]).toEqual({
      strategy: "random",
      percentage: 30,
    });
    expect(config.profile?.["ci"]).toEqual({
      strategy: "full",
      max_duration_seconds: 300,
    });
    expect(config.profile?.["local"]).toMatchObject({
      strategy: "random",
      percentage: 10,
      adaptive: true,
      adaptive_fnr_low: 0.01,
      adaptive_fnr_high: 0.04,
    });
  });

  it("backward compat: no profile sections → profile is undefined", () => {
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
flaky_rate_threshold = 0.3
min_runs = 5

[flaky]
window_days = 14
detection_threshold = 0.1
`.trim(),
    );

    const config = loadConfig(dir);
    expect(config.profile).toBeUndefined();
  });
});

// --- Task 2: Profile resolution module ---

describe("detectProfileName", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env["FLAKER_PROFILE"];
    delete process.env["CI"];
    delete process.env["GITHUB_ACTIONS"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns explicit name when provided", () => {
    expect(detectProfileName("daily")).toBe("daily");
  });

  it("returns FLAKER_PROFILE env var when set", () => {
    process.env["FLAKER_PROFILE"] = "nightly";
    expect(detectProfileName(undefined)).toBe("nightly");
  });

  it("returns 'ci' when CI=true", () => {
    process.env["CI"] = "true";
    expect(detectProfileName(undefined)).toBe("ci");
  });

  it("returns 'ci' when GITHUB_ACTIONS=true", () => {
    process.env["GITHUB_ACTIONS"] = "true";
    expect(detectProfileName(undefined)).toBe("ci");
  });

  it("explicit overrides FLAKER_PROFILE env var", () => {
    process.env["FLAKER_PROFILE"] = "nightly";
    expect(detectProfileName("daily")).toBe("daily");
  });

  it("explicit overrides CI env var", () => {
    process.env["CI"] = "true";
    expect(detectProfileName("local")).toBe("local");
  });

  it("returns 'local' as default when nothing is set", () => {
    expect(detectProfileName(undefined)).toBe("local");
  });
});

describe("resolveProfile", () => {
  it("uses strategy from profile config", () => {
    const result = resolveProfile("ci", { ci: { strategy: "full" } }, undefined);
    expect(result.name).toBe("ci");
    expect(result.strategy).toBe("full");
  });

  it("forces percentage=100 and holdout_ratio=0 when strategy is 'full'", () => {
    const result = resolveProfile("ci", { ci: { strategy: "full" } }, undefined);
    expect(result.percentage).toBe(100);
    expect(result.holdout_ratio).toBe(0);
  });

  it("merges profile over sampling defaults", () => {
    const result = resolveProfile(
      "daily",
      { daily: { strategy: "random", percentage: 30 } },
      { strategy: "random", percentage: 50, holdout_ratio: 0.1 },
    );
    expect(result.strategy).toBe("random");
    expect(result.percentage).toBe(30); // profile wins
    expect(result.holdout_ratio).toBe(0.1); // from sampling
  });

  it("falls back to sampling strategy when profile not found", () => {
    const result = resolveProfile("unknown", {}, { strategy: "random", percentage: 20 });
    expect(result.strategy).toBe("random");
    expect(result.percentage).toBe(20);
  });

  it("provides adaptive field defaults", () => {
    const result = resolveProfile("local", { local: { strategy: "random" } }, undefined);
    expect(result.adaptive).toBe(false);
    expect(result.adaptive_fnr_low).toBe(0.02);
    expect(result.adaptive_fnr_high).toBe(0.05);
    expect(result.adaptive_min_percentage).toBe(10);
    expect(result.adaptive_step).toBe(5);
  });

  it("uses adaptive values from profile config", () => {
    const result = resolveProfile(
      "local",
      {
        local: {
          strategy: "random",
          adaptive: true,
          adaptive_fnr_low: 0.01,
          adaptive_fnr_high: 0.04,
          adaptive_min_percentage: 5,
          adaptive_step: 2,
        },
      },
      undefined,
    );
    expect(result.adaptive).toBe(true);
    expect(result.adaptive_fnr_low).toBe(0.01);
    expect(result.adaptive_fnr_high).toBe(0.04);
    expect(result.adaptive_min_percentage).toBe(5);
    expect(result.adaptive_step).toBe(2);
  });

  it("handles max_duration_seconds and fallback_strategy", () => {
    const result = resolveProfile(
      "ci",
      { ci: { strategy: "full", max_duration_seconds: 300, fallback_strategy: "random" } },
      undefined,
    );
    expect(result.max_duration_seconds).toBe(300);
    expect(result.fallback_strategy).toBe("random");
  });

  it("uses 'random' as default strategy when no profile or sampling", () => {
    const result = resolveProfile("nonexistent", undefined, undefined);
    expect(result.strategy).toBe("random");
  });
});
