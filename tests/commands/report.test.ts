import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTestIdentity } from "../../src/cli/identity.js";
import {
  formatReportDiff,
  formatReportSummary,
  runReportDiff,
  runReportSummarize,
  summarizeResults,
} from "../../src/cli/commands/report.js";

const playwrightFixture = readFileSync(
  join(import.meta.dirname, "../fixtures/playwright-report.json"),
  "utf-8",
);

const junitFixture = readFileSync(
  join(import.meta.dirname, "../fixtures/junit-report.xml"),
  "utf-8",
);

describe("report summarize", () => {
  it("normalizes playwright report into totals, file summaries, and unstable tests", () => {
    const summary = runReportSummarize({
      adapter: "playwright",
      input: playwrightFixture,
    });

    expect(summary.totals).toMatchObject({
      total: 4,
      passed: 1,
      failed: 1,
      flaky: 1,
      skipped: 1,
      retries: 1,
      durationMs: 4700,
    });
    expect(summary.files).toEqual([
      expect.objectContaining({
        suite: "tests/login.spec.ts",
        totals: expect.objectContaining({
          total: 4,
          failed: 1,
          flaky: 1,
        }),
      }),
    ]);
    expect(summary.unstable.map((entry) => entry.testName)).toEqual([
      "should redirect after login",
      "should show error on invalid credentials",
    ]);

    const json = formatReportSummary(summary, "json");
    const markdown = formatReportSummary(summary, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      adapter: "playwright",
      totals: { total: 4, flaky: 1, failed: 1 },
    });
    expect(markdown).toContain("# Test Report Summary");
    expect(markdown).toContain("tests/login.spec.ts");
    expect(markdown).toContain("should redirect after login");
  });

  it("normalizes junit report into the same summary shape", () => {
    const summary = runReportSummarize({
      adapter: "junit",
      input: junitFixture,
    });

    expect(summary.totals).toMatchObject({
      total: 5,
      passed: 3,
      failed: 1,
      flaky: 0,
      skipped: 1,
      retries: 0,
      durationMs: 5200,
    });
    expect(summary.files).toEqual([
      expect.objectContaining({
        suite: "tests/home.spec.ts",
        totals: expect.objectContaining({ total: 1, passed: 1 }),
      }),
      expect.objectContaining({
        suite: "tests/login.spec.ts",
        totals: expect.objectContaining({ total: 4, failed: 1, skipped: 1 }),
      }),
    ]);
    expect(summary.unstable).toEqual([
      expect.objectContaining({
        suite: "tests/login.spec.ts",
        testName: "should redirect after login",
        status: "failed",
      }),
    ]);
  });
});

describe("report diff", () => {
  it("classifies regressions, improvements, and persistent flaky tests", () => {
    const base = summarizeResults(
      [
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "stable",
          status: "passed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "old failure",
          status: "failed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "old flaky",
          status: "flaky",
          durationMs: 10,
          retryCount: 1,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "persistent flaky",
          status: "flaky",
          durationMs: 10,
          retryCount: 1,
        }),
      ],
      "playwright",
    );

    const head = summarizeResults(
      [
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "stable",
          status: "passed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "old failure",
          status: "passed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "old flaky",
          status: "passed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "persistent flaky",
          status: "flaky",
          durationMs: 10,
          retryCount: 1,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "new failure",
          status: "failed",
          durationMs: 10,
          retryCount: 0,
        }),
        resolveTestIdentity({
          suite: "tests/app.spec.ts",
          testName: "new flaky",
          status: "flaky",
          durationMs: 10,
          retryCount: 1,
        }),
      ],
      "playwright",
    );

    const diff = runReportDiff({ base, head });

    expect(diff.summary).toMatchObject({
      newFailureCount: 1,
      newFlakyCount: 1,
      resolvedFailureCount: 1,
      resolvedFlakyCount: 1,
      persistentFlakyCount: 1,
    });
    expect(diff.regressions.newFailures[0]).toMatchObject({
      testName: "new failure",
      headStatus: "failed",
    });
    expect(diff.regressions.newFlaky[0]).toMatchObject({
      testName: "new flaky",
      headStatus: "flaky",
    });
    expect(diff.improvements.resolvedFailures[0]).toMatchObject({
      testName: "old failure",
      baseStatus: "failed",
      headStatus: "passed",
    });
    expect(diff.improvements.resolvedFlaky[0]).toMatchObject({
      testName: "old flaky",
      baseStatus: "flaky",
      headStatus: "passed",
    });
    expect(diff.persistent.persistentFlaky[0]).toMatchObject({
      testName: "persistent flaky",
      baseStatus: "flaky",
      headStatus: "flaky",
    });

    const json = formatReportDiff(diff, "json");
    const markdown = formatReportDiff(diff, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      summary: {
        newFailureCount: 1,
        persistentFlakyCount: 1,
      },
    });
    expect(markdown).toContain("# Test Report Diff");
    expect(markdown).toContain("new failure");
    expect(markdown).toContain("persistent flaky");
  });
});
