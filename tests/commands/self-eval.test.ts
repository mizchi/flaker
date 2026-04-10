import { describe, it, expect, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSelfEval, getScenarios, formatSelfEvalReport } from "../../src/cli/commands/dev/self-eval.js";

const createStore = async () => {
  const s = new DuckDBStore(":memory:");
  await s.initialize();
  return s;
};

describe("self-eval", () => {
  it("has at least 5 built-in scenarios", () => {
    expect(getScenarios().length).toBeGreaterThanOrEqual(5);
  });

  it("runs all scenarios and returns report", async () => {
    const report = await runSelfEval({ createStore });
    expect(report.scenarios.length).toBeGreaterThanOrEqual(5);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("each scenario has a score", async () => {
    const report = await runSelfEval({ createStore });
    for (const r of report.scenarios) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.selected).toBeDefined();
    }
  });

  it("overall score >= 80 with isolated stores", async () => {
    const report = await runSelfEval({ createStore });
    // With isolated stores per scenario, cross-contamination is eliminated
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
  });

  it("format output is non-empty", async () => {
    const report = await runSelfEval({ createStore });
    const output = formatSelfEvalReport(report);
    expect(output).toContain("Self-Evaluation Report");
    expect(output).toContain("Overall Score");
  });
});
