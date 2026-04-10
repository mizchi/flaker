import { describe, it, expect } from "vitest";
import { parseSamplingMode } from "../../src/cli/commands/exec/sampling-options.js";

describe("full sampling mode", () => {
  it("parseSamplingMode accepts 'full'", () => {
    expect(parseSamplingMode("full")).toBe("full");
  });
});
