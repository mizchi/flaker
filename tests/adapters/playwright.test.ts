import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playwrightAdapter } from "../../src/cli/adapters/playwright.js";
import { createStableTestId } from "../../src/cli/identity.js";

const fixtureJson = readFileSync(
  join(import.meta.dirname, "../fixtures/playwright-report.json"),
  "utf-8",
);

describe("playwrightAdapter", () => {
  it('has name "playwright"', () => {
    expect(playwrightAdapter.name).toBe("playwright");
  });

  it("returns all 4 test results", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    expect(results).toHaveLength(4);
  });

  it("parses passing test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const passed = results.find((r) => r.testName === "should display form");
    expect(passed).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should display form",
      taskId: "login page",
      status: "passed",
      durationMs: 1200,
      retryCount: 0,
      variant: { project: "chromium" },
    });
    expect(passed?.taskId).toBe("login page");
    expect(passed?.filter).toBeNull();
    expect(passed?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should display form",
        taskId: "login page",
        variant: { project: "chromium" },
      }),
    );
  });

  it("parses flaky test (retry passed)", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const flaky = results.find(
      (r) => r.testName === "should redirect after login",
    );
    expect(flaky).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should redirect after login",
      taskId: "login page",
      status: "flaky",
      durationMs: 1500,
      retryCount: 1,
      errorMessage: "Timeout",
      variant: { project: "chromium" },
    });
    expect(flaky?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should redirect after login",
        taskId: "login page",
        variant: { project: "chromium" },
      }),
    );
  });

  it("parses failed test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const failed = results.find(
      (r) => r.testName === "should show error on invalid credentials",
    );
    expect(failed).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should show error on invalid credentials",
      taskId: "login page",
      status: "failed",
      durationMs: 2000,
      retryCount: 0,
      errorMessage: "Element not found",
      variant: { project: "chromium" },
    });
    expect(failed?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should show error on invalid credentials",
        taskId: "login page",
        variant: { project: "chromium" },
      }),
    );
  });

  it("parses skipped test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const skipped = results.find(
      (r) => r.testName === "should skip on mobile",
    );
    expect(skipped).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should skip on mobile",
      taskId: "login page",
      status: "skipped",
      durationMs: 0,
      retryCount: 0,
      variant: { project: "chromium" },
    });
    expect(skipped?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should skip on mobile",
        taskId: "login page",
        variant: { project: "chromium" },
      }),
    );
  });

  it("parses attachment metadata and spec location from Playwright JSON", () => {
    const reportJson = JSON.stringify({
      suites: [
        {
          title: "auth.spec.ts",
          file: "tests/auth.spec.ts",
          suites: [
            {
              title: "auth flow",
              specs: [
                {
                  title: "captures trace and screenshot",
                  file: "tests/auth.spec.ts",
                  line: 88,
                  column: 9,
                  tests: [
                    {
                      projectName: "chromium",
                      status: "unexpected",
                      results: [
                        {
                          status: "failed",
                          duration: 1200,
                          retry: 0,
                          errors: [{ message: "trace assertion failed" }],
                          attachments: [
                            {
                              name: "trace",
                              path: "/artifacts/playwright/trace-blob.bin",
                              contentType: "application/zip",
                            },
                            {
                              name: "screenshot",
                              path: "/artifacts/playwright/failure-image.bin",
                              contentType: "image/png",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const results = playwrightAdapter.parse(reportJson);
    expect(results).toHaveLength(1);
    expect(results[0]?.failureLocation).toEqual({
      file: "tests/auth.spec.ts",
      line: 88,
      column: 9,
      functionName: null,
      raw: "tests/auth.spec.ts:88:9",
    });
    expect(results[0]?.artifactPaths).toEqual([
      "/artifacts/playwright/trace-blob.bin",
      "/artifacts/playwright/failure-image.bin",
    ]);
    expect(results[0]?.artifacts).toEqual([
      {
        path: "/artifacts/playwright/trace-blob.bin",
        fileName: "trace-blob.bin",
        kind: "trace",
        contentType: "application/zip",
      },
      {
        path: "/artifacts/playwright/failure-image.bin",
        fileName: "failure-image.bin",
        kind: "screenshot",
        contentType: "image/png",
      },
    ]);
  });
});
