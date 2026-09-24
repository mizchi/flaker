import { describe, expect, it, vi } from "vitest";
import { executeInPlanOrder } from "../../src/cli/commands/apply/dag.js";
import type { PlannedAction } from "../../src/cli/commands/apply/planner.js";

describe("executeInPlanOrder", () => {
  it("reports executed actions in plan order, not DAG-wave order", async () => {
    const actions: PlannedAction[] = [
      { kind: "collect_ci", reason: "", windowDays: 30 },
      { kind: "calibrate", reason: "" },
      { kind: "cold_start_run", reason: "" },
      { kind: "quarantine_apply", reason: "" },
    ];

    const result = await executeInPlanOrder(actions, {
      collectCi: vi.fn(async () => ({})),
      calibrate: vi.fn(async () => ({})),
      coldStartRun: vi.fn(async () => ({})),
      quarantineApply: vi.fn(async () => ({})),
    } as any);

    expect(result.executed.map((e) => e.kind)).toEqual([
      "collect_ci",
      "calibrate",
      "cold_start_run",
      "quarantine_apply",
    ]);
  });

  it("keeps plan order for skipped downstream actions", async () => {
    const actions: PlannedAction[] = [
      { kind: "collect_ci", reason: "", windowDays: 30 },
      { kind: "calibrate", reason: "" },
      { kind: "cold_start_run", reason: "" },
    ];

    const result = await executeInPlanOrder(actions, {
      collectCi: vi.fn(async () => { throw new Error("network"); }),
      calibrate: vi.fn(async () => ({})),
      coldStartRun: vi.fn(async () => ({})),
      quarantineApply: vi.fn(),
    } as any);

    expect(result.executed.map((e) => [e.kind, e.status])).toEqual([
      ["collect_ci", "failed"],
      ["calibrate", "skipped"],
      ["cold_start_run", "ok"],
    ]);
  });
});
