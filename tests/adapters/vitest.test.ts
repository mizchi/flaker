import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
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

  it("normalizes absolute suite paths under cwd to relative paths", () => {
    const input = JSON.stringify({
      testResults: [
        {
          name: resolve(process.cwd(), "tests/commands/sample.test.ts"),
          assertionResults: [
            {
              ancestorTitles: ["sample command"],
              fullName: "sample command random returns correct count",
              status: "passed",
              title: "random returns correct count",
              duration: 42.5,
              failureMessages: [],
            },
          ],
        },
      ],
    });

    const results = vitestAdapter.parse(input);
    expect(results).toEqual([
      expect.objectContaining({
        suite: "tests/commands/sample.test.ts",
        testName: "sample command random returns correct count",
        status: "passed",
      }),
    ]);
  });

  it("keeps the title path: ancestor titles, then the test's own title", () => {
    const input = JSON.stringify({
      testResults: [{
        name: "tests/a.test.ts",
        assertionResults: [{
          ancestorTitles: ["outer", "inner"],
          fullName: "outer inner works",
          status: "passed",
          title: "works",
          duration: 1,
          failureMessages: [],
        }],
      }],
    });
    const [result] = vitestAdapter.parse(input);
    expect(result.titlePath).toEqual(["outer", "inner", "works"]);
    expect(result.testName).toBe("outer inner works");
  });
});
