import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    expect(results[0].testName).toBe("math > adds numbers");
    expect(results[0].status).toBe("passed");
    expect(results[1].testName).toBe("math > subtracts numbers");
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
