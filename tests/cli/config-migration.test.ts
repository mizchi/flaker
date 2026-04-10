import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/cli/config.js";

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
