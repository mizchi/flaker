import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSelfEval, getScenarios } from "../../src/cli/commands/self-eval.js";

describe("self-eval", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("has at least 5 built-in scenarios", () => {
    expect(getScenarios().length).toBeGreaterThanOrEqual(5);
  });

  it("runs all scenarios and returns report", async () => {
    const report = await runSelfEval({ store });
    expect(report.scenarios.length).toBeGreaterThanOrEqual(5);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("each scenario has a score", async () => {
    const report = await runSelfEval({ store });
    for (const r of report.scenarios) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.selected).toBeDefined();
    }
  });

  it("overall score >= 60 (sanity check)", async () => {
    const report = await runSelfEval({ store });
    // Our logic should pass most scenarios
    expect(report.overallScore).toBeGreaterThanOrEqual(60);
  });

  it("format output is non-empty", async () => {
    const { formatSelfEvalReport } = await import("../../src/cli/commands/self-eval.js");
    const report = await runSelfEval({ store });
    const output = formatSelfEvalReport(report);
    expect(output).toContain("Self-Evaluation Report");
    expect(output).toContain("Overall Score");
  });
});
