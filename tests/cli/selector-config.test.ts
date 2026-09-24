// tests/cli/selector-config.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveSelectorConfig, validateConfigRanges } from "../../src/cli/config.js";

function withToml(extra: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-selector-config-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${extra}\n`);
  return dir;
}

describe("[selector]", () => {
  it("defaults when absent", () => {
    expect(resolveSelectorConfig(loadConfig(withToml("")))).toEqual({
      type: "jev", recall_target: 0.9, min_failures: 20, max_hinted_tests: 200,
    });
  });

  it("reads overrides", () => {
    const config = loadConfig(withToml(`[selector]\ntype = "jev"\nrecall_target = 0.95\nmin_failures = 5\nmax_hinted_tests = 50`));
    expect(resolveSelectorConfig(config)).toEqual({ type: "jev", recall_target: 0.95, min_failures: 5, max_hinted_tests: 50 });
  });

  it("rejects an unknown selector type", () => {
    expect(() => resolveSelectorConfig(loadConfig(withToml(`[selector]\ntype = "other"`)))).toThrow(/only selector is "jev"/);
  });

  it("rejects gate values in flaker.toml: the database is their source of truth", () => {
    expect(() => loadConfig(withToml(`[selector]\ncutoff = 1.5`))).toThrow(/gate_calibration/);
  });

  it("does not call a gate value in [selector] a removed or renamed key", () => {
    expect(() => loadConfig(withToml(`[selector]\ncutoff = 1.5`))).toThrow(/^flaker\.toml sets values that belong in the database:/);
    expect(() => loadConfig(withToml(`[selector]\ncutoff = 1.5`))).not.toThrow(/removed or renamed/);
  });

  it("range-checks recall_target", () => {
    const errors = validateConfigRanges(loadConfig(withToml(`[selector]\nrecall_target = 1.5`)));
    expect(errors.map((e) => e.path)).toContain("selector.recall_target");
  });

  it("requires whole numbers for min_failures and max_hinted_tests", () => {
    const errors = validateConfigRanges(loadConfig(withToml(`[selector]\nmin_failures = 2.5\nmax_hinted_tests = 10.5`)));
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(["selector.min_failures", "selector.max_hinted_tests"]));
    expect(validateConfigRanges(loadConfig(withToml(`[selector]\nmin_failures = 3\nmax_hinted_tests = 10`)))).toEqual([]);
  });
});
