import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runCollectLocal } from "../../src/cli/commands/collect-local.js";
import { extractTestReportsFromArtifacts } from "../../src/cli/adapters/actrun.js";
import { playwrightAdapter } from "../../src/cli/adapters/playwright.js";
import { junitAdapter } from "../../src/cli/adapters/junit.js";

const playwrightReportFixture = JSON.stringify({
  config: { projects: [{ name: "chromium" }] },
  suites: [
    {
      title: "auth.spec.ts",
      file: "tests/auth.spec.ts",
      suites: [
        {
          title: "auth tests",
          specs: [
            {
              title: "should login",
              tests: [
                {
                  projectName: "chromium",
                  results: [
                    { status: "passed", duration: 500, retry: 0 },
                  ],
                  status: "expected",
                },
              ],
            },
            {
              title: "should logout",
              tests: [
                {
                  projectName: "chromium",
                  results: [
                    {
                      status: "failed",
                      duration: 1000,
                      retry: 0,
                      error: { message: "Timeout" },
                    },
                    { status: "passed", duration: 800, retry: 1 },
                  ],
                  status: "flaky",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const vitestReportFixture = JSON.stringify({
  testResults: [
    {
      name: "tests/math.test.ts",
      assertionResults: [
        {
          fullName: "math > adds numbers",
          status: "passed",
          duration: 5,
          failureMessages: [],
        },
        {
          fullName: "math > subtracts numbers",
          status: "failed",
          duration: 8,
          failureMessages: ["Expected 3 but got 4"],
        },
      ],
    },
  ],
});

function makeRunViewJson(runId: string) {
  return JSON.stringify({
    run_id: runId,
    conclusion: "success",
    headSha: `sha-${runId}`,
    headBranch: "main",
    startedAt: "2026-03-31T10:00:00Z",
    completedAt: "2026-03-31T10:05:00Z",
    status: "completed",
    tasks: [
      { id: "test/e2e", kind: "run", status: "ok", code: 0, shell: "bash" },
    ],
    steps: [],
  });
}

describe("extractTestReportsFromArtifacts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `flaker-test-artifacts-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts Playwright JSON reports from artifact directory", () => {
    const reportDir = join(tmpDir, "playwright-report");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, "report.json"), playwrightReportFixture);

    const results = extractTestReportsFromArtifacts([tmpDir], {
      playwright: playwrightAdapter,
      junit: junitAdapter,
    });

    expect(results.length).toBe(2);
    expect(results[0].testName).toBe("should login");
    expect(results[0].status).toBe("passed");
    expect(results[1].testName).toBe("should logout");
    expect(results[1].status).toBe("flaky");
  });

  it("extracts JUnit XML reports from artifact directory", () => {
    const reportDir = join(tmpDir, "junit-report");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "results.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="api" tests="2">
    <testcase name="GET /health" time="0.5">
    </testcase>
    <testcase name="POST /login" time="1.2">
      <failure message="401 Unauthorized">assertion failed</failure>
    </testcase>
  </testsuite>
</testsuites>`,
    );

    const results = extractTestReportsFromArtifacts([tmpDir], {
      playwright: playwrightAdapter,
      junit: junitAdapter,
    });

    expect(results.length).toBe(2);
    expect(results[0].testName).toBe("GET /health");
    expect(results[0].status).toBe("passed");
    expect(results[1].testName).toBe("POST /login");
    expect(results[1].status).toBe("failed");
  });

  it("extracts Vitest JSON reports from artifact directory", () => {
    const reportDir = join(tmpDir, "vitest-report");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, "report.json"), vitestReportFixture);

    const results = extractTestReportsFromArtifacts([tmpDir], {
      playwright: playwrightAdapter,
      junit: junitAdapter,
    });

    expect(results.length).toBe(2);
    expect(results[0].testName).toBe("adds numbers");
    expect(results[0].status).toBe("passed");
    expect(results[1].testName).toBe("subtracts numbers");
    expect(results[1].status).toBe("failed");
  });

  it("returns empty for non-existent paths", () => {
    const results = extractTestReportsFromArtifacts(
      ["/nonexistent/path"],
      { playwright: playwrightAdapter, junit: junitAdapter },
    );
    expect(results).toEqual([]);
  });

  it("skips non-report JSON files", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));

    const results = extractTestReportsFromArtifacts([tmpDir], {
      playwright: playwrightAdapter,
      junit: junitAdapter,
    });
    expect(results).toEqual([]);
  });
});

describe("collect-local with artifacts", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-test-workspace-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers Playwright report from artifacts over task-level results", async () => {
    // Set up artifact directory structure
    const artifactDir = join(
      tmpDir,
      ".actrun",
      "runs",
      "run-1",
      "artifacts",
      "playwright-report",
    );
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "report.json"), playwrightReportFixture);

    const listJson = JSON.stringify([
      { run_id: "run-1", conclusion: "success", status: "completed" },
    ]);

    const result = await runCollectLocal({
      store,
      workspace: tmpDir,
      exec: (cmd) => {
        if (cmd.includes("run list")) return listJson;
        if (cmd.includes("run view")) return makeRunViewJson("run-1");
        return "";
      },
    });

    expect(result.runsImported).toBe(1);
    // Should import 2 tests from Playwright report, not 1 from task-level
    expect(result.testsImported).toBe(2);

    const tests = await store.raw<{ suite: string; test_name: string; status: string }>(
      "SELECT suite, test_name, status FROM test_results ORDER BY test_name",
    );
    expect(tests.length).toBe(2);
    expect(tests[0].test_name).toBe("should login");
    expect(tests[0].status).toBe("passed");
    expect(tests[1].test_name).toBe("should logout");
    expect(tests[1].status).toBe("flaky");
  });

  it("falls back to task-level results when no artifacts exist", async () => {
    const listJson = JSON.stringify([
      { run_id: "run-2", conclusion: "success", status: "completed" },
    ]);

    const result = await runCollectLocal({
      store,
      workspace: tmpDir,
      exec: (cmd) => {
        if (cmd.includes("run list")) return listJson;
        if (cmd.includes("run view")) return makeRunViewJson("run-2");
        return "";
      },
    });

    expect(result.runsImported).toBe(1);
    // Task-level: 1 task
    expect(result.testsImported).toBe(1);

    const tests = await store.raw<{ test_name: string }>(
      "SELECT test_name FROM test_results",
    );
    expect(tests[0].test_name).toBe("e2e");
  });

  it("loads artifacts from actrun default _build run root", async () => {
    const artifactDir = join(
      tmpDir,
      "_build",
      "actrun",
      "runs",
      "run-3",
      "artifacts",
      "vitest-report",
    );
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "report.json"), vitestReportFixture);

    const listJson = JSON.stringify([
      { run_id: "run-3", conclusion: "failure", status: "completed" },
    ]);

    const result = await runCollectLocal({
      store,
      workspace: tmpDir,
      exec: (cmd) => {
        if (cmd.includes("run list")) return listJson;
        if (cmd.includes("run view")) return makeRunViewJson("run-3");
        return "";
      },
    });

    expect(result.runsImported).toBe(1);
    expect(result.testsImported).toBe(2);

    const tests = await store.raw<{ test_name: string; status: string }>(
      "SELECT test_name, status FROM test_results ORDER BY test_name",
    );
    expect(tests).toEqual([
      { test_name: "adds numbers", status: "passed" },
      { test_name: "subtracts numbers", status: "failed" },
    ]);
  });
});
