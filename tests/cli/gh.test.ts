import { describe, it, expect } from "vitest";
import { isGhAvailable, formatIssueBody } from "../../src/cli/gh.js";

describe("formatIssueBody", () => {
  it("generates markdown issue body", () => {
    const body = formatIssueBody({
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      flakyRate: 35.5,
      totalRuns: 20,
      reason: "auto:flaky_rate>=30%",
    });
    expect(body).toContain("## Quarantined Test");
    expect(body).toContain("tests/api.test.ts");
    expect(body).toContain("handles timeout");
    expect(body).toContain("35.5%");
    expect(body).toContain("20");
    expect(body).toContain("flaker policy quarantine --remove");
  });
});

describe("isGhAvailable", () => {
  it("returns boolean", () => {
    const result = isGhAvailable();
    expect(typeof result).toBe("boolean");
  });
});
