import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vrtBenchAdapter } from "../../src/cli/adapters/vrt-bench.js";

const fixtureJson = readFileSync(
  join(import.meta.dirname, "../fixtures/vrt-bench-report.json"),
  "utf-8",
);

describe("vrtBenchAdapter", () => {
  it('has name "vrt-bench"', () => {
    expect(vrtBenchAdapter.name).toBe("vrt-bench");
  });

  it("converts bench report JSON into stable test case results", () => {
    const results = vrtBenchAdapter.parse(fixtureJson);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      suite: "fixtures/css-challenge/dashboard.html",
      testName: ".hero-card { border-radius: 12px }",
      taskId: "css-bench/dashboard",
      status: "passed",
      durationMs: 0,
      retryCount: 0,
      variant: {
        backend: "chromium",
        category: "visual",
        selectorType: "class",
        interactive: "false",
        fallbackUsed: "false",
        resolvedBy: "chromium",
      },
    });
    expect(results[0].testId).toBeTruthy();

    expect(results[1]).toMatchObject({
      testName: ".search-box input:focus { border-color: rgb(59, 130, 246) }",
      status: "failed",
      filter: "(max-width: 768px)",
    });
    expect(results[1].errorMessage).toContain("hover-only");

    expect(results[2]).toMatchObject({
      testName: ".toolbar { padding-top: 24px }",
      status: "passed",
      variant: {
        backend: "prescanner",
        category: "layout",
        selectorType: "class",
        interactive: "false",
        fallbackUsed: "true",
        resolvedBy: "chromium",
      },
    });
  });
});
