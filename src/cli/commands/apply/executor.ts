import type { PlannedAction } from "./planner.js";
import { executeDag, type DagExecutionResult } from "./dag.js";

export interface ExecutorDeps {
  collectCi: (args: { windowDays: number }) => Promise<unknown>;
  calibrate: () => Promise<unknown>;
  coldStartRun: () => Promise<unknown>;
  quarantineApply: () => Promise<unknown>;
}

export interface ExecutedAction {
  kind: PlannedAction["kind"];
  ok: boolean;
  error?: string;
  result?: unknown;
}

export interface ExecutionResult {
  executed: ExecutedAction[];
  aborted: boolean;
}

/**
 * @deprecated since 0.9.0 — use executeDag() from ./dag.js which supports
 * per-node status and parallel execution. executePlan() is kept as a thin
 * wrapper for legacy callers; it maps DagExecutedAction → ExecutedAction
 * (ok = status === "ok") and infers aborted = executed.some(e => !e.ok).
 */
export async function executePlan(
  actions: PlannedAction[],
  deps: ExecutorDeps,
): Promise<ExecutionResult> {
  const dag: DagExecutionResult = await executeDag(actions, deps);
  const executed = dag.executed.map<ExecutedAction>((e) => ({
    kind: e.kind,
    ok: e.status === "ok",
    ...(e.error ? { error: e.error } : e.skippedReason ? { error: e.skippedReason } : {}),
    ...(e.result !== undefined ? { result: e.result } : {}),
  }));
  const aborted = executed.some((e) => !e.ok);
  return { executed, aborted };
}
