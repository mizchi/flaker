import { describe, it, expect } from "vitest";
import { buildQuarantineIssueOpts } from "../../src/cli/commands/policy/quarantine.js";

describe("buildQuarantineIssueOpts", () => {
  it("generates title and body from quarantine data", () => {
    const result = buildQuarantineIssueOpts({
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      flakyRate: 35.5,
      totalRuns: 20,
      reason: "auto:flaky_rate>=30%",
    });
    expect(result.title).toBe("[flaker] Quarantined: tests/api.test.ts > handles timeout");
    expect(result.body).toContain("35.5%");
    expect(result.labels).toEqual(["flaky-test", "quarantine"]);
  });

  it("truncates long titles", () => {
    const result = buildQuarantineIssueOpts({
      suite: "tests/very/long/path/to/some/deeply/nested/test/file.test.ts",
      testName: "a very long test name that describes what it does in great detail",
      flakyRate: 10,
      totalRuns: 50,
      reason: "auto",
    });
    expect(result.title.length).toBeLessThanOrEqual(256);
  });
});
