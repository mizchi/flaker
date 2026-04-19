import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfigRanges, DEFAULT_PROMOTION, type FlakerConfig } from "../../src/cli/config.js";

const MINIMAL_TOML = `
[repo]
owner = "acme"
name = "demo"

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
`;

describe("config promotion section", () => {
  let dir: string;

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("Case A: minimal toml without [promotion] → config.promotion equals DEFAULT_PROMOTION", () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-promo-"));
    writeFileSync(join(dir, "flaker.toml"), MINIMAL_TOML);
    const config = loadConfig(dir);
    expect(config.promotion).toEqual(DEFAULT_PROMOTION);
  });

  it("Case B: [promotion] with overrides → partial override, other fields keep defaults", () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-promo-"));
    writeFileSync(
      join(dir, "flaker.toml"),
      MINIMAL_TOML + `
[promotion]
matched_commits_min = 50
data_confidence_min = "high"
`
    );
    const config = loadConfig(dir);
    expect(config.promotion.matched_commits_min).toBe(50);
    expect(config.promotion.data_confidence_min).toBe("high");
    expect(config.promotion.false_negative_rate_max_percentage).toBe(DEFAULT_PROMOTION.false_negative_rate_max_percentage);
    expect(config.promotion.pass_correlation_min_percentage).toBe(DEFAULT_PROMOTION.pass_correlation_min_percentage);
    expect(config.promotion.holdout_fnr_max_percentage).toBe(DEFAULT_PROMOTION.holdout_fnr_max_percentage);
  });

  it("rejects unknown data_confidence_min value", () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-promo-"));
    writeFileSync(join(dir, "flaker.toml"), MINIMAL_TOML + `
[promotion]
data_confidence_min = "bogus"
`);
    const config = loadConfig(dir);
    const errors = validateConfigRanges(config);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("promotion.data_confidence_min");
  });

  it("Case C: validateConfigRanges flags out-of-range pass_correlation_min_percentage = 150", () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-promo-"));
    writeFileSync(join(dir, "flaker.toml"), MINIMAL_TOML);
    const config = loadConfig(dir);
    const badConfig: FlakerConfig = {
      ...config,
      promotion: {
        ...config.promotion,
        pass_correlation_min_percentage: 150,
      },
    };
    const errors = validateConfigRanges(badConfig);
    expect(errors.some((e) => e.path === "promotion.pass_correlation_min_percentage")).toBe(true);
  });
});
