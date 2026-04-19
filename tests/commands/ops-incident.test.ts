import { describe, expect, it } from "vitest";
import { formatOpsIncidentReport, runOpsIncident } from "../../src/cli/commands/ops/incident.js";

describe("ops incident", () => {
  it("builds an incident artifact from retry, confirm, and diagnose results", async () => {
    const report = await runOpsIncident({
      now: new Date("2026-04-19T00:00:00Z"),
      runId: 123,
      suite: "tests/login.spec.ts",
      testName: "redirects after login",
      repeat: 5,
      confirmRunner: "local",
      diagnoseRuns: 3,
      retry: async () => ({
        runId: 123,
        results: [
          { suite: "tests/login.spec.ts", testName: "redirects after login", reproduced: true },
          { suite: "tests/home.spec.ts", testName: "renders dashboard", reproduced: false },
        ],
      }),
      confirm: async () => ({
        suite: "tests/login.spec.ts",
        testName: "redirects after login",
        runner: "local",
        repeat: 5,
        failures: 2,
        verdict: "flaky",
        message: "Intermittent failure. Flaky rate: 40%.",
      }),
      diagnose: async () => ({
        target: {
          suite: "tests/login.spec.ts",
          testName: "redirects after login",
        },
        baseline: {
          name: "baseline",
          runs: 3,
          failures: 1,
          failureRate: 33.33,
          results: [],
        },
        mutations: [
          {
            name: "order-shuffle",
            runs: 3,
            failures: 3,
            failureRate: 100,
            results: [],
          },
        ],
        diagnosis: [
          "順序依存の疑い: order-shuffle で失敗率が上昇",
        ],
      }),
    });

    expect(report.scope).toEqual({
      runId: 123,
      target: {
        suite: "tests/login.spec.ts",
        testName: "redirects after login",
      },
    });
    expect(report.retry).toEqual(
      expect.objectContaining({
        runId: 123,
        reproducedCount: 1,
        unreproducedCount: 1,
      }),
    );
    expect(report.confirm).toEqual(
      expect.objectContaining({
        verdict: "flaky",
        failures: 2,
        repeat: 5,
      }),
    );
    expect(report.diagnose).toEqual(
      expect.objectContaining({
        baselineFailureRate: 33.33,
        diagnosis: ["順序依存の疑い: order-shuffle で失敗率が上昇"],
      }),
    );
    expect(report.actionItems).toContain("Quarantine or de-gate the target test until it stabilizes.");

    const text = formatOpsIncidentReport(report);
    expect(text).toContain("Ops Incident");
    expect(text).toContain("Retry");
    expect(text).toContain("Confirm");
    expect(text).toContain("Diagnosis");
    expect(text).toContain("Action items");
  });
});
