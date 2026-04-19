import { describe, expect, it, vi } from "vitest";
import { executeDag } from "../../src/cli/commands/apply/dag.js";
import type { PlannedAction } from "../../src/cli/commands/apply/planner.js";

describe("executeDag", () => {
  it("runs independent actions concurrently", async () => {
    const order: string[] = [];
    const collectCi = vi.fn(async () => { order.push("collect_ci:start"); await new Promise((r) => setTimeout(r, 10)); order.push("collect_ci:end"); return {}; });
    const coldStartRun = vi.fn(async () => { order.push("cold_start_run:start"); await new Promise((r) => setTimeout(r, 10)); order.push("cold_start_run:end"); return {}; });

    const actions: PlannedAction[] = [
      { kind: "collect_ci", reason: "", windowDays: 30 },
      { kind: "cold_start_run", reason: "" },
    ];

    const result = await executeDag(actions, {
      collectCi,
      calibrate: vi.fn(),
      coldStartRun,
      quarantineApply: vi.fn(),
    });

    // Both started before either finished → concurrency
    expect(order.indexOf("collect_ci:start")).toBeLessThan(order.indexOf("collect_ci:end"));
    expect(order.indexOf("cold_start_run:start")).toBeLessThan(order.indexOf("cold_start_run:end"));
    const bothStartedEarly = order.slice(0, 2).every((e) => e.endsWith(":start"));
    expect(bothStartedEarly).toBe(true);
    expect(result.executed.every((e) => e.status === "ok")).toBe(true);
  });

  it("skips downstream when dependency fails but runs peers", async () => {
    const collectCi = vi.fn(async () => { throw new Error("network"); });
    const calibrate = vi.fn(async () => ({}));
    const coldStartRun = vi.fn(async () => ({}));

    const actions: PlannedAction[] = [
      { kind: "collect_ci", reason: "", windowDays: 30 },
      { kind: "calibrate", reason: "" },
      { kind: "cold_start_run", reason: "" },
    ];

    const result = await executeDag(actions, {
      collectCi, calibrate, coldStartRun, quarantineApply: vi.fn(),
    });

    expect(collectCi).toHaveBeenCalled();
    expect(calibrate).not.toHaveBeenCalled(); // dependency failed → skipped
    expect(coldStartRun).toHaveBeenCalled();  // peer still runs

    const byKind = Object.fromEntries(result.executed.map((e) => [e.kind, e.status]));
    expect(byKind).toEqual({ collect_ci: "failed", calibrate: "skipped", cold_start_run: "ok" });
  });

  it("empty actions returns empty", async () => {
    const result = await executeDag([], {
      collectCi: vi.fn(), calibrate: vi.fn(), coldStartRun: vi.fn(), quarantineApply: vi.fn(),
    });
    expect(result.executed).toEqual([]);
  });

  it("non-Error throw still reports error string", async () => {
    const result = await executeDag(
      [{ kind: "collect_ci", reason: "", windowDays: 30 }],
      {
        collectCi: async () => { throw "boom"; },
        calibrate: vi.fn(),
        coldStartRun: vi.fn(),
        quarantineApply: vi.fn(),
      },
    );
    expect(result.executed[0].status).toBe("failed");
    expect(result.executed[0].error).toBe("boom");
  });

  it("skipped action carries 'dependency failed' reason", async () => {
    const collectCi = async () => { throw new Error("x"); };
    const result = await executeDag(
      [
        { kind: "collect_ci", reason: "", windowDays: 30 },
        { kind: "calibrate", reason: "" },
      ],
      { collectCi, calibrate: vi.fn(), coldStartRun: vi.fn(), quarantineApply: vi.fn() },
    );
    const calibrate = result.executed.find((e) => e.kind === "calibrate");
    expect(calibrate?.status).toBe("skipped");
    expect(calibrate?.skippedReason).toMatch(/dependency/i);
  });

  it("quarantine_apply depends on calibrate transitively", async () => {
    const collectCi = async () => { throw new Error("x"); };
    const result = await executeDag(
      [
        { kind: "collect_ci", reason: "", windowDays: 30 },
        { kind: "calibrate", reason: "" },
        { kind: "quarantine_apply", reason: "" },
      ],
      { collectCi, calibrate: vi.fn(), coldStartRun: vi.fn(), quarantineApply: vi.fn() },
    );
    // collect_ci fails → calibrate skipped → quarantine_apply skipped transitively
    const byKind = Object.fromEntries(result.executed.map((e) => [e.kind, e.status]));
    expect(byKind).toEqual({ collect_ci: "failed", calibrate: "skipped", quarantine_apply: "skipped" });
  });
});
