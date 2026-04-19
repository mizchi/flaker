import { describe, expect, it } from "vitest";
import {
  renderEmptyPlanHint,
  renderZeroTestHint,
  isColdStartZeroTest,
} from "../../src/cli/categories/apply.js";

describe("apply output hints", () => {
  it("renderEmptyPlanHint returns a hint referencing flaker status", () => {
    const hint = renderEmptyPlanHint();
    expect(hint).toContain("flaker status");
    expect(hint).toMatch(/^hint:/);
  });

  it("renderZeroTestHint returns a hint about 0 tests discovered", () => {
    const hint = renderZeroTestHint();
    expect(hint).toContain("0 tests discovered");
    expect(hint).toContain("[runner].command");
    expect(hint).toContain("[affected].resolver");
    expect(hint).toMatch(/^hint:/);
  });

  describe("isColdStartZeroTest", () => {
    it("returns true when sampledTests is empty array", () => {
      const result = { runResult: { sampledTests: [] } };
      expect(isColdStartZeroTest(result)).toBe(true);
    });

    it("returns false when sampledTests has entries", () => {
      const result = { runResult: { sampledTests: [{ suite: "foo.test.ts", testName: "bar" }] } };
      expect(isColdStartZeroTest(result)).toBe(false);
    });

    it("returns false when result is null", () => {
      expect(isColdStartZeroTest(null)).toBe(false);
    });

    it("returns false when runResult is missing", () => {
      expect(isColdStartZeroTest({})).toBe(false);
    });

    it("returns false when sampledTests is not an array", () => {
      const result = { runResult: { sampledTests: null } };
      expect(isColdStartZeroTest(result)).toBe(false);
    });
  });
});
