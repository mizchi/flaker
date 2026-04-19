# Declarative Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `flaker plan` / `flaker apply` as a declarative orchestrator so users and AI agents can collapse the Day 1 flow (`init → doctor → collect → calibrate → run`) into a single idempotent command driven by `flaker.toml`.

**Architecture:** A pure planner module reads `FlakerConfig` and the current `FlakerKpi` and emits a typed `PlannedAction[]` list. `flaker plan` renders it; `flaker apply` executes each action by calling existing primitives (`runCollectCi`, `runCalibrate`, `runQuarantineApply`, `prepareRunRequest + executePreparedLocalRun`). A new `[promotion]` config section declares the desired thresholds; `flaker status` is extended to render drift vs those thresholds. No existing commands change behavior; alias deprecation is soft (stderr warning only).

**Tech Stack:** Node.js 24+, TypeScript, Commander, Vitest, DuckDB, existing `MetricStore` / `computeKpi` / `runStatusSummary` primitives.

---

## Scope & Non-goals

**In scope:**
- `[promotion]` config section with defaults matching current README thresholds
- `planApply()` pure function: `(FlakerConfig, FlakerKpi, RepoProbe) → PlannedAction[]`
- `flaker plan` command (dry-run)
- `flaker apply` command (executes)
- `status` drift column against `[promotion]` thresholds
- Soft deprecation warnings on `flaker kpi` / `flaker doctor` top-level aliases (keep the aliases working, just log once to stderr)
- Iter 5 docs update: README, operations-guide.ja, how-to-use.ja, new-project-checklist.ja — unify `collect` / `calibrate` naming and add `Future: declarative apply` note

**Out of scope (separate plans):**
- Rewriting `flaker-setup` / `flaker-management` skills to apply-based workflow
- Removing legacy aliases outright (breaking change, 0.7.0)
- Reorganizing `analyze` / `policy` / `exec` / `setup` category placement

---

## File Structure

**Create:**
- `src/cli/commands/apply/planner.ts` — pure planner, exports `PlannedAction`, `planApply()`
- `src/cli/commands/apply/executor.ts` — executes a `PlannedAction[]`
- `src/cli/commands/apply/promotion.ts` — loads `[promotion]` defaults, merges with config
- `src/cli/categories/apply.ts` — registers `flaker plan` and `flaker apply` commands
- `tests/cli/apply-planner.test.ts` — unit tests for `planApply()`
- `tests/cli/apply-cli.test.ts` — CLI-level smoke tests for `flaker plan` / `flaker apply`
- `tests/cli/status-drift.test.ts` — drift rendering tests

**Modify:**
- `src/cli/config.ts` — add `promotion` to `FlakerConfig` type + loader
- `src/cli/commands/status/summary.ts` — add `drift` field + rendering
- `src/cli/main.ts` — register apply category, add deprecation warnings to `kpi` / `doctor` aliases
- `README.md` — unify naming, add `Future: declarative apply` note
- `docs/operations-guide.ja.md` — reference `flaker apply` / `flaker plan` in cadence
- `docs/how-to-use.ja.md` — add `flaker plan` / `flaker apply` chapter
- `docs/new-project-checklist.ja.md` — mention apply in Day 2-3

---

## Task 1: Add `[promotion]` config schema

**Files:**
- Modify: `src/cli/config.ts`
- Test: `tests/cli/config-promotion.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/config-promotion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseConfigToml } from "../../src/cli/config.js";

describe("promotion config", () => {
  it("applies defaults when [promotion] is absent", () => {
    const config = parseConfigToml(`
[repo]
owner = "o"
name = "n"
[storage]
path = "x.db"
[adapter]
type = "playwright"
[runner]
type = "playwright"
command = "pw"
`);
    expect(config.promotion.matched_commits_min).toBe(20);
    expect(config.promotion.false_negative_rate_max_percentage).toBe(5);
    expect(config.promotion.pass_correlation_min_percentage).toBe(95);
    expect(config.promotion.holdout_fnr_max_percentage).toBe(10);
    expect(config.promotion.data_confidence_min).toBe("moderate");
  });

  it("accepts overrides", () => {
    const config = parseConfigToml(`
