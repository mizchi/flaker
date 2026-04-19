import { describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/cli/commands/apply/executor.js";
import type { PlannedAction } from "../../src/cli/commands/apply/planner.js";

describe("executePlan", () => {
  it("calls each dep and collects ok results (DAG: independent actions run concurrently)", async () => {
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
    // DAG runs collect_ci + cold_start_run concurrently (wave 1),
    // then calibrate (wave 2, depends on collect_ci),
    // then quarantine_apply (wave 3, depends on calibrate).
    // Order within a wave is not guaranteed; use a set-based check.
    expect(new Set(result.executed.map((e) => e.kind))).toEqual(
      new Set(["collect_ci", "calibrate", "cold_start_run", "quarantine_apply"]),
    );
    expect(result.executed.every((e) => e.ok)).toBe(true);
    expect(result.aborted).toBe(false);
  });

  it("legacy wrapper: failed action aborts; dependent actions appear as skipped (ok:false)", async () => {
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

    // calibrate depends on collect_ci → skipped (not called), mapped to ok:false
    expect(calibrate).not.toHaveBeenCalled();
    expect(result.executed).toHaveLength(2);
    expect(result.executed[0].ok).toBe(false);
    expect(result.executed[0].error).toBe("network");
    // calibrate is skipped → ok: false with skippedReason surfaced as error
    expect(result.executed.find((e) => e.kind === "calibrate")?.ok).toBe(false);
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
