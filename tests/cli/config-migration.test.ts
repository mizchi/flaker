import { describe, it, expect } from "vitest";
import { loadConfig, validateConfigRanges, DEFAULT_PROMOTION, type FlakerConfig } from "../../src/cli/config.js";

// These tests are intentionally skipped until Task 18 rewrites the config loader.
// Remove the `.skip` in Task 18 when the loader throws on legacy keys.
describe("config migration error", () => {
  it("rejects legacy [sampling] percentage key", () => {
    expect(() => loadConfig("tests/fixtures/legacy-config")).toThrow(
      /deprecated key `percentage` in \[sampling\]/
    );
  });

  it("error message mentions the new key name", () => {
    try {
      loadConfig("tests/fixtures/legacy-config");
    } catch (err) {
      expect(String(err)).toMatch(/sample_percentage/);
      return;
    }
    throw new Error("expected loadConfig to throw");
  });

  it("error message points to the migration doc", () => {
    try {
      loadConfig("tests/fixtures/legacy-config");
    } catch (err) {
      expect(String(err)).toContain("docs/how-to-use.md#config-migration");
      return;
    }
    throw new Error("expected loadConfig to throw");
  });
});

describe("validateConfigRanges", () => {
  const baseConfig: FlakerConfig = {
    repo: { owner: "acme", name: "demo" },
    storage: { path: ".flaker/data" },
    adapter: { type: "playwright" },
    runner: { type: "vitest", command: "pnpm test" },
    affected: { resolver: "workspace", config: "" },
    quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
    flaky: { window_days: 14, detection_threshold_ratio: 0.02 },
    promotion: DEFAULT_PROMOTION,
  };

  it("accepts in-range values", () => {
    expect(validateConfigRanges(baseConfig)).toEqual([]);
  });

  it("rejects holdout_ratio above 1", () => {
    const config: FlakerConfig = {
      ...baseConfig,
      sampling: { strategy: "random", holdout_ratio: 1.5 },
    };
    const errors = validateConfigRanges(config);
    expect(errors.some((e) => e.path === "sampling.holdout_ratio")).toBe(true);
  });

  it("rejects flaky_rate_threshold_percentage above 100", () => {
    const config: FlakerConfig = {
      ...baseConfig,
      quarantine: { ...baseConfig.quarantine, flaky_rate_threshold_percentage: 150 },
    };
    const errors = validateConfigRanges(config);
    expect(errors.some((e) => e.path === "quarantine.flaky_rate_threshold_percentage")).toBe(true);
  });

  it("rejects detection_threshold_ratio below 0", () => {
    const config: FlakerConfig = {
      ...baseConfig,
      flaky: { ...baseConfig.flaky, detection_threshold_ratio: -0.1 },
    };
    const errors = validateConfigRanges(config);
    expect(errors.some((e) => e.path === "flaky.detection_threshold_ratio")).toBe(true);
  });
});