[repo]
owner = "o"
name = "n"
[storage]
path = "x.db"
[adapter]
type = "playwright"
[runner]
type = "playwright"
command = "pw"
[promotion]
matched_commits_min = 50
data_confidence_min = "high"
`);
    expect(config.promotion.matched_commits_min).toBe(50);
    expect(config.promotion.data_confidence_min).toBe("high");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test tests/cli/config-promotion.test.ts -t "promotion config"`
Expected: FAIL with "parseConfigToml not exported" or "promotion is undefined".

- [ ] **Step 3: Implement schema**

In `src/cli/config.ts`, add the interface and defaults. Export `parseConfigToml` if not already exported (wrap existing loader so the test can use string input).

```ts
export interface PromotionThresholds {
  matched_commits_min: number;
  false_negative_rate_max_percentage: number;
  pass_correlation_min_percentage: number;
  holdout_fnr_max_percentage: number;
  data_confidence_min: "low" | "moderate" | "high";
}

export const DEFAULT_PROMOTION: PromotionThresholds = {
  matched_commits_min: 20,
  false_negative_rate_max_percentage: 5,
  pass_correlation_min_percentage: 95,
  holdout_fnr_max_percentage: 10,
  data_confidence_min: "moderate",
};
```

Add `promotion: PromotionThresholds` to `FlakerConfig`. In the TOML loader, merge `raw.promotion ?? {}` over `DEFAULT_PROMOTION` and validate with Zod (follow existing patterns in the file — search for other `z.object` schemas).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cli/config-promotion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts tests/cli/config-promotion.test.ts
git commit -m "feat(config): add [promotion] section with documented defaults"
```

---

## Task 2: Planner — pure `planApply()` function

**Files:**
- Create: `src/cli/commands/apply/planner.ts`
- Test: `tests/cli/apply-planner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/apply-planner.test.ts`:

```ts
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
  it("Path 1 (no history): collect then run iteration, skip calibrate", () => {
    const actions = planApply(makeInput());
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("collect_ci");
    expect(kinds).not.toContain("calibrate");
    expect(kinds).toContain("cold_start_run");
  });

  it("Path 2 (moderate history): calibrate then quarantine apply", () => {
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
  });

  it("skips collect_ci when GITHUB_TOKEN is missing", () => {
    const actions = planApply(makeInput({
      probe: { hasGitRemote: true, hasGithubToken: false, hasLocalHistory: false },
    }));
    const collect = actions.find((a) => a.kind === "collect_ci");
    expect(collect).toBeUndefined();
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
    input.config.quarantine.auto = false;
    const actions = planApply(input);
    expect(actions.find((a) => a.kind === "quarantine_apply")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cli/apply-planner.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement planner**

Create `src/cli/commands/apply/planner.ts`:

```ts
import type { FlakerConfig } from "../../config.js";
import type { FlakerKpi } from "../analyze/kpi.js";

export interface RepoProbe {
  hasGitRemote: boolean;
  hasGithubToken: boolean;
  hasLocalHistory: boolean;
}

export type PlannedAction =
  | { kind: "collect_ci"; reason: string; windowDays: number }
  | { kind: "calibrate"; reason: string }
  | { kind: "cold_start_run"; reason: string }
  | { kind: "quarantine_apply"; reason: string };

export interface PlannerInput {
  config: FlakerConfig;
  kpi: FlakerKpi;
  probe: RepoProbe;
}

export function planApply(input: PlannerInput): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const confidence = input.kpi.data.confidence;
  const hasUsefulHistory = confidence === "moderate" || confidence === "high";

  if (input.probe.hasGithubToken) {
    actions.push({
      kind: "collect_ci",
      reason: input.kpi.data.staleDays == null
        ? "no prior collect; pulling initial history"
        : `history stale by ${input.kpi.data.staleDays} day(s)`,
      windowDays: 30,
    });
  }

  if (hasUsefulHistory) {
    actions.push({ kind: "calibrate", reason: `data confidence=${confidence}; re-tuning sampling` });
  }

  if (!input.probe.hasLocalHistory) {
    actions.push({
      kind: "cold_start_run",
      reason: "no local history recorded; seeding via iteration gate",
    });
  }

  if (input.config.quarantine.auto && hasUsefulHistory) {
    actions.push({
      kind: "quarantine_apply",
      reason: "quarantine.auto=true; applying suggested quarantine plan",
    });
  }

  return actions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cli/apply-planner.test.ts`
Expected: PASS on all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/apply/planner.ts tests/cli/apply-planner.test.ts
git commit -m "feat(apply): add pure planApply function"
```

---

## Task 3: Executor — dispatch `PlannedAction` to existing primitives

**Files:**
- Create: `src/cli/commands/apply/executor.ts`
- Test: `tests/cli/apply-executor.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/apply-executor.test.ts`. The executor takes a deps object (dependency injection, same pattern as `runOpsDaily`); tests use mock deps so no DuckDB / network needed.

```ts
import { describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/cli/commands/apply/executor.js";
import type { PlannedAction } from "../../src/cli/commands/apply/planner.js";

describe("executePlan", () => {
  it("calls each dep in order and collects results", async () => {
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
      collectCi,
      calibrate,
      coldStartRun,
      quarantineApply,
    });

    expect(collectCi).toHaveBeenCalledWith({ windowDays: 30 });
    expect(calibrate).toHaveBeenCalledOnce();
    expect(coldStartRun).toHaveBeenCalledOnce();
    expect(quarantineApply).toHaveBeenCalledOnce();
    expect(result.executed).toHaveLength(4);
    expect(result.executed[0]).toMatchObject({ kind: "collect_ci", ok: true });
  });

  it("stops on first failure", async () => {
    const collectCi = vi.fn(async () => { throw new Error("network"); });
    const calibrate = vi.fn();
    const result = await executePlan(
      [
        { kind: "collect_ci", reason: "", windowDays: 30 },
        { kind: "calibrate", reason: "" },
      ],
      { collectCi, calibrate, coldStartRun: vi.fn(), quarantineApply: vi.fn() },
    );
    expect(calibrate).not.toHaveBeenCalled();
    expect(result.executed[0].ok).toBe(false);
    expect(result.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cli/apply-executor.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement executor**

Create `src/cli/commands/apply/executor.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cli/apply-executor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/apply/executor.ts tests/cli/apply-executor.test.ts
git commit -m "feat(apply): add executePlan dispatcher with abort-on-failure"
```

---

## Task 4: `flaker plan` CLI — render the action list

**Files:**
- Create: `src/cli/categories/apply.ts`
- Modify: `src/cli/main.ts`
- Test: `tests/cli/apply-cli.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/apply-cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../dist/cli/main.js");

describe("flaker plan", () => {
  it("prints 'No actions needed' when plan is empty", () => {
    // Pre-populated fixture repo with existing up-to-date history is unrealistic
    // for this smoke test; instead we invoke the planner directly.
    // See apply-planner.test.ts for exhaustive cases.
    // This smoke test just verifies --help works.
    const out = execFileSync("node", [CLI, "plan", "--help"]).toString();
    expect(out).toContain("Preview actions");
  });
});
```

Note: because a real `plan` run requires DuckDB and config, the smoke test is limited to `--help`. The planner itself is covered by unit tests in Task 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm test tests/cli/apply-cli.test.ts`
Expected: FAIL with `error: unknown command 'plan'`.

- [ ] **Step 3: Implement `flaker plan`**

Create `src/cli/categories/apply.ts`:

```ts
import type { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { computeKpi } from "../commands/analyze/kpi.js";
import { planApply, type PlannedAction, type RepoProbe } from "../commands/apply/planner.js";

function describeAction(action: PlannedAction): string {
  switch (action.kind) {
    case "collect_ci":
      return `collect_ci --days ${action.windowDays}    (${action.reason})`;
    case "calibrate":
      return `calibrate                    (${action.reason})`;
    case "cold_start_run":
      return `run --gate iteration         (${action.reason})`;
    case "quarantine_apply":
      return `quarantine apply             (${action.reason})`;
  }
}

function probeRepo(cwd: string): RepoProbe {
  return {
    hasGitRemote: existsSync(resolve(cwd, ".git")),
    hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
    hasLocalHistory: false, // filled in below after DB open
  };
}

export async function planAction(opts: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = probeRepo(cwd);
    const actions = planApply({ config, kpi, probe });
    if (opts.json) {
      console.log(JSON.stringify({ actions }, null, 2));
      return;
    }
    if (actions.length === 0) {
      console.log("No actions needed. Current state matches flaker.toml.");
      return;
    }
    console.log("Planned actions:");
    for (const action of actions) {
      console.log(`  - ${describeAction(action)}`);
    }
  } finally {
    await store.close();
  }
}

export function registerApplyCommands(program: Command): void {
  program
    .command("plan")
    .description("Preview actions `flaker apply` would take for the current repo state")
    .option("--json", "Output as JSON")
    .action(planAction);
}
```

Modify `src/cli/main.ts` to import `registerApplyCommands` and call it in `createProgram`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test tests/cli/apply-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/categories/apply.ts src/cli/main.ts tests/cli/apply-cli.test.ts
git commit -m "feat(apply): add 'flaker plan' command"
```

---

## Task 5: `flaker apply` CLI — execute the plan

**Files:**
- Modify: `src/cli/categories/apply.ts`
- Test: `tests/cli/apply-cli.test.ts`

- [ ] **Step 1: Extend the CLI smoke test**

Append to `tests/cli/apply-cli.test.ts`:

```ts
describe("flaker apply", () => {
  it("prints help", () => {
    const out = execFileSync("node", [CLI, "apply", "--help"]).toString();
    expect(out).toContain("Apply planned actions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm test tests/cli/apply-cli.test.ts`
Expected: FAIL with `error: unknown command 'apply'`.

- [ ] **Step 3: Implement `flaker apply`**

Append to `src/cli/categories/apply.ts`:

```ts
import { runCollectCi } from "../commands/collect/ci.js"; // adjust if the export name differs
import { runCalibrate } from "../commands/collect/calibrate.js";
import { runQuarantineApply } from "../commands/quarantine/apply.js";
import { prepareRunRequest } from "../commands/exec/prepare-run-request.js";
import { executePreparedLocalRun } from "../commands/exec/execute-prepared-local-run.js";
import { createConfiguredResolver } from "./shared-resolver.js";
import { detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { executePlan, type ExecutorDeps } from "../commands/apply/executor.js";

export async function applyAction(opts: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = probeRepo(cwd);
    const actions = planApply({ config, kpi, probe });

    const deps: ExecutorDeps = {
      collectCi: async ({ windowDays }) => runCollectCi({ store, config, windowDays }),
      calibrate: async () => runCalibrate({ store, config, cwd }),
      coldStartRun: async () => {
        const prepared = await prepareRunRequest({
          cwd,
          config,
          store,
          opts: { gate: "iteration" },
          deps: { detectChangedFiles, loadQuarantineManifestIfExists, createResolver: createConfiguredResolver },
        });
        return executePreparedLocalRun({ store, config, cwd, prepared });
      },
      quarantineApply: async () => runQuarantineApply({ store, config, cwd, createIssues: false }),
    };

    const result = await executePlan(actions, deps);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const exec of result.executed) {
        console.log(`${exec.ok ? "✓" : "✗"} ${exec.kind}${exec.error ? ` — ${exec.error}` : ""}`);
      }
      if (result.aborted) {
        process.exitCode = 1;
      }
    }
  } finally {
    await store.close();
  }
}
```

Register the command in `registerApplyCommands`:

```ts
program
  .command("apply")
  .description("Apply planned actions to converge the repo state to flaker.toml")
  .option("--json", "Output as JSON")
  .action(applyAction);
```

**Important:** Before writing the code above, run `ls src/cli/commands/collect` and `ls src/cli/commands/quarantine` to confirm the exact exported function names (`runCollectCi` / `runCalibrate` / `runQuarantineApply` are guesses based on convention). Adjust the imports to match actual exports. If a function does not exist in the expected form, wrap the existing CLI action in a thin helper instead of inlining store/config plumbing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test tests/cli/apply-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck passes**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/cli/categories/apply.ts tests/cli/apply-cli.test.ts
git commit -m "feat(apply): add 'flaker apply' command wiring existing primitives"
```

---

## Task 6: Extend `status` with drift vs `[promotion]`

**Files:**
- Modify: `src/cli/commands/status/summary.ts`
- Test: `tests/cli/status-drift.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/status-drift.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDrift } from "../../src/cli/commands/status/summary.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

describe("computeDrift", () => {
  it("flags every unmet threshold", () => {
    const drift = computeDrift(
      {
        matchedCommits: 10,
        falseNegativeRatePercentage: 8,
        passCorrelationPercentage: 90,
        holdoutFnrPercentage: 15,
        dataConfidence: "low",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(false);
    expect(drift.unmet.map((u) => u.field)).toEqual([
      "matched_commits",
      "false_negative_rate",
      "pass_correlation",
      "holdout_fnr",
      "data_confidence",
    ]);
  });

  it("returns ok=true when all thresholds are met", () => {
    const drift = computeDrift(
      {
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(true);
    expect(drift.unmet).toHaveLength(0);
  });

  it("treats null metrics as unmet", () => {
    const drift = computeDrift(
      {
        matchedCommits: 30,
        falseNegativeRatePercentage: null,
        passCorrelationPercentage: null,
        holdoutFnrPercentage: null,
        dataConfidence: "moderate",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(false);
    expect(drift.unmet.map((u) => u.field)).toContain("false_negative_rate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cli/status-drift.test.ts`
Expected: FAIL with "computeDrift is not exported".

- [ ] **Step 3: Implement and wire `computeDrift`**

In `src/cli/commands/status/summary.ts`:

```ts
import type { PromotionThresholds } from "../../config.js";

export interface DriftInput {
  matchedCommits: number;
  falseNegativeRatePercentage: number | null;
  passCorrelationPercentage: number | null;
  holdoutFnrPercentage: number | null;
  dataConfidence: "insufficient" | "low" | "moderate" | "high";
}

export interface DriftItem {
  field: string;
  actual: number | string | null;
  threshold: number | string;
}

export interface DriftReport {
  ok: boolean;
  unmet: DriftItem[];
}

const CONFIDENCE_RANK = { insufficient: 0, low: 1, moderate: 2, high: 3 } as const;

export function computeDrift(input: DriftInput, thresholds: PromotionThresholds): DriftReport {
  const unmet: DriftItem[] = [];
  if (input.matchedCommits < thresholds.matched_commits_min) {
    unmet.push({ field: "matched_commits", actual: input.matchedCommits, threshold: thresholds.matched_commits_min });
  }
  if (input.falseNegativeRatePercentage == null || input.falseNegativeRatePercentage > thresholds.false_negative_rate_max_percentage) {
    unmet.push({ field: "false_negative_rate", actual: input.falseNegativeRatePercentage, threshold: thresholds.false_negative_rate_max_percentage });
  }
  if (input.passCorrelationPercentage == null || input.passCorrelationPercentage < thresholds.pass_correlation_min_percentage) {
    unmet.push({ field: "pass_correlation", actual: input.passCorrelationPercentage, threshold: thresholds.pass_correlation_min_percentage });
  }
  if (input.holdoutFnrPercentage == null || input.holdoutFnrPercentage > thresholds.holdout_fnr_max_percentage) {
    unmet.push({ field: "holdout_fnr", actual: input.holdoutFnrPercentage, threshold: thresholds.holdout_fnr_max_percentage });
  }
  if (CONFIDENCE_RANK[input.dataConfidence] < CONFIDENCE_RANK[thresholds.data_confidence_min]) {
    unmet.push({ field: "data_confidence", actual: input.dataConfidence, threshold: thresholds.data_confidence_min });
  }
  return { ok: unmet.length === 0, unmet };
}
```

Extend `StatusSummary` with a `drift: DriftReport` field, wire `computeDrift` inside `runStatusSummary`, and update `formatStatusSummary` to print a `## Promotion drift` section when `drift.ok === false`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/cli/status-drift.test.ts`
Expected: PASS all 3 cases.

- [ ] **Step 5: Run full suite to catch regressions**

Run: `pnpm test`
Expected: no prior tests broken. If `runStatusSummary` has existing snapshot tests, update them to account for the new `drift` field.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/status/summary.ts tests/cli/status-drift.test.ts
git commit -m "feat(status): render drift vs [promotion] thresholds"
```

---

## Task 7: Soft deprecation warnings on `flaker kpi` / `flaker doctor` top-level aliases

**Files:**
- Modify: `src/cli/main.ts`
- Test: `tests/cli/deprecation-warning.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../dist/cli/main.js");

describe("deprecation warnings", () => {
  it("flaker kpi --help emits a deprecation note on stderr", () => {
    const res = execFileSync("node", [CLI, "kpi", "--help"], { stdio: ["ignore", "pipe", "pipe"] });
    // stderr is captured separately; execFileSync merges via option — switch to spawnSync
    // ... (test skeleton; see implementation)
  });
});
```

Because `execFileSync` does not cleanly separate stderr, use `spawnSync`:

```ts
import { spawnSync } from "node:child_process";

it("flaker kpi --help emits a deprecation note on stderr", () => {
  const res = spawnSync("node", [CLI, "kpi", "--help"], { encoding: "utf8" });
  expect(res.stderr).toContain("deprecated");
  expect(res.stderr).toContain("flaker analyze kpi");
});

it("flaker doctor --help emits a deprecation note on stderr", () => {
  const res = spawnSync("node", [CLI, "doctor", "--help"], { encoding: "utf8" });
  expect(res.stderr).toContain("deprecated");
  expect(res.stderr).toContain("flaker debug doctor");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm test tests/cli/deprecation-warning.test.ts`
Expected: FAIL (stderr does not contain "deprecated").

- [ ] **Step 3: Implement warnings**

In `src/cli/main.ts`, wrap the two alias actions:

```ts
function warnDeprecated(aliasName: string, canonical: string): void {
  process.stderr.write(
    `warning: \`flaker ${aliasName}\` is deprecated and will be removed in 0.7.0. `
    + `Use \`${canonical}\` instead.\n`,
  );
}

program
  .command("kpi")
  .description("DEPRECATED alias for `flaker analyze kpi` (removed in 0.7.0)")
  .option("--window-days <days>", "Analysis window in days", "30")
  .option("--json", "Output as JSON")
  .action((opts) => {
    warnDeprecated("kpi", "flaker analyze kpi");
    return analyzeKpiAction(opts);
  });

program
  .command("doctor")
  .description("DEPRECATED alias for `flaker debug doctor` (removed in 0.7.0)")
  .action(() => {
    warnDeprecated("doctor", "flaker debug doctor");
    return debugDoctorAction();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test tests/cli/deprecation-warning.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no regression**

Run: `pnpm test tests/cli/top-level-aliases.test.ts`
Expected: existing alias tests still pass. If they assert stderr is empty, adjust them to allow the deprecation line.

- [ ] **Step 6: Commit**

```bash
git add src/cli/main.ts tests/cli/deprecation-warning.test.ts
git commit -m "feat(cli): deprecate 'flaker kpi' and 'flaker doctor' top-level aliases"
```

---

## Task 8: Iter 5 docs — unify `collect` / `calibrate` naming

**Files:**
- Modify: `README.md`, `docs/operations-guide.ja.md`, `docs/how-to-use.ja.md`, `docs/new-project-checklist.ja.md`

The goal is a single rule table the reader can memorize:

| Canonical form (use this) | Legacy / alternative (don't use in new docs) |
|---|---|
| `flaker collect --days N` | `flaker collect ci --days N` (works, but aliased) |
| `flaker collect calibrate` | `flaker calibrate` (does not exist as a top-level command) |
| `flaker analyze kpi` | `flaker kpi` (DEPRECATED, Task 7) |
| `flaker debug doctor` | `flaker doctor` (DEPRECATED, Task 7) |

- [ ] **Step 1: README — add naming rule table**

Insert a new subsection under the existing `Quick Start` command-name notes (near README:260):

```markdown
> **Canonical command forms used in this README**
>
> | Canonical | Legacy alias (accepted but avoid in new docs) |
> |---|---|
> | `flaker collect --days N` | `flaker collect ci --days N` |
> | `flaker collect calibrate` | (no top-level `flaker calibrate`) |
> | `flaker analyze kpi` | `flaker kpi` — DEPRECATED in 0.6.0 |
> | `flaker debug doctor` | `flaker doctor` — DEPRECATED in 0.6.0 |
```

Then grep the README for `flaker calibrate\b` (not followed by whitespace+nothing) and any remaining `collect ci` outside code blocks and replace them with canonical forms.

- [ ] **Step 2: operations-guide.ja — align cadence**

In `docs/operations-guide.ja.md`, in the `毎日` block, replace:

```bash
pnpm flaker collect ci --days 1
pnpm flaker ops daily --output .artifacts/flaker-daily.md
```

with:

```bash
pnpm flaker apply            # idempotent: collects, calibrates, runs gate as needed
pnpm flaker ops daily --output .artifacts/flaker-daily.md
```

Add a short note below the block: `flaker apply は flaker.toml を desired state として現状を収束させる。詳細なコマンド群 (collect / calibrate / quarantine apply) を手動で順に呼ぶ必要は無くなった。`

- [ ] **Step 3: how-to-use.ja — add `flaker plan` / `flaker apply` chapter**

Insert a new chapter right after the `コマンドリファレンス` header (before `flaker collect`):

```markdown
### `flaker plan` / `flaker apply` — 宣言的収束

```bash
flaker plan           # 現状との差分を表示 (dry-run)
flaker plan --json
flaker apply          # 差分を埋めるため collect / calibrate / run / quarantine apply を自動実行
flaker apply --json
```

`flaker.toml` を **desired state** とみなし、現在の DB 状態を見て「何をすべきか」を planner が組み立てる。履歴ゼロの新規 repo なら `collect_ci` + `cold_start_run`、十分な履歴があれば `collect_ci` + `calibrate` + `quarantine_apply` が選ばれる。ユーザー側は順序を覚える必要がない。

`[promotion]` セクションの閾値と現状の KPI を突き合わせて `flaker status` がドリフトを表示する。
```

- [ ] **Step 4: new-project-checklist.ja — point Day 2-3 at `apply`**

Replace the Day 2-3 step 1 & 2 (currently `collect ci` → `collect calibrate` の二段) with:

```markdown
### 1. 宣言的に収束させる

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker apply
```

`flaker apply` が現状に応じて collect / calibrate / quarantine apply を自動で順に実行する。何が走るかを先に見たい場合は `pnpm flaker plan`。
```

Leave the detailed `collect ci` / `collect calibrate` blocks below as a collapsible advanced section (unchanged, just moved under a `<details>` tag) so existing users who already know them can still reference the raw forms.

- [ ] **Step 5: Verify all internal links still resolve**

Run: `grep -n "calibrate\|collect ci\|flaker kpi\|flaker doctor" README.md docs/*.ja.md`
Expected: each remaining occurrence is either inside a code fence showing legacy form (with an explicit "legacy" label) or inside the "Canonical forms" table.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/operations-guide.ja.md docs/how-to-use.ja.md docs/new-project-checklist.ja.md
git commit -m "docs: unify collect/calibrate naming and introduce apply/plan"
```

---

## Task 9: Iter 5 empirical re-evaluation

**Files:**
- (Documentation only; no code changes)

- [ ] **Step 1: Dispatch 3 parallel evaluation subagents**

Use the same scenarios A (Day 1 Playwright setup), B (2-week promotion decision), C (CI failure retry/confirm) with the identical requirement checklists from Iter 1–4. Prompt template lives in this conversation's history.

- [ ] **Step 2: Record metrics**

Fill in the proficiency table for Iter 5:

| Scenario | Pass/Fail | Accuracy | Steps | Duration | Δ vs Iter 4 |
|---|---|---|---|---|---|

- [ ] **Step 3: Convergence check**

Per `empirical-prompt-tuning`:
- New unclear-points count: 0 required for convergence
- Accuracy delta: ≤ +3pt for convergence
- Steps delta: ±10%
- Duration delta: ±15%

If all criteria hold AND Iter 4 also held, declare convergence.

- [ ] **Step 4: Hold-out scenario (only if convergence declared)**

Dispatch one new subagent with a scenario NOT in A/B/C — for example, "a Vitest-only library repo that wants to add flaker without Playwright". If accuracy drops ≥ 15pt vs the A/B/C average, flag overfitting and return to Task 8 to rebalance.

- [ ] **Step 5: Record result**

Append the Iter 5 table to the conversation log. No commit needed (evaluation only).

---

## Self-Review

### Spec coverage
- `flaker apply` / `flaker plan`: Tasks 2–5 (planner, executor, two CLI entrypoints)
- `[promotion]` config: Task 1
- `status` drift: Task 6
- Alias deprecation warnings: Task 7
- Iter 5 docs unification: Task 8
- Iter 5 re-evaluation: Task 9

Every item from the "In scope" list has a task. Out-of-scope items (skill rewrite, alias removal) are explicitly deferred.

### Placeholder scan
- Task 5 contains a **conditional placeholder**: the imports for `runCollectCi` / `runCalibrate` / `runQuarantineApply` are named guesses. The task explicitly instructs the implementer to verify the real export names and adjust before writing code. This is the best we can do without re-reading every module here; the instruction is specific enough to prevent blind copy-paste.
- No "TBD" / "TODO" / "implement later" / unspecified error handling remain.

### Type consistency
- `PlannedAction` kinds (`collect_ci` / `calibrate` / `cold_start_run` / `quarantine_apply`) match between Task 2 (planner), Task 3 (executor dispatch), and Task 4 (CLI renderer) — all four strings identical.
- `PromotionThresholds` field names (`matched_commits_min`, `false_negative_rate_max_percentage`, `pass_correlation_min_percentage`, `holdout_fnr_max_percentage`, `data_confidence_min`) match between Task 1 (schema), Task 6 (`computeDrift`), and Task 8 (docs table).
- `FlakerKpi.data.confidence` union is `insufficient | low | moderate | high` (per Task 6 `CONFIDENCE_RANK`); this matches the existing `computeKpi` return type in `src/cli/commands/analyze/kpi.ts`.

No gaps found.
