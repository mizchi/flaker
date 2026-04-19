import { describe, expect, it } from "vitest";
import { planApply, type PlannerInput } from "../../src/cli/commands/apply/planner.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    config: {
      promotion: DEFAULT_PROMOTION,
      quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 10 },
    } as any,
    kpi: {
      windowDays: 30,
      sampling: { matchedCommits: 0 } as any,
      flaky: { brokenTests: 0, intermittentFlaky: 0, trueFlakyRate: 0, flakyTrend: 0 },
      data: { confidence: "insufficient", staleDays: null } as any,
    } as any,
    probe: { hasGitRemote: true, hasGithubToken: true, hasLocalHistory: false },
    ...overrides,
  };
}

describe("planApply", () => {
  it("Path 1 (no history): collect, cold_start_run, no calibrate", () => {
    const actions = planApply(makeInput());
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("collect_ci");
    expect(kinds).not.toContain("calibrate");
    expect(kinds).toContain("cold_start_run");
  });

  it("Path 2 (moderate confidence): calibrate and quarantine_apply included", () => {
    const actions = planApply(makeInput({
      kpi: {
        windowDays: 30,
        sampling: { matchedCommits: 25 } as any,
        flaky: { brokenTests: 0, intermittentFlaky: 0, trueFlakyRate: 0, flakyTrend: 0 },
        data: { confidence: "moderate", staleDays: 0 } as any,
      } as any,
      probe: { hasGitRemote: true, hasGithubToken: true, hasLocalHistory: true },
    }));
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("collect_ci");
    expect(kinds).toContain("calibrate");
    expect(kinds).toContain("quarantine_apply");
    expect(kinds).not.toContain("cold_start_run");
  });

  it("Path 2 (high confidence): calibrate and quarantine_apply included, every action has reason", () => {
    const actions = planApply(makeInput({
      kpi: {
        windowDays: 30,
        sampling: { matchedCommits: 25 } as any,
        flaky: { brokenTests: 0, intermittentFlaky: 0, trueFlakyRate: 0, flakyTrend: 0 },
        data: { confidence: "high", staleDays: 0 } as any,
      } as any,
      probe: { hasGitRemote: true, hasGithubToken: true, hasLocalHistory: true },
    }));
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("collect_ci");
    expect(kinds).toContain("calibrate");
    expect(kinds).toContain("quarantine_apply");
    expect(kinds).not.toContain("cold_start_run");
    for (const a of actions) {
      expect(typeof a.reason).toBe("string");
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });

  it("skips collect_ci when GITHUB_TOKEN missing", () => {
    const actions = planApply(makeInput({
      probe: { hasGitRemote: true, hasGithubToken: false, hasLocalHistory: false },
    }));
    expect(actions.find((a) => a.kind === "collect_ci")).toBeUndefined();
  });

  it("skips quarantine_apply when quarantine.auto=false", () => {
    const input = makeInput({
      kpi: {
        windowDays: 30,
        sampling: { matchedCommits: 25 } as any,
        flaky: { brokenTests: 0, intermittentFlaky: 0, trueFlakyRate: 0, flakyTrend: 0 },
        data: { confidence: "moderate", staleDays: 0 } as any,
      } as any,
    });
    (input.config as any).quarantine.auto = false;
    const actions = planApply(input);
    expect(actions.find((a) => a.kind === "quarantine_apply")).toBeUndefined();
  });

  it("each action carries a non-empty reason", () => {
    const actions = planApply(makeInput());
    for (const a of actions) {
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });
});
