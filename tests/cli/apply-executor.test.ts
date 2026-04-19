import { describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/cli/commands/apply/executor.js";
import type { PlannedAction } from "../../src/cli/commands/apply/planner.js";

describe("executePlan", () => {
  it("calls each dep in order and collects ok results", async () => {
    const collectCi = vi.fn(async () => ({ runsCollected: 5 }));
    const calibrate = vi.fn(async () => ({ written: true }));
    const coldStartRun = vi.fn(async () => ({ exitCode: 0 }));
    const quarantineApply = vi.fn(async () => ({ applied: 2 }));

    const actions: PlannedAction[] = [
      { kind: "collect_ci", reason: "r1", windowDays: 30 },
      { kind: "calibrate", reason: "r2" },
      { kind: "cold_start_run", reason: "r3" },
      { kind: "quarantine_apply", reason: "r4" },
    ];

    const result = await executePlan(actions, {
      collectCi, calibrate, coldStartRun, quarantineApply,
    });

    expect(collectCi).toHaveBeenCalledWith({ windowDays: 30 });
    expect(calibrate).toHaveBeenCalledOnce();
    expect(coldStartRun).toHaveBeenCalledOnce();
    expect(quarantineApply).toHaveBeenCalledOnce();
    expect(result.executed).toHaveLength(4);
    expect(result.executed.map((e) => e.kind)).toEqual([
      "collect_ci", "calibrate", "cold_start_run", "quarantine_apply",
    ]);
    expect(result.executed.every((e) => e.ok)).toBe(true);
    expect(result.aborted).toBe(false);
  });

  it("stops on first failure and marks aborted", async () => {
    const collectCi = vi.fn(async () => { throw new Error("network"); });
    const calibrate = vi.fn();
    const coldStartRun = vi.fn();
    const quarantineApply = vi.fn();

    const result = await executePlan(
      [
        { kind: "collect_ci", reason: "", windowDays: 30 },
        { kind: "calibrate", reason: "" },
      ],
      { collectCi, calibrate, coldStartRun, quarantineApply },
    );

    expect(calibrate).not.toHaveBeenCalled();
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0].ok).toBe(false);
    expect(result.executed[0].error).toBe("network");
    expect(result.aborted).toBe(true);
  });

  it("empty actions returns empty, not aborted", async () => {
    const result = await executePlan([], {
      collectCi: vi.fn(),
      calibrate: vi.fn(),
      coldStartRun: vi.fn(),
      quarantineApply: vi.fn(),
    });
    expect(result.executed).toEqual([]);
    expect(result.aborted).toBe(false);
  });

  it("non-Error throw still reports error string", async () => {
    const collectCi = vi.fn(async () => { throw "boom"; });
    const result = await executePlan(
      [{ kind: "collect_ci", reason: "", windowDays: 30 }],
      { collectCi, calibrate: vi.fn(), coldStartRun: vi.fn(), quarantineApply: vi.fn() },
    );
    expect(result.executed[0].ok).toBe(false);
    expect(result.executed[0].error).toBe("boom");
    expect(result.aborted).toBe(true);
  });
});
