import { describe, it, expect } from "vitest";
import {
  resolveGate,
  resolveGateName,
  resolveFallbackSamplingMode,
} from "../../src/cli/gate-config.js";
import type { GateConfig, SamplingConfig } from "../../src/cli/config.js";
import type { GateName } from "../../src/cli/gate.js";

describe("gate integration", () => {
  const sampling: SamplingConfig = {
    strategy: "hybrid",
    sample_percentage: 30,
    holdout_ratio: 0.1,
    co_failure_window_days: 90,
    cluster_mode: "spread",
    skip_flaky_tagged: true,
  };

  const gates: Partial<Record<GateName, GateConfig>> = {
    release: { strategy: "full" },
    merge: { strategy: "hybrid", sample_percentage: 25, adaptive: true },
    iteration: {
      strategy: "affected",
      cluster_mode: "pack",
      max_duration_seconds: 60,
      fallback_strategy: "weighted",
      skip_flaky_tagged: false,
    },
  };

  it("release gate runs all tests", () => {
    const g = resolveGate("release", gates, sampling);
    expect(g.strategy).toBe("full");
    expect(g.sample_percentage).toBe(100);
    expect(g.holdout_ratio).toBe(0);
  });

  it("merge gate uses hybrid and inherits sampling defaults", () => {
    const g = resolveGate("merge", gates, sampling);
    expect(g.strategy).toBe("hybrid");
    expect(g.sample_percentage).toBe(25);
    expect(g.holdout_ratio).toBe(0.1); // inherited from sampling
    expect(g.cluster_mode).toBe("spread"); // inherited from sampling
    expect(g.skip_flaky_tagged).toBe(true);
  });

  it("iteration gate uses affected with time budget", () => {
    const g = resolveGate("iteration", gates, sampling);
    expect(g.strategy).toBe("affected");
    expect(g.cluster_mode).toBe("pack");
    expect(g.max_duration_seconds).toBe(60);
    expect(g.fallback_strategy).toBe("weighted");
    expect(g.skip_flaky_tagged).toBe(false);
    expect(resolveFallbackSamplingMode(g)).toBe("weighted");
  });

  it("gate without a section falls back to sampling config", () => {
    const g = resolveGate("release", { merge: gates.merge! }, sampling);
    expect(g.strategy).toBe("hybrid");
    expect(g.sample_percentage).toBe(30);
  });

  it("end-to-end: auto-detect in non-CI env resolves to iteration", () => {
    const g = resolveGate(resolveGateName(undefined, {}), gates, sampling);
    expect(g.name).toBe("iteration");
    expect(g.strategy).toBe("affected");
  });

  it("end-to-end: CI env resolves to the merge gate", () => {
    const g = resolveGate(resolveGateName(undefined, { CI: "true" }), gates, sampling);
    expect(g.name).toBe("merge");
    expect(g.strategy).toBe("hybrid");
  });

  it("end-to-end: FLAKER_GATE overrides CI detection", () => {
    const g = resolveGate(
      resolveGateName(undefined, { CI: "true", FLAKER_GATE: "release" }),
      gates,
      sampling,
    );
    expect(g.name).toBe("release");
    expect(g.strategy).toBe("full");
  });
});
