import { describe, it, expect } from "vitest";
import { vitestAdapter } from "../../src/cli/adapters/vitest.js";

describe("vitestAdapter", () => {
  it("parses vitest JSON reporter output", () => {
    const input = JSON.stringify({
      testResults: [
        {
          name: "tests/commands/sample.test.ts",
          assertionResults: [
            {
              ancestorTitles: ["sample command"],
              fullName: "sample command random returns correct count",
              status: "passed",
              title: "random returns correct count",
              duration: 42.5,
              failureMessages: [],
            },
            {
              ancestorTitles: ["sample command"],
              fullName: "sample command weighted fails",
              status: "failed",
              title: "weighted fails",
              duration: 100,
              failureMessages: ["Expected 5 but got 3"],
            },
          ],
        },
        {
          name: "tests/core/loader.test.ts",
          assertionResults: [
            {
              ancestorTitles: ["loadCore"],
              fullName: "loadCore returns defined object",
              status: "passed",
              title: "returns defined object",
              duration: 5,
              failureMessages: [],
            },
            {
              ancestorTitles: [],
              fullName: "skipped test",
              status: "pending",
              title: "skipped test",
              duration: 0,
              failureMessages: [],
            },
          ],
        },
      ],
    });

    const results = vitestAdapter.parse(input);
    expect(results).toHaveLength(3); // pending is excluded
    expect(results[0]).toMatchObject({
      suite: "tests/commands/sample.test.ts",
      testName: "sample command random returns correct count",
      status: "passed",
      durationMs: 43,
    });
    expect(results[1]).toMatchObject({
      suite: "tests/commands/sample.test.ts",
      testName: "sample command weighted fails",
      status: "failed",
      errorMessage: "Expected 5 but got 3",
    });
    expect(results[2]).toMatchObject({
      suite: "tests/core/loader.test.ts",
      testName: "loadCore returns defined object",
      status: "passed",
    });
  });

  it("handles empty test results", () => {
    const input = JSON.stringify({ testResults: [] });
    expect(vitestAdapter.parse(input)).toHaveLength(0);
  });
});
