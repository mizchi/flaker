import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { resolveTestIdentity } from "../../src/cli/identity.js";
import {
  createReportSummaryArtifact,
  formatReportAggregate,
  formatReportDiff,
  formatReportSummary,
  loadReportSummaryArtifactsFromDir,
  runReportAggregate,
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

const vrtMigrationFixture = readFileSync(
  join(import.meta.dirname, "../fixtures/vrt-migration-report.json"),
  "utf-8",
);

const vrtBenchFixture = readFileSync(
  join(import.meta.dirname, "../fixtures/vrt-bench-report.json"),
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

  it("normalizes vrt migration reports into the same summary shape", () => {
    const summary = runReportSummarize({
      adapter: "vrt-migration",
      input: vrtMigrationFixture,
    });

    expect(summary.totals).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1,
      flaky: 0,
      skipped: 0,
      retries: 0,
      durationMs: 0,
    });
    expect(summary.files).toEqual([
      expect.objectContaining({
        suite: "fixtures/migration/reset-css/after.html",
        totals: expect.objectContaining({ total: 3, passed: 2, failed: 1 }),
      }),
    ]);
    expect(summary.unstable).toEqual([
      expect.objectContaining({
        suite: "fixtures/migration/reset-css/after.html",
        testName: "viewport:desktop",
        taskId: "migration/reset-css",
        status: "failed",
      }),
    ]);
  });

  it("normalizes vrt bench reports into the same summary shape", () => {
    const summary = runReportSummarize({
      adapter: "vrt-bench",
      input: vrtBenchFixture,
    });

    expect(summary.totals).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1,
      flaky: 0,
      skipped: 0,
      retries: 0,
      durationMs: 0,
    });
    expect(summary.files).toEqual([
      expect.objectContaining({
        suite: "fixtures/css-challenge/dashboard.html",
        totals: expect.objectContaining({ total: 3, passed: 2, failed: 1 }),
      }),
    ]);
    expect(summary.unstable).toEqual([
      expect.objectContaining({
        suite: "fixtures/css-challenge/dashboard.html",
        testName: ".search-box input:focus { border-color: rgb(59, 130, 246) }",
        taskId: "css-bench/dashboard",
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

describe("report aggregate", () => {
  it("aggregates shard bundles and preserves shard metadata", () => {
    const shardA = createReportSummaryArtifact(
      summarizeResults(
        [
          resolveTestIdentity({
            suite: "tests/vrt.spec.ts",
            testName: "renders header",
            taskId: "vrt",
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          }),
          resolveTestIdentity({
            suite: "tests/vrt.spec.ts",
            testName: "renders footer",
            taskId: "vrt",
            status: "failed",
            durationMs: 20,
            retryCount: 0,
          }),
        ],
        "playwright",
      ),
      {
        shard: "shard-1",
        module: "vrt",
        offset: 0,
        limit: 50,
        matrix: { os: "ubuntu-latest" },
        extra: { browser: "chromium" },
      },
    );
    const shardB = createReportSummaryArtifact(
      summarizeResults(
        [
          resolveTestIdentity({
            suite: "tests/vrt.spec.ts",
            testName: "renders card",
            taskId: "vrt",
            status: "flaky",
            durationMs: 30,
            retryCount: 1,
          }),
        ],
        "playwright",
      ),
      {
        shard: "shard-2",
        module: "vrt",
        offset: 50,
        limit: 50,
        matrix: { os: "ubuntu-latest" },
      },
    );

    const aggregate = runReportAggregate({
      summaries: [shardA, shardB],
    });

    expect(aggregate.summary).toMatchObject({
      shardCount: 2,
      unstableCount: 2,
    });
    expect(aggregate.totals).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      flaky: 1,
      retries: 1,
      durationMs: 60,
    });
    expect(aggregate.shards).toEqual([
      expect.objectContaining({
        shardId: "shard-1",
        metadata: expect.objectContaining({
          module: "vrt",
          offset: 0,
          limit: 50,
          matrix: { os: "ubuntu-latest" },
        }),
        totals: expect.objectContaining({ total: 2, failed: 1 }),
      }),
      expect.objectContaining({
        shardId: "shard-2",
        totals: expect.objectContaining({ total: 1, flaky: 1 }),
      }),
    ]);
    expect(aggregate.unstable).toEqual([
      expect.objectContaining({
        testName: "renders card",
        shards: ["shard-2"],
        statuses: ["flaky"],
      }),
      expect.objectContaining({
        testName: "renders footer",
        shards: ["shard-1"],
        statuses: ["failed"],
      }),
    ]);

    const json = formatReportAggregate(aggregate, "json");
    const markdown = formatReportAggregate(aggregate, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      summary: { shardCount: 2, unstableCount: 2 },
    });
    expect(markdown).toContain("# Aggregated Test Report");
    expect(markdown).toContain("shard-1");
    expect(markdown).toContain("renders footer");
    expect(markdown).toContain("matrix:os=ubuntu-latest");
    expect(markdown).toContain("meta:browser=chromium");
  });

  it("loads plain summaries and bundle artifacts from a directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "report-aggregate-"));
    try {
      const plainSummary = summarizeResults(
        [
          resolveTestIdentity({
            suite: "tests/plain.spec.ts",
            testName: "plain test",
            status: "passed",
            durationMs: 5,
            retryCount: 0,
          }),
        ],
        "junit",
      );
      const bundledSummary = createReportSummaryArtifact(
        summarizeResults(
          [
            resolveTestIdentity({
              suite: "tests/bundled.spec.ts",
              testName: "bundled test",
              status: "failed",
              durationMs: 7,
              retryCount: 0,
            }),
          ],
          "playwright",
        ),
        { shard: "bundle-a", module: "ui" },
      );

      writeFileSync(
        join(cwd, "plain-summary.json"),
        JSON.stringify(plainSummary, null, 2),
      );
      writeFileSync(
        join(cwd, "bundled-summary.json"),
        JSON.stringify(bundledSummary, null, 2),
      );

      const loaded = loadReportSummaryArtifactsFromDir(cwd);

      expect(loaded).toHaveLength(2);
      expect(loaded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ shard: null }),
            summary: expect.objectContaining({ adapter: "junit" }),
          }),
          expect.objectContaining({
            metadata: expect.objectContaining({
              shard: "bundle-a",
              module: "ui",
            }),
            summary: expect.objectContaining({ adapter: "playwright" }),
          }),
        ]),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
