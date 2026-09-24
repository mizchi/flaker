import { describe, expect, it } from "vitest";
import { wilsonLowerBound } from "../../src/cli/selector/wilson.js";

describe("wilsonLowerBound (95%)", () => {
  it("matches reference values", () => {
    expect(wilsonLowerBound(45, 50)).toBeCloseTo(0.7864, 4);
    expect(wilsonLowerBound(19, 20)).toBeCloseTo(0.7639, 4);
    expect(wilsonLowerBound(20, 20)).toBeCloseTo(0.8389, 4);
  });

  it("puts the p = 1 threshold for 0.98 between 188 and 189", () => {
    expect(wilsonLowerBound(188, 188)).toBeLessThan(0.98);
    expect(wilsonLowerBound(189, 189)).toBeGreaterThanOrEqual(0.98);
  });

  it("is 0 with no observations", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});
