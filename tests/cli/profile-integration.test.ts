import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectProfileName,
  resolveProfile,
  resolveFallbackSamplingMode,
} from "../../src/cli/profile.js";
import type { ProfileConfig, SamplingConfig } from "../../src/cli/config.js";

describe("profile integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["FLAKER_PROFILE"];
    delete process.env["CI"];
    delete process.env["GITHUB_ACTIONS"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const sampling: SamplingConfig = {
    strategy: "hybrid",
    sample_percentage: 30,
    holdout_ratio: 0.1,
    co_failure_window_days: 90,
    cluster_mode: "spread",
    skip_flaky_tagged: true,
  };

  const profiles: Record<string, ProfileConfig> = {
    scheduled: { strategy: "full" },
    ci: { strategy: "hybrid", sample_percentage: 25, adaptive: true },
    local: {
      strategy: "affected",
      cluster_mode: "pack",
      max_duration_seconds: 60,
      fallback_strategy: "weighted",
      skip_flaky_tagged: false,
    },
  };

  it("scheduled profile runs all tests", () => {
    const p = resolveProfile("scheduled", profiles, sampling);
    expect(p.strategy).toBe("full");
    expect(p.sample_percentage).toBe(100);
    expect(p.holdout_ratio).toBe(0);
  });

  it("ci profile uses adaptive with hybrid", () => {
    const p = resolveProfile("ci", profiles, sampling);
    expect(p.strategy).toBe("hybrid");
    expect(p.sample_percentage).toBe(25);
    expect(p.adaptive).toBe(true);
    expect(p.holdout_ratio).toBe(0.1); // inherited from sampling
    expect(p.cluster_mode).toBe("spread"); // inherited from sampling
    expect(p.skip_flaky_tagged).toBe(true);
  });

  it("local profile uses affected with time budget", () => {
    const p = resolveProfile("local", profiles, sampling);
    expect(p.strategy).toBe("affected");
    expect(p.cluster_mode).toBe("pack");
    expect(p.max_duration_seconds).toBe(60);
    expect(p.fallback_strategy).toBe("weighted");
    expect(p.skip_flaky_tagged).toBe(false);
    expect(resolveFallbackSamplingMode(p)).toBe("weighted");
  });

  it("unknown profile falls back to sampling config", () => {
    const p = resolveProfile("staging", profiles, sampling);
    expect(p.strategy).toBe("hybrid");
    expect(p.sample_percentage).toBe(30);
  });

  it("end-to-end: auto-detect in non-CI env resolves to local", () => {
    const name = detectProfileName(undefined);
    const p = resolveProfile(name, profiles, sampling);
    expect(p.name).toBe("local");
    expect(p.strategy).toBe("affected");
  });

  it("end-to-end: CI env resolves to ci profile", () => {
    process.env["CI"] = "true";
    const name = detectProfileName(undefined);
    const p = resolveProfile(name, profiles, sampling);
    expect(p.name).toBe("ci");
    expect(p.strategy).toBe("hybrid");
    expect(p.adaptive).toBe(true);
  });

  it("end-to-end: FLAKER_PROFILE overrides CI detection", () => {
    process.env["CI"] = "true";
    process.env["FLAKER_PROFILE"] = "scheduled";
    const name = detectProfileName(undefined);
    const p = resolveProfile(name, profiles, sampling);
    expect(p.name).toBe("scheduled");
    expect(p.strategy).toBe("full");
  });
});
