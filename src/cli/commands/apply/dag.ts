import type { PlannedAction } from "./planner.js";
import type { ExecutorDeps } from "./executor.js";

export interface DagExecutedAction {
  kind: PlannedAction["kind"];
  status: "ok" | "failed" | "skipped";
  error?: string;
  skippedReason?: string;
  result?: unknown;
}

export interface DagExecutionResult {
  executed: DagExecutedAction[];
}

// Hard-coded dependency map: action kind → set of kinds it depends on.
// If a dependency is not present in the plan, the action runs independently.
const DEPENDENCIES: Record<PlannedAction["kind"], PlannedAction["kind"][]> = {
  collect_ci: [],
  calibrate: ["collect_ci"],
  cold_start_run: [],
  quarantine_apply: ["calibrate"],
};

export async function executeDag(
  actions: PlannedAction[],
  deps: ExecutorDeps,
): Promise<DagExecutionResult> {
  const executed: DagExecutedAction[] = [];
  const statusByKind = new Map<PlannedAction["kind"], DagExecutedAction["status"]>();
  const presentKinds = new Set(actions.map((a) => a.kind));

  // Process actions in waves; Promise.all for peers whose dependencies
  // (if present in the plan) are already resolved.
  const pending = [...actions];
  while (pending.length > 0) {
    // Collect all pending actions whose dependencies are either absent from the
    // plan or already resolved.
    const ready: PlannedAction[] = [];
    const remaining: PlannedAction[] = [];
    for (const action of pending) {
      const actionDeps = DEPENDENCIES[action.kind].filter((d) => presentKinds.has(d));
      const allResolved = actionDeps.every((d) => statusByKind.has(d));
      if (allResolved) ready.push(action);
      else remaining.push(action);
    }

    if (ready.length === 0) {
      // Circular or unsatisfiable; shouldn't happen with the hard-coded map,
      // but guard against it.
      for (const action of remaining) {
        statusByKind.set(action.kind, "skipped");
        executed.push({ kind: action.kind, status: "skipped", skippedReason: "unresolvable dependency" });
      }
      break;
    }

    // Run all ready actions in parallel; skip those whose upstream failed/skipped.
    const results = await Promise.all(ready.map(async (action): Promise<DagExecutedAction> => {
      const actionDeps = DEPENDENCIES[action.kind].filter((d) => presentKinds.has(d));
      const failedUpstream = actionDeps.find((d) => statusByKind.get(d) !== "ok");
      if (failedUpstream !== undefined) {
        const upstreamStatus = statusByKind.get(failedUpstream);
        return {
          kind: action.kind,
          status: "skipped",
          skippedReason: `dependency ${failedUpstream} ${upstreamStatus ?? "unknown"}`,
        };
      }
      try {
        const result = await dispatch(action, deps);
        return { kind: action.kind, status: "ok", result };
      } catch (err) {
        return {
          kind: action.kind,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));

    for (const r of results) {
      statusByKind.set(r.kind, r.status);
      executed.push(r);
    }

    pending.length = 0;
    pending.push(...remaining);
  }

  return { executed };
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
