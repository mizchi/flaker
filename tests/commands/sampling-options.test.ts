import { describe, expect, it } from "vitest";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "../../src/cli/commands/exec/sampling-options.js";

describe("sampling options", () => {
  it("accepts supported sampling modes", () => {
    expect(parseSamplingMode("affected")).toBe("affected");
    expect(parseSamplingMode("hybrid")).toBe("hybrid");
  });

  it("rejects unknown sampling modes instead of falling back silently", () => {
    expect(() => parseSamplingMode("strategy=affected")).toThrowError(
      "Unknown sampling strategy: strategy=affected. Expected one of: random, weighted, affected, hybrid, gbdt",
    );
  });

  it("parses count as a non-negative integer", () => {
    expect(parseSampleCount("25")).toBe(25);
    expect(() => parseSampleCount("count=25")).toThrowError(
      "Invalid --count value: count=25. Expected a non-negative integer.",
    );
  });

  it("parses percentage within 0-100", () => {
    expect(parseSamplePercentage("12.5")).toBe(12.5);
    expect(() => parseSamplePercentage("150")).toThrowError(
      "Invalid --percentage value: 150. Expected a number between 0 and 100.",
    );
  });
});
