import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { junitAdapter } from "../../src/cli/adapters/junit.js";
import { createStableTestId } from "../../src/cli/identity.js";

const fixtureXml = readFileSync(
  join(import.meta.dirname, "../fixtures/junit-report.xml"),
  "utf-8",
);

describe("junitAdapter", () => {
  it('has name "junit"', () => {
    expect(junitAdapter.name).toBe("junit");
  });

  it("returns all 5 test results", () => {
    const results = junitAdapter.parse(fixtureXml);
    expect(results).toHaveLength(5);
  });

  it("parses passing test", () => {
    const results = junitAdapter.parse(fixtureXml);
    const passed = results.find((r) => r.testName === "should display form");
    expect(passed).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should display form",
      status: "passed",
      durationMs: 1200,
      retryCount: 0,
    });
    expect(passed?.taskId).toBe("tests/login.spec.ts");
    expect(passed?.filter).toBeNull();
    expect(passed?.variant).toBeNull();
    expect(passed?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should display form",
      }),
    );
  });

  it("parses failed test with error message", () => {
    const results = junitAdapter.parse(fixtureXml);
    const failed = results.find(
      (r) => r.testName === "should redirect after login",
    );
    expect(failed).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should redirect after login",
      status: "failed",
      durationMs: 2000,
      retryCount: 0,
      errorMessage: "Timeout waiting for element",
    });
    expect(failed?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should redirect after login",
      }),
    );
  });

  it("parses skipped test", () => {
    const results = junitAdapter.parse(fixtureXml);
    const skipped = results.find(
      (r) => r.testName === "should skip on mobile",
    );
    expect(skipped).toMatchObject({
      suite: "tests/login.spec.ts",
      testName: "should skip on mobile",
      status: "skipped",
      durationMs: 0,
      retryCount: 0,
    });
    expect(skipped?.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should skip on mobile",
      }),
    );
  });

  it("suite name comes from testsuite name attribute", () => {
    const results = junitAdapter.parse(fixtureXml);
    const homeSuite = results.find(
      (r) => r.testName === "should load homepage",
    );
    expect(homeSuite?.suite).toBe("tests/home.spec.ts");
  });
});
