import type { PlannedAction } from "./planner.js";

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

export async function executePlan(
  actions: PlannedAction[],
  deps: ExecutorDeps,
): Promise<ExecutionResult> {
  const executed: ExecutedAction[] = [];
  for (const action of actions) {
    try {
      const result = await dispatch(action, deps);
      executed.push({ kind: action.kind, ok: true, result });
    } catch (err) {
      executed.push({
        kind: action.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return { executed, aborted: true };
    }
  }
  return { executed, aborted: false };
}

async function dispatch(action: PlannedAction, deps: ExecutorDeps): Promise<unknown> {
  switch (action.kind) {
    case "collect_ci":
      return deps.collectCi({ windowDays: action.windowDays });
    case "calibrate":
      return deps.calibrate();
    case "cold_start_run":
      return deps.coldStartRun();
    case "quarantine_apply":
      return deps.quarantineApply();
  }
}
