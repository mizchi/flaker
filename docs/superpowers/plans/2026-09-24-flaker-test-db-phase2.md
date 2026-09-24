# flaker Test-DB Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of `docs/superpowers/specs/2026-09-24-flaker-test-db-design.md`, additive only. It adds the nine `flaker_v1` public datasets with JSON Schemas, `flaker export`, `flaker import --adapter selector-record|jev`, `flaker calibrate --selector` for the jev gate, and the `jev-context` projection.

**Architecture:** The storage tables stay internal. They gain a few additive columns and tables (`test_results.title_path`, `selector_runs`, `selector_run_tests`, `gate_calibrations`, and two small settings tables that hold the config values the views need). `flaker_v1` is a DuckDB schema of views over those tables, created on every `DuckDBStore.initialize()`, so an external reader of the `.duckdb` file sees the same rows the CLI does. Every public shape (dataset rows, `selector-record` v1, `jev-context` v1) is a TypeScript type plus a JSON Schema object in `src/cli/contracts/`. The decision logic lives in pure functions: test-key matching, calibration adoption, Wilson bound and projection building. The gate itself (score → selected) is never reimplemented. flaker calls jev-test-filter's `./gate` export, which rolldown bundles into `dist/cli/main.js`.

**Tech Stack:** TypeScript (Node 24, ESM, `module: Node16`), commander 14, DuckDB via the `duckdb` npm binding, vitest 4, rolldown, and `ajv` (new devDependency, tests only). Also `jev-test-filter` (new devDependency, bundled; needs 0.1.3). No MoonBit changes: `test_key` is the existing `test_results.test_id`, computed at insert time by `resolveTestIdentity` (MoonBit `create_stable_test_id`, TS fallback).

**Release:** additive minor, `0.14.0`, after sub-phase 2c merges. Each sub-phase (2a, 2b, 2c) is its own PR that leaves `main` releasable. Cut the release with the `flaker-manual-release` skill, not in this plan.

---

## Open questions for the owner (decide before 2c)

1. **Shape of the calibrate command.** Today `flaker calibrate` recommends `[sampling]` and writes it to `flaker.toml`. This plan adds `flaker calibrate --selector [name]` for the jev gate and leaves bare `calibrate` unchanged, because phase 2 is additive. The alternative is to make bare `calibrate` switch to the selector path whenever `[selector]` exists. That is also technically additive, but it silently changes what an existing command does once one config line is added. **Decided (2026-09-24): explicit flag.** Phase 3 can flip the default.
2. **Loosening thresholds are much stricter than they look.** With every real failure caught (p̂ = 1), the Wilson 95% lower bound is n / (n + 3.8415). `recall_target = 0.98` therefore needs **n ≥ 189 real failures** (0.9801 at 189, 0.9800 is not reached at 188). `min_failures = 20` never binds. For comparison, 20 failures give 0.839 and 50 give 0.929. **Decided (2026-09-24): default `recall_target = 0.90`** (reached at n ≥ 35 real failures), `min_failures = 20`.
3. **`flaker query` default search path.** The spec says `query` defaults to `flaker_v1` and needs `--internal` for storage tables. That breaks every existing `flaker query "SELECT … FROM test_results"`, so it is not additive. **Decided (2026-09-24): `query` stays as it is;** the views are reachable as `flaker_v1.<dataset>`, and the switch moves to phase 3 with the migration guide.

## Decisions this plan locks in (no owner input needed)

| Topic | Decision | Why |
|---|---|---|
| jev gate dependency | Add `jev-test-filter@^0.1.3` as a **devDependency**. Import it only through `jev-test-filter/gate` (runtime) and `jev-test-filter/types` (`testId` at runtime, the rest type-only). rolldown bundles it into `dist/cli/main.js`, so the published flaker has **no runtime dependency** on jev and does not pull in `@ast-grep/napi`. A contract test asserts that flaker's replay equals jev's own `replay()` on fixture records. | Keeps the gate logic in one place, as the spec requires. A port would need a sync test anyway and would drift the day jev changes a rule. Bundling `./gate` costs about 3 KB of pure JS. Importing jev's main entry (`"."`) instead would drag in `@ast-grep/napi`, so `src/` never imports `"jev-test-filter"` bare. Only tests do. |
| jev release needed | `jev-test-filter` **0.1.3** (spec phase 1, released as a patch). It must export from `./gate`: `gate(tests, answers, touched, opts, quarantined)`, `decide`, `resolveGate`, `gateOptions`, `DEFAULT_CUTOFF`, `DEFAULT_UNSURE_BELOW`, `DEFAULT_UNSURE_MARGIN`. From `./types` it must export: `testId`, `RunRecord`, `RunRecordV2`, `RecordGate`, `JevContext`, `Reason` including `"quarantined"`. All of this is merged on jev `main` (955bdf4) and released as 0.1.3. 2a does not need it. 2b and 2c are blocked on it. | npm 0.1.2's `./gate` has no `quarantined` parameter and no `resolveGate`. |
| Where contracts live | `src/cli/contracts/*.ts`, not `src/contracts/`. | `src/contracts/` is the MoonBit contracts package (`types.mbt`, `moon.pkg`) and is outside the npm `files` list. The published TS contracts already live under `src/cli/…` (`src/cli/reporting/*-contract.ts`, exposed via `package.json` `exports` and `tsconfig.reporting.json`). Each schema is a TS object, so it ships in the bundle and needs no copy step. |
| `title_path` | New column `test_results.title_path JSON`, filled by the vitest adapter (`[...ancestorTitles, title]`) and the playwright adapter (describe titles + spec title). The `tests` view falls back to `[test_name]` for rows that predate it. | Selectors key tests by `file` + `title_path`. `test_name` alone loses the structure: vitest stores `fullName` joined with spaces, and playwright stores only the leaf title. |
| Matching selector tests to `test_key` | A pure matcher runs in tiers. A tier wins only if it yields exactly one candidate. (1) same file (or `runner_file`) + project + equal `title_path`; (2) `test_name == title_path.join(" ")` (legacy vitest rows); (3) `test_name == last(title_path)` and `task_id == title_path[-2]` (legacy playwright rows). Anything ambiguous or unmatched gets `test_key = NULL`. Keys resolve at import and again before calibrate and export, so a CI run imported later still matches. | Stable IDs cannot be recomputed from `file` + `title_path`, because adapters spell `suite`/`test_name`/`task_id` differently. |
| `runs.is_full` | `[workflow_lanes]` values may be a string (as today) or `{ lane = "…", full = true|false }`. A lane with `full` set decides. Otherwise a run is full when its distinct test count is ≥ 95% of the distinct tests seen by the **same `workflow_name`** in the flaky window up to that run. | The spec says "full = true on a lane", and today's `[workflow_lanes]` maps workflow → lane string. The table form is additive. Scoping by workflow keeps a Playwright workflow from making every Vitest run look partial. |
| `flaky.is_flaky` | `flaky_rate ≥ [flaky].detection_threshold_ratio` **and** an intermittency signal in the window: a retry that passed, a `flaky` status, or both pass and fail on the same commit. | Ground truth is "failed in a full run − flaky". If plain failure rate counted as flakiness, a real regression that failed twice would mark itself flaky and hide its own miss. |
| Config values the views need | Internal tables `flaker_dataset_config` (single row) and `flaker_lane_config`. Commands that read datasets sync them from `flaker.toml` first (`openDatasetStore`). DDL inserts defaults. | Views cannot take parameters. Baking literals into `CREATE VIEW` would make an external reader see whatever the last command happened to write, with no way to inspect it. |
| `selector_verdicts` extra columns | `file`, `title_path`, `project`, `created_at` in addition to the spec's columns. `test_key` is nullable (unmatched). | v1 allows column additions. Unmatched verdicts would otherwise be invisible, and `--since` needs a time column. |
| `misses` | A view: verdicts with `selected = false` whose test failed in a full run on `head_sha`, minus flaky and quarantined. Calibration reuses the same internal `selector_ground_truth` view. | Always consistent with the data, and computed once for both the dataset and calibrate. |
| Hints | `failed_with` holds `co_failures` rows with `co_failures ≥ 2`, ordered by strength desc, co_failures desc, file asc, top 5. Tests that are flaky or quarantined get no hints. Tests are ranked by `missed` desc, then best strength, and capped at `[selector].max_hinted_tests` (default 200). | One co-failure on a multi-file commit cannot tell the file apart from its siblings. The caps are the spec's. |
| Selector name | Rows use `selector = "jev"`, the same as `[selector].type`. | One spelling across the config and the data. |

---

## File map

**2a — datasets + export**
- Modify: `src/cli/adapters/types.ts` (`titlePath`), `src/cli/adapters/vitest.ts`, `src/cli/adapters/playwright.ts`, `src/cli/storage/types.ts` (`TestResult.titlePath`), `src/cli/storage/test-result-mapper.ts`, `src/cli/storage/schema.ts` (new column + internal tables), `src/cli/storage/duckdb.ts` (insert `title_path`, create views, `copySelectToParquet`), `src/cli/config.ts` (`workflow_lanes` table form, `normalizeWorkflowLanes`), `src/cli/commands/collect/ci.ts:468`, `src/cli/categories/analyze.ts` (share the SQL guard), `src/cli/main.ts` (register `export`, help), `tests/cli/surface-reduction.test.ts`, `tests/cli/help-primary-shape.test.ts`, `package.json`, `tsconfig.reporting.json`, `CHANGELOG.md`, `docs/how-to-use.md`, `docs/how-to-use.ja.md`.
- Create: `src/cli/datasets/{views,config-sync,open,registry,serialize,read,query,format}.ts`, `src/cli/commands/analyze/sql-guard.ts`, `src/cli/contracts/{json-schema,flaker-v1-datasets}.ts`, `src/cli/commands/export/dataset.ts`, `src/cli/categories/export.ts`, `tests/datasets/{helpers,core-views,history-views,selector-views,export}.test.ts` (helpers is `helpers.ts`), `tests/contracts/flaker-v1-datasets.test.ts`, `tests/contracts/ajv.ts`, `tests/cli/export-cli.test.ts`, `tests/cli/workflow-lanes-config.test.ts`, `tests/fixtures/vitest-init-report.json`.

**2b — selector records**
- Create: `src/cli/contracts/{canonical-json,selector-record-v1}.ts`, `src/cli/selector/{jev-record,store}.ts`, `src/cli/datasets/test-match.ts`, `src/cli/commands/import/selector.ts`, `tests/fixtures/jev/{record-v1,record-v2}.json`, `tests/fixtures/selector-record/valid.json`, `tests/contracts/{selector-record-v1,jev-record}.test.ts`, `tests/datasets/test-match.test.ts`, `tests/selector/store.test.ts`, `tests/commands/import-selector.test.ts`, `tests/cli/import-selector-cli.test.ts`, `tests/package/jev-bundled.test.ts`.
- Modify: `package.json` (devDependency), `src/cli/categories/import.ts`, docs, CHANGELOG.

**2c — calibrate + projection**
- Create: `src/cli/selector/{wilson,replay,calibrate-core,ground-truth}.ts`, `src/cli/commands/calibrate/selector.ts`, `src/cli/contracts/{jev-context-v1,jev-compat}.ts`, `src/cli/projections/{jev-context,index}.ts`, `tests/selector/{wilson,replay,calibrate-core,ground-truth}.test.ts`, `tests/commands/calibrate-selector.test.ts`, `tests/projections/jev-context.test.ts`, `tests/integration-test-db.test.ts`.
- Modify: `src/cli/config.ts` (`[selector]`), `src/cli/categories/calibrate.ts`, `src/cli/categories/export.ts`, `tests/cli/calibrate-cli.test.ts`, `tests/cli/export-cli.test.ts`, docs, CHANGELOG.

Conventions used below:
- Unit and storage tests import from `src/` and use `new DuckDBStore(":memory:")`. CLI tests spawn `dist/cli/main.js` and need `pnpm build` first (it runs `moon build --target js --release`, so `moon` must be on the PATH).
- Run one file with `pnpm vitest run <path>`. Run everything with `pnpm test`, then `pnpm typecheck`.
- The DuckDB binding returns `BIGINT` as `bigint`, `JSON` as `string` and `TIMESTAMP` as `Date` (checked against the repo's `duckdb` build: `now() AT TIME ZONE 'UTC'` and `to_days()` both work). Views cast counts to `INTEGER`, and the dataset serializer turns `bigint` → number, `Date` → ISO string and JSON strings → values.
- After every `Write` of a `.ts` file, run `grep -nP '\x00' <file>`. A known tool bug can turn spaces in template literals into NUL bytes. The command must print nothing.

---

# Sub-phase 2a — datasets and `flaker export`

Ships the nine views, including the three selector views over tables that stay empty until 2b. It also ships their schemas and `flaker export <dataset>`. No jev dependency.

### Task A1: Worktree and baseline

**Files:** none

- [ ] **Step 1: Create the worktree**

```bash
git -C /Users/mz/ghq/github.com/mizchi/flaker worktree add ../flaker-test-db-2a -b feat/test-db-2a main
cd ../flaker-test-db-2a
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
Expected: build succeeds, all tests pass, typecheck clean. If anything fails on a clean `main`, stop and report. Do not start on a red baseline.

### Task A2: Capture `title_path` from adapters into storage

**Files:**
- Modify: `src/cli/adapters/types.ts`, `src/cli/adapters/vitest.ts`, `src/cli/adapters/playwright.ts`, `src/cli/storage/types.ts`, `src/cli/storage/test-result-mapper.ts`, `src/cli/storage/schema.ts`, `src/cli/storage/duckdb.ts`
- Test: `tests/adapters/vitest.test.ts`, `tests/adapters/playwright.test.ts`, `tests/storage/duckdb.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/adapters/vitest.test.ts` inside the top-level `describe`:

```ts
  it("keeps the title path: ancestor titles, then the test's own title", () => {
    const input = JSON.stringify({
      testResults: [{
        name: "tests/a.test.ts",
        assertionResults: [{
          ancestorTitles: ["outer", "inner"],
          fullName: "outer inner works",
          status: "passed",
          title: "works",
          duration: 1,
          failureMessages: [],
        }],
      }],
    });
    const [result] = vitestAdapter.parse(input);
    expect(result.titlePath).toEqual(["outer", "inner", "works"]);
    expect(result.testName).toBe("outer inner works");
  });
```

Append to `tests/adapters/playwright.test.ts` inside the top-level `describe`:

```ts
  it("keeps the describe titles and the spec title as the title path, without the file suite", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const form = results.find((r) => r.testName === "should display form");
    expect(form?.titlePath).toEqual(["login page", "should display form"]);
    expect(form?.suite).toBe("tests/login.spec.ts");
  });
```

Append to `tests/storage/duckdb.test.ts` (inside its top-level `describe`, which already creates `store` in `beforeEach`; if it does not, create one with `new DuckDBStore(":memory:")` and `await store.initialize()`):

```ts
  it("stores title_path as JSON", async () => {
    await store.insertWorkflowRun({
      id: 901, repo: "o/r", branch: "main", commitSha: "tp1", event: "push",
      status: "completed", createdAt: new Date(), durationMs: 1,
    });
    await store.insertTestResults([{
      workflowRunId: 901, suite: "tests/a.test.ts", testName: "A works",
      titlePath: ["A", "works"], status: "passed", durationMs: 1, retryCount: 0,
      errorMessage: null, commitSha: "tp1", variant: null, createdAt: new Date(),
    }]);
    const [row] = await store.raw<{ title_path: string | null }>(
      `SELECT title_path FROM test_results WHERE workflow_run_id = 901`,
    );
    expect(JSON.parse(row.title_path!)).toEqual(["A", "works"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/adapters/vitest.test.ts tests/adapters/playwright.test.ts tests/storage/duckdb.test.ts`
Expected: the three new tests FAIL (`titlePath` undefined; `title_path` column missing).

- [ ] **Step 3: Implement**

`src/cli/adapters/types.ts`, in `TestCaseResult` after `testName: string;`:

```ts
  /**
   * The enclosing suites outermost first, then the test's own title. Selectors
   * (jev-test-filter) name a test by `file` + this path. Null when the report
   * format does not carry the structure (junit, tap, …).
   */
  titlePath?: string[] | null;
```

`src/cli/storage/types.ts`, in `TestResult` after `testName: string;`:

```ts
  titlePath?: string[] | null;
```

`src/cli/storage/test-result-mapper.ts`, in the returned object after `testName: testCase.testName,`:

```ts
    titlePath: testCase.titlePath ?? null,
```

`src/cli/adapters/vitest.ts`, in the pushed object after `testName: test.fullName,`:

```ts
          titlePath: [...(test.ancestorTitles ?? []), test.title],
```

`src/cli/adapters/playwright.ts`. Give `walkSuites` a describe path. Replace the signature:

```ts
function walkSuites(
  suite: PlaywrightSuite,
  currentFile: string | null,
  currentTaskId: string | null,
  out: TestCaseResult[],
  describePath: string[],
): void {
```

In the `resolveTestIdentity({ … })` object, after `testName: spec.title,`:

```ts
          titlePath: [...describePath, spec.title],
```

Replace the recursive call:

```ts
  if (suite.suites) {
    for (const child of suite.suites) {
      walkSuites(child, nextFile, child.title, out, [...describePath, child.title]);
    }
  }
```

Replace the top-level call in `playwrightAdapter.parse`. Top-level suites are file suites, so their title is not part of the path:

```ts
      walkSuites(suite, suite.file ?? null, suite.title, results, []);
```

`src/cli/storage/schema.ts`, append inside `SCHEMA_DDL` after the other `ALTER TABLE test_results …` lines:

```sql
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS title_path JSON;
```

`src/cli/storage/duckdb.ts`, replace `insertTestResults` with:

```ts
  async insertTestResults(results: TestResult[]): Promise<void> {
    for (const r of results) {
      const resolved = resolveTestIdentity(r);
      await this.run(
        `INSERT INTO test_results (id, workflow_run_id, test_id, task_id, suite, test_name, filter_text, status, duration_ms, retry_count, error_message, failure_location, stdout_text, stderr_text, artifact_paths, artifacts, commit_sha, variant, quarantine, created_at, title_path)
         VALUES (nextval('test_results_id_seq'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resolved.workflowRunId,
          resolved.testId,
          resolved.taskId,
          resolved.suite,
          resolved.testName,
          resolved.filter,
          resolved.status,
          resolved.durationMs,
          resolved.retryCount,
          resolved.errorMessage,
          resolved.failureLocation ? JSON.stringify(resolved.failureLocation) : null,
          resolved.stdout ?? null,
          resolved.stderr ?? null,
          resolved.artifactPaths ? JSON.stringify(resolved.artifactPaths) : null,
          resolved.artifacts ? JSON.stringify(resolved.artifacts) : null,
          resolved.commitSha,
          resolved.variant ? JSON.stringify(resolved.variant) : null,
          resolved.quarantine ? JSON.stringify(resolved.quarantine) : null,
          resolved.createdAt,
          resolved.titlePath ? JSON.stringify(resolved.titlePath) : null,
        ]
      );
    }
  }
```

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `pnpm vitest run tests/adapters tests/storage` → PASS. Then `pnpm test` → PASS. If an existing test uses `toEqual` on a whole parsed result, add `titlePath` to its expected object rather than weakening the assertion. `importFromParquetDir` uses `INSERT … BY NAME`, so older parquet files without the column still load.

- [ ] **Step 5: Commit**

```bash
git add src/cli/adapters src/cli/storage tests/adapters tests/storage
git commit -m "feat: keep each test's title path from vitest and playwright reports"
```

### Task A3: `[workflow_lanes]` table form with `full`

**Files:**
- Modify: `src/cli/config.ts`, `src/cli/commands/collect/ci.ts:468`
- Test: `tests/cli/workflow-lanes-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/workflow-lanes-config.test.ts
import { describe, expect, it } from "vitest";
import { normalizeWorkflowLanes } from "../../src/cli/config.js";
import { FlakerUsageError } from "../../src/cli/errors.js";

describe("normalizeWorkflowLanes", () => {
  it("keeps the string form as it is", () => {
    expect(normalizeWorkflowLanes({ "ci.yml": "sampled" })).toEqual({
      lanes: { "ci.yml": "sampled" },
      fullByLane: {},
    });
  });

  it("reads { lane, full } and records full per lane", () => {
    expect(normalizeWorkflowLanes({
      "nightly.yml": { lane: "full-batch", full: true },
      "pr.yml": { lane: "sampled", full: false },
      "e2e.yml": { lane: "e2e" },
    })).toEqual({
      lanes: { "nightly.yml": "full-batch", "pr.yml": "sampled", "e2e.yml": "e2e" },
      fullByLane: { "full-batch": true, sampled: false },
    });
  });

  it("is empty for a missing section", () => {
    expect(normalizeWorkflowLanes(undefined)).toEqual({ lanes: {}, fullByLane: {} });
  });

  it("rejects a table without a lane, a non-boolean full, and conflicting full values", () => {
    expect(() => normalizeWorkflowLanes({ x: { full: true } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({ x: { lane: "a", full: "yes" } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({
      x: { lane: "a", full: true },
      y: { lane: "a", full: false },
    })).toThrow(/conflicting full/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/cli/workflow-lanes-config.test.ts`
Expected: FAIL, `normalizeWorkflowLanes` is not exported.

- [ ] **Step 3: Implement**

In `src/cli/config.ts`, replace the `workflow_lanes` field type in `FlakerConfig`:

```ts
  /**
   * Optional GitHub-Actions workflow-name → lane mapping, applied at collect/import
   * time. A value is either the lane name, or `{ lane = "<name>", full = true|false }`
   * to also say whether runs in that lane execute the whole suite
   * (`flaker_v1.runs.is_full`). A lane without `full` is judged by result count.
   */
  workflow_lanes?: Record<string, WorkflowLaneEntry>;
```

Add near the top-level exports:

```ts
export type WorkflowLaneEntry = string | { lane: string; full?: boolean };

export interface NormalizedWorkflowLanes {
  /** workflow name or path → lane */
  lanes: Record<string, string>;
  /** lane → whether its runs are full runs; absent when not configured */
  fullByLane: Record<string, boolean>;
}

export function normalizeWorkflowLanes(
  raw: Record<string, WorkflowLaneEntry> | undefined,
): NormalizedWorkflowLanes {
  const lanes: Record<string, string> = {};
  const fullByLane: Record<string, boolean> = {};
  for (const [workflow, entry] of Object.entries(raw ?? {})) {
    if (typeof entry === "string") {
      lanes[workflow] = entry;
      continue;
    }
    if (!isTable(entry) || typeof entry.lane !== "string" || entry.lane === "") {
      throw new FlakerUsageError(
        `[workflow_lanes] "${workflow}" must be a lane name or { lane = "<name>", full = true|false }`,
      );
    }
    lanes[workflow] = entry.lane;
    if (entry.full === undefined) continue;
    if (typeof entry.full !== "boolean") {
      throw new FlakerUsageError(`[workflow_lanes] "${workflow}".full must be true or false`);
    }
    const previous = fullByLane[entry.lane];
    if (previous !== undefined && previous !== entry.full) {
      throw new FlakerUsageError(`[workflow_lanes] lane "${entry.lane}" has conflicting full values`);
    }
    fullByLane[entry.lane] = entry.full;
  }
  return { lanes, fullByLane };
}
```

(`isTable` is already defined in `config.ts`. `normalizeWorkflowLanes` must be declared after it or rely on function hoisting. Both are `function` declarations, so either order works.)

In `src/cli/commands/collect/ci.ts` add `normalizeWorkflowLanes` to the existing import from `../../config.js` (or add the import), and replace line 468:

```ts
    workflowLanes: normalizeWorkflowLanes(config.workflow_lanes).lanes,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/cli/workflow-lanes-config.test.ts tests/commands/collect.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/commands/collect/ci.ts tests/cli/workflow-lanes-config.test.ts
git commit -m "feat: let a [workflow_lanes] entry say whether its lane runs the full suite"
```

### Task A4: Internal tables and dataset settings sync

**Files:**
- Modify: `src/cli/storage/schema.ts`
- Create: `src/cli/datasets/config-sync.ts`, `src/cli/datasets/open.ts`
- Test: `tests/datasets/config-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/datasets/config-sync.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  datasetSettingsFromConfig,
  syncDatasetSettings,
} from "../../src/cli/datasets/config-sync.js";
import type { FlakerConfig } from "../../src/cli/config.js";

describe("dataset settings", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });
  afterEach(async () => {
    await store.close();
  });

  it("has defaults before any sync", async () => {
    const [row] = await store.raw<Record<string, number>>(`SELECT * FROM flaker_dataset_config`);
    expect(row).toMatchObject({
      id: 1, flaky_window_days: 14, flaky_threshold_ratio: 0.02,
      co_failure_window_days: 90, full_run_ratio: 0.95,
    });
  });

  it("derives settings from flaker.toml values", () => {
    const config = {
      flaky: { window_days: 7, detection_threshold_ratio: 0.1 },
      sampling: { strategy: "hybrid", co_failure_window_days: 30 },
      workflow_lanes: { "nightly.yml": { lane: "full-batch", full: true } },
    } as unknown as FlakerConfig;
    expect(datasetSettingsFromConfig(config)).toEqual({
      flakyWindowDays: 7,
      flakyThresholdRatio: 0.1,
      coFailureWindowDays: 30,
      fullRunRatio: 0.95,
      fullByLane: { "full-batch": true },
    });
  });

  it("replaces the single settings row and the lane table", async () => {
    const base = { flakyWindowDays: 7, flakyThresholdRatio: 0.1, coFailureWindowDays: 30, fullRunRatio: 0.95 };
    await syncDatasetSettings(store, { ...base, fullByLane: { a: true, b: false } });
    await syncDatasetSettings(store, { ...base, fullByLane: { c: true } });
    const cfg = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_dataset_config`);
    expect(cfg[0].n).toBe(1);
    const lanes = await store.raw<{ lane: string; is_full: boolean }>(
      `SELECT lane, is_full FROM flaker_lane_config ORDER BY lane`,
    );
    expect(lanes).toEqual([{ lane: "c", is_full: true }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/config-sync.test.ts`
Expected: FAIL, the table `flaker_dataset_config` does not exist and the module is missing.

- [ ] **Step 3: Implement**

Append to `SCHEMA_DDL` in `src/cli/storage/schema.ts` (end of the template string):

```sql
CREATE TABLE IF NOT EXISTS flaker_dataset_config (
  id                      INTEGER PRIMARY KEY,
  flaky_window_days       INTEGER NOT NULL,
  flaky_threshold_ratio   DOUBLE NOT NULL,
  co_failure_window_days  INTEGER NOT NULL,
  full_run_ratio          DOUBLE NOT NULL
);
INSERT INTO flaker_dataset_config VALUES (1, 14, 0.02, 90, 0.95) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS flaker_lane_config (
  lane     VARCHAR PRIMARY KEY,
  is_full  BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS selector_runs (
  selector_run_id   VARCHAR PRIMARY KEY,
  selector          VARCHAR NOT NULL,
  selector_version  VARCHAR,
  head_sha          VARCHAR,
  base_sha          VARCHAR,
  context_digest    VARCHAR,
  source            VARCHAR NOT NULL DEFAULT 'real',
  gate              JSON,
  created_at        TIMESTAMP NOT NULL,
  imported_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS selector_run_tests (
  selector_run_id  VARCHAR NOT NULL,
  ordinal          INTEGER NOT NULL,
  test_key         VARCHAR,
  file             VARCHAR NOT NULL,
  title_path       JSON NOT NULL,
  project          VARCHAR,
  runner_file      VARCHAR,
  score            DOUBLE,
  confidence       DOUBLE,
  reason           VARCHAR NOT NULL,
  selected         BOOLEAN NOT NULL,
  PRIMARY KEY (selector_run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS gate_calibrations (
  selector       VARCHAR NOT NULL,
  calibrated_at  TIMESTAMP NOT NULL,
  cutoff         DOUBLE NOT NULL,
  unsure_below   DOUBLE NOT NULL,
  unsure_margin  DOUBLE NOT NULL,
  records        INTEGER NOT NULL,
  real_failures  INTEGER NOT NULL,
  recall_lb95    DOUBLE,
  decision       VARCHAR NOT NULL,
  rationale      VARCHAR NOT NULL,
  PRIMARY KEY (selector, calibrated_at)
);
```

```ts
// src/cli/datasets/config-sync.ts
import type { FlakerConfig } from "../config.js";
import { normalizeWorkflowLanes } from "../config.js";
import type { MetricStore } from "../storage/types.js";

/** The flaker.toml values the flaker_v1 views read, materialized in the database. */
export interface DatasetSettings {
  flakyWindowDays: number;
  flakyThresholdRatio: number;
  coFailureWindowDays: number;
  /** A run with this share of its workflow's recent tests counts as full. */
  fullRunRatio: number;
  fullByLane: Record<string, boolean>;
}

export const FULL_RUN_RATIO = 0.95;
export const DEFAULT_CO_FAILURE_WINDOW_DAYS = 90;

export function datasetSettingsFromConfig(config: FlakerConfig): DatasetSettings {
  return {
    flakyWindowDays: config.flaky.window_days,
    flakyThresholdRatio: config.flaky.detection_threshold_ratio,
    coFailureWindowDays: config.sampling?.co_failure_window_days ?? DEFAULT_CO_FAILURE_WINDOW_DAYS,
    fullRunRatio: FULL_RUN_RATIO,
    fullByLane: normalizeWorkflowLanes(config.workflow_lanes).fullByLane,
  };
}

export async function syncDatasetSettings(store: MetricStore, s: DatasetSettings): Promise<void> {
  await store.raw(
    `INSERT OR REPLACE INTO flaker_dataset_config
       (id, flaky_window_days, flaky_threshold_ratio, co_failure_window_days, full_run_ratio)
     VALUES (1, ?, ?, ?, ?)`,
    [s.flakyWindowDays, s.flakyThresholdRatio, s.coFailureWindowDays, s.fullRunRatio],
  );
  await store.raw(`DELETE FROM flaker_lane_config`);
  for (const [lane, isFull] of Object.entries(s.fullByLane)) {
    await store.raw(`INSERT INTO flaker_lane_config (lane, is_full) VALUES (?, ?)`, [lane, isFull]);
  }
}
```

```ts
// src/cli/datasets/open.ts
import { resolve } from "node:path";
import type { FlakerConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { datasetSettingsFromConfig, syncDatasetSettings } from "./config-sync.js";

/** Open the store with the dataset settings synced from flaker.toml. Caller closes it. */
export async function openDatasetStore(cwd: string, config: FlakerConfig): Promise<DuckDBStore> {
  const store = new DuckDBStore(resolve(cwd, config.storage.path));
  await store.initialize();
  await syncDatasetSettings(store, datasetSettingsFromConfig(config));
  return store;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets/config-sync.test.ts` → PASS. Then `pnpm test` → PASS. If an existing test asserts the exact table list (`SHOW TABLES`), add the five new tables to its expectation.

- [ ] **Step 5: Commit**

```bash
git add src/cli/storage/schema.ts src/cli/datasets tests/datasets/config-sync.test.ts
git commit -m "feat: add storage for selector records, gate calibrations and dataset settings"
```

### Task A5: `flaker_v1.tests`, `runs`, `results`

**Files:**
- Create: `src/cli/datasets/views.ts`, `tests/datasets/helpers.ts`, `tests/datasets/core-views.test.ts`
- Modify: `src/cli/storage/duckdb.ts` (`initialize`)

- [ ] **Step 1: Write the test helpers and the failing test**

```ts
// tests/datasets/helpers.ts
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { syncDatasetSettings, type DatasetSettings } from "../../src/cli/datasets/config-sync.js";

export const DAY = 86_400_000;

export async function memoryStore(settings: Partial<DatasetSettings> = {}): Promise<DuckDBStore> {
  const store = new DuckDBStore(":memory:");
  await store.initialize();
  await syncDatasetSettings(store, {
    flakyWindowDays: 14,
    flakyThresholdRatio: 0.02,
    coFailureWindowDays: 90,
    fullRunRatio: 0.95,
    fullByLane: {},
    ...settings,
  });
  return store;
}

export interface SeedResult {
  suite: string;
  testName: string;
  status: string;
  retryCount?: number;
  titlePath?: string[];
  variant?: Record<string, string>;
}

export async function seedRun(store: DuckDBStore, run: {
  id: number;
  commitSha: string;
  daysAgo: number;
  workflowName?: string;
  lane?: string;
  source?: "ci" | "local";
  results: SeedResult[];
}): Promise<void> {
  const createdAt = new Date(Date.now() - run.daysAgo * DAY);
  await store.insertWorkflowRun({
    id: run.id, repo: "o/r", branch: "main", commitSha: run.commitSha, event: "push",
    source: run.source ?? "ci", status: "completed", createdAt, durationMs: 1,
    workflowName: run.workflowName ?? "ci", lane: run.lane ?? null,
  });
  await store.insertTestResults(run.results.map((r) => ({
    workflowRunId: run.id, suite: r.suite, testName: r.testName, status: r.status,
    durationMs: 10, retryCount: r.retryCount ?? 0, errorMessage: null,
    commitSha: run.commitSha, variant: r.variant ?? null, titlePath: r.titlePath ?? null, createdAt,
  })));
}

export async function keyFor(store: DuckDBStore, suite: string, testName: string): Promise<string> {
  const [row] = await store.raw<{ test_key: string }>(
    `SELECT test_key FROM flaker_v1.tests WHERE suite = ? AND test_name = ?`,
    [suite, testName],
  );
  if (!row) throw new Error(`no test ${suite} :: ${testName}`);
  return row.test_key;
}
```

```ts
// tests/datasets/core-views.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { memoryStore, seedRun } from "./helpers.js";

const ten = Array.from({ length: 10 }, (_, i) => ({
  suite: "tests/x.test.ts", testName: `t${i}`, status: "passed",
}));

describe("flaker_v1 core views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore({ fullByLane: { "full-batch": true, sampled: false } });
  });
  afterEach(async () => {
    await store.close();
  });

  it("tests: one row per test_key, file and title_path, falling back to [test_name]", async () => {
    await seedRun(store, { id: 1, commitSha: "a", daysAgo: 2, results: [
      { suite: "tests/a.test.ts", testName: "A works", titlePath: ["A", "works"], status: "passed" },
      { suite: "tests/b.test.ts", testName: "legacy name", status: "passed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "b", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "A works", titlePath: ["A", "works"], status: "failed" },
    ] });
    const rows = await store.raw<{ file: string; title_path: string; first_seen_at: Date; last_seen_at: Date }>(
      `SELECT file, title_path, first_seen_at, last_seen_at FROM flaker_v1.tests ORDER BY file`,
    );
    expect(rows.map((r) => [r.file, JSON.parse(r.title_path)])).toEqual([
      ["tests/a.test.ts", ["A", "works"]],
      ["tests/b.test.ts", ["legacy name"]],
    ]);
    expect(rows[0].first_seen_at.getTime()).toBeLessThan(rows[0].last_seen_at.getTime());
  });

  it("runs: is_full from the lane config, else >= 95% of the workflow's recent tests", async () => {
    await seedRun(store, { id: 1, commitSha: "full", daysAgo: 3, results: ten });
    await seedRun(store, { id: 2, commitSha: "part", daysAgo: 2, results: ten.slice(0, 3) });
    await seedRun(store, { id: 3, commitSha: "lane-full", daysAgo: 1, lane: "full-batch", results: ten.slice(0, 1) });
    await seedRun(store, { id: 4, commitSha: "lane-sampled", daysAgo: 1, lane: "sampled", results: ten });
    await seedRun(store, { id: 5, commitSha: "other-wf", daysAgo: 1, workflowName: "e2e", results: [
      { suite: "e2e/y.spec.ts", testName: "y", status: "passed" },
    ] });
    const rows = await store.raw<{ commit_sha: string; is_full: boolean }>(
      `SELECT commit_sha, is_full FROM flaker_v1.runs ORDER BY run_id`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.commit_sha, r.is_full]))).toEqual({
      full: true, part: false, "lane-full": true, "lane-sampled": false, "other-wf": true,
    });
  });

  it("runs: a run with no results is never full, and source follows the local-event rule", async () => {
    await store.insertWorkflowRun({
      id: 7, repo: "o/r", branch: "main", commitSha: "empty", event: "local-import",
      status: "completed", createdAt: new Date(), durationMs: 1,
    });
    const [row] = await store.raw<{ is_full: boolean; source: string }>(
      `SELECT is_full, source FROM flaker_v1.runs WHERE run_id = 7`,
    );
    expect(row).toEqual({ is_full: false, source: "local" });
  });

  it("results: one row per stored result keyed by test_key", async () => {
    await seedRun(store, { id: 1, commitSha: "a", daysAgo: 1, results: ten.slice(0, 2) });
    const rows = await store.raw<{ n: number; keyed: number }>(
      `SELECT COUNT(*)::INTEGER AS n, COUNT(test_key)::INTEGER AS keyed FROM flaker_v1.results`,
    );
    expect(rows[0]).toEqual({ n: 2, keyed: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/core-views.test.ts`
Expected: FAIL, `Catalog Error: Table with name tests does not exist` (schema `flaker_v1` missing).

- [ ] **Step 3: Implement**

```ts
// src/cli/datasets/views.ts
import { workflowRunSourceSql } from "../run-source.js";

/**
 * The public datasets: views in the DuckDB schema `flaker_v1`, over internal
 * storage tables. Within v1 only column additions are allowed. Every view's
 * columns must equal the properties of its JSON Schema in
 * `src/cli/contracts/flaker-v1-datasets.ts` (pinned by a contract test).
 *
 * Stored timestamps are naive UTC (written from JS Dates), so "now" is UTC too.
 */
export const NOW_UTC = "(now() AT TIME ZONE 'UTC')";

const CORE_VIEWS = `
CREATE SCHEMA IF NOT EXISTS flaker_v1;

CREATE OR REPLACE VIEW flaker_v1.tests AS
SELECT
  tr.test_id AS test_key,
  arg_max(tr.suite, tr.created_at) AS suite,
  arg_max(tr.test_name, tr.created_at) AS test_name,
  arg_max(COALESCE(tr.task_id, tr.suite), tr.created_at) AS task_id,
  arg_max(tr.variant, tr.created_at) AS variant,
  arg_max(tr.suite, tr.created_at) AS file,
  COALESCE(
    arg_max(tr.title_path, tr.created_at) FILTER (WHERE tr.title_path IS NOT NULL),
    to_json([arg_max(tr.test_name, tr.created_at)])
  ) AS title_path,
  MIN(tr.created_at) AS first_seen_at,
  MAX(tr.created_at) AS last_seen_at
FROM test_results tr
WHERE tr.test_id IS NOT NULL
GROUP BY tr.test_id;

CREATE OR REPLACE VIEW flaker_v1.runs AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
run_sizes AS (
  SELECT workflow_run_id, COUNT(DISTINCT test_id)::INTEGER AS n, MAX(created_at) AS at
  FROM test_results
  WHERE test_id IS NOT NULL
  GROUP BY workflow_run_id
)
SELECT
  wr.id AS run_id,
  CASE WHEN wr.source = 'mutation' THEN 'mutation' ELSE ${workflowRunSourceSql("wr")} END AS source,
  wr.workflow_name,
  wr.lane,
  wr.commit_sha,
  wr.branch,
  wr.event,
  CASE
    WHEN lc.is_full IS NOT NULL THEN lc.is_full
    WHEN COALESCE(rs.n, 0) = 0 THEN FALSE
    ELSE rs.n >= cfg.full_run_ratio * (
      SELECT COUNT(DISTINCT tr2.test_id)
      FROM test_results tr2
      JOIN workflow_runs wr2 ON wr2.id = tr2.workflow_run_id
      WHERE tr2.test_id IS NOT NULL
        AND wr2.workflow_name IS NOT DISTINCT FROM wr.workflow_name
        AND tr2.created_at <= rs.at
        AND tr2.created_at > rs.at - to_days(cfg.flaky_window_days)
    )
  END AS is_full,
  wr.created_at
FROM workflow_runs wr
CROSS JOIN cfg
LEFT JOIN run_sizes rs ON rs.workflow_run_id = wr.id
LEFT JOIN flaker_lane_config lc ON lc.lane = wr.lane;

CREATE OR REPLACE VIEW flaker_v1.results AS
SELECT
  tr.workflow_run_id AS run_id,
  tr.test_id AS test_key,
  tr.status,
  tr.retry_count,
  tr.duration_ms,
  tr.created_at
FROM test_results tr
WHERE tr.test_id IS NOT NULL;
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS].join("\n");
```

In `src/cli/storage/duckdb.ts` add `import { FLAKER_V1_VIEWS_SQL } from "../datasets/views.js";` and in `initialize()` replace `await this.exec(SCHEMA_DDL);` with:

```ts
    await this.exec(SCHEMA_DDL);
    await this.exec(FLAKER_V1_VIEWS_SQL);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets/core-views.test.ts` → PASS. `pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/datasets/views.ts src/cli/storage/duckdb.ts tests/datasets
git commit -m "feat: publish flaker_v1.tests, runs and results as views"
```

### Task A6: `flaker_v1.flaky`, `quarantine`, `co_failures`

**Files:**
- Modify: `src/cli/datasets/views.ts`
- Test: `tests/datasets/history-views.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/datasets/history-views.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { keyFor, memoryStore, seedRun } from "./helpers.js";

const S = "tests/h.test.ts";

describe("flaker_v1 history views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("flaky: needs a retry or a same-commit flip; a plain regression is not flaky", async () => {
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 5, results: [
      { suite: S, testName: "retry", status: "passed", retryCount: 1 },
      { suite: S, testName: "regression", status: "failed" },
      { suite: S, testName: "flip", status: "failed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "c1", daysAgo: 5, results: [
      { suite: S, testName: "flip", status: "passed" },
    ] });
    await seedRun(store, { id: 3, commitSha: "c2", daysAgo: 4, results: [
      { suite: S, testName: "retry", status: "passed" },
      { suite: S, testName: "regression", status: "failed" },
    ] });
    await seedRun(store, { id: 4, commitSha: "c0", daysAgo: 20, results: [
      { suite: S, testName: "old", status: "passed", retryCount: 1 },
    ] });
    const rows = await store.raw<{ test_name: string; runs: number; failures: number; flaky_rate: number; is_flaky: boolean; window_days: number }>(`
      SELECT t.test_name, f.runs, f.failures, f.flaky_rate, f.is_flaky, f.window_days
      FROM flaker_v1.flaky f JOIN flaker_v1.tests t USING (test_key)
      ORDER BY t.test_name`);
    expect(rows).toEqual([
      { test_name: "flip", runs: 2, failures: 1, flaky_rate: 0.5, is_flaky: true, window_days: 14 },
      { test_name: "regression", runs: 2, failures: 2, flaky_rate: 1, is_flaky: false, window_days: 14 },
      { test_name: "retry", runs: 2, failures: 1, flaky_rate: 0.5, is_flaky: true, window_days: 14 },
    ]);
  });

  it("quarantine: source is auto for plan-applied entries, manual otherwise", async () => {
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 1, results: [
      { suite: S, testName: "q1", status: "failed" },
      { suite: S, testName: "q2", status: "failed" },
    ] });
    await store.addQuarantine({ suite: S, testName: "q1" }, "manual");
    await store.addQuarantine({ suite: S, testName: "q2" }, "plan:flaky");
    const rows = await store.raw<{ test_key: string; source: string; since: Date | null }>(
      `SELECT test_key, source, since FROM flaker_v1.quarantine`,
    );
    const bySource = Object.fromEntries(rows.map((r) => [r.test_key, r.source]));
    expect(bySource[await keyFor(store, S, "q1")]).toBe("manual");
    expect(bySource[await keyFor(store, S, "q2")]).toBe("auto");
    expect(rows.every((r) => r.since instanceof Date)).toBe(true);
  });

  it("co_failures: per changed file and test, over distinct commits", async () => {
    for (const [i, sha, status] of [[1, "s1", "failed"], [2, "s2", "failed"], [3, "s3", "passed"]] as const) {
      await store.insertCommitChanges(sha, [{ filePath: "src/auth.ts", changeType: "modified", additions: 1, deletions: 0 }]);
      await seedRun(store, { id: i, commitSha: sha, daysAgo: 4 - i, results: [
        { suite: "tests/login.test.ts", testName: "login", status },
      ] });
    }
    const rows = await store.raw<Record<string, unknown>>(
      `SELECT changed_file, co_failures, changes, strength, window_days FROM flaker_v1.co_failures`,
    );
    expect(rows).toEqual([
      { changed_file: "src/auth.ts", co_failures: 2, changes: 3, strength: 0.6667, window_days: 90 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/history-views.test.ts`
Expected: FAIL, `flaker_v1.flaky` does not exist.

- [ ] **Step 3: Implement**

In `src/cli/datasets/views.ts` add the block and include it in the export:

```ts
const FAILURE_SQL = (alias: string) =>
  `(${alias}.status IN ('failed', 'flaky') OR (${alias}.retry_count > 0 AND ${alias}.status = 'passed'))`;

const HISTORY_VIEWS = `
CREATE OR REPLACE VIEW flaker_v1.flaky AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
recent AS (
  SELECT tr.test_id, tr.commit_sha, tr.status, tr.retry_count
  FROM test_results tr CROSS JOIN cfg
  WHERE tr.test_id IS NOT NULL
    AND tr.created_at > ${NOW_UTC} - to_days(cfg.flaky_window_days)
),
flips AS (
  SELECT test_id, COUNT(*) FILTER (WHERE statuses > 1)::INTEGER AS flip_commits
  FROM (
    SELECT test_id, commit_sha,
      COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) AS statuses
    FROM recent
    GROUP BY test_id, commit_sha
  )
  GROUP BY test_id
),
agg AS (
  SELECT
    r.test_id,
    COUNT(*)::INTEGER AS runs,
    COUNT(*) FILTER (WHERE ${FAILURE_SQL("r")})::INTEGER AS failures,
    COUNT(*) FILTER (WHERE r.status = 'flaky' OR (r.retry_count > 0 AND r.status = 'passed'))::INTEGER AS retried
  FROM recent r
  GROUP BY r.test_id
)
SELECT
  agg.test_id AS test_key,
  cfg.flaky_window_days AS window_days,
  agg.runs,
  agg.failures,
  ROUND(agg.failures * 1.0 / agg.runs, 4)::DOUBLE AS flaky_rate,
  (agg.failures * 1.0 / agg.runs >= cfg.flaky_threshold_ratio
    AND (agg.retried > 0 OR COALESCE(flips.flip_commits, 0) > 0)) AS is_flaky,
  ${NOW_UTC} AS computed_at
FROM agg
CROSS JOIN cfg
LEFT JOIN flips ON flips.test_id = agg.test_id;

CREATE OR REPLACE VIEW flaker_v1.quarantine AS
SELECT
  test_id AS test_key,
  reason,
  created_at AS since,
  CASE WHEN reason LIKE 'plan:%' THEN 'auto' ELSE 'manual' END AS source
FROM quarantined_test_identities;

CREATE OR REPLACE VIEW flaker_v1.co_failures AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1)
SELECT
  cc.file_path AS changed_file,
  tr.test_id AS test_key,
  COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")})::INTEGER AS co_failures,
  COUNT(DISTINCT cc.commit_sha)::INTEGER AS changes,
  ROUND(
    COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")}) * 1.0
      / COUNT(DISTINCT cc.commit_sha),
    4
  )::DOUBLE AS strength,
  cfg.co_failure_window_days AS window_days
FROM commit_changes cc
JOIN test_results tr ON tr.commit_sha = cc.commit_sha
CROSS JOIN cfg
WHERE tr.test_id IS NOT NULL
  AND tr.created_at > ${NOW_UTC} - to_days(cfg.co_failure_window_days)
GROUP BY cc.file_path, tr.test_id, cfg.co_failure_window_days
HAVING COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")}) > 0;
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS, HISTORY_VIEWS].join("\n");
```

(Delete the earlier one-element `FLAKER_V1_VIEWS_SQL` line. There is exactly one export.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/datasets/views.ts tests/datasets/history-views.test.ts
git commit -m "feat: publish flaker_v1.flaky, quarantine and co_failures as views"
```

### Task A7: `flaker_v1.selector_verdicts`, `misses`, `gate_calibration`

**Files:**
- Modify: `src/cli/datasets/views.ts`, `tests/datasets/helpers.ts`
- Test: `tests/datasets/selector-views.test.ts`

- [ ] **Step 1: Add a seeding helper and write the failing test**

Append to `tests/datasets/helpers.ts`:

```ts
export interface SeedVerdict {
  testKey: string | null;
  file: string;
  titlePath: string[];
  reason: string;
  selected: boolean;
  score?: number | null;
  confidence?: number | null;
}

/** Writes selector tables directly; 2b replaces this with insertSelectorRecord. */
export async function seedSelectorRun(store: DuckDBStore, run: {
  id: string;
  headSha: string | null;
  source?: "real" | "mutation";
  contextDigest?: string | null;
  tests: SeedVerdict[];
}): Promise<void> {
  await store.raw(
    `INSERT INTO selector_runs (selector_run_id, selector, selector_version, head_sha, base_sha, context_digest, source, gate, created_at)
     VALUES (?, 'jev', NULL, ?, NULL, ?, ?, NULL, ?)`,
    [run.id, run.headSha, run.contextDigest ?? null, run.source ?? "real", new Date()],
  );
  for (const [i, t] of run.tests.entries()) {
    await store.raw(
      `INSERT INTO selector_run_tests (selector_run_id, ordinal, test_key, file, title_path, project, runner_file, score, confidence, reason, selected)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      [run.id, i, t.testKey, t.file, JSON.stringify(t.titlePath), t.score ?? null, t.confidence ?? null, t.reason, t.selected],
    );
  }
}
```

```ts
// tests/datasets/selector-views.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "./helpers.js";

const S = "tests/m.test.ts";
const names = ["missed", "caught", "flaky", "quarantined", "passing"];

describe("flaker_v1 selector views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await store.insertCommitChanges("H", [
      { filePath: "src/b.ts", changeType: "modified", additions: 1, deletions: 0 },
      { filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 },
    ]);
    // The full run on H: four failures, one pass.
    await seedRun(store, { id: 10, commitSha: "H", daysAgo: 1, results: names.map((n) => ({
      suite: S, testName: n, status: n === "passing" ? "passed" : "failed",
    })) });
    // History that makes "flaky" flaky: a retried pass on another commit.
    await seedRun(store, { id: 9, commitSha: "G", daysAgo: 2, results: [
      { suite: S, testName: "flaky", status: "passed", retryCount: 1 },
    ] });
    await store.addQuarantine({ suite: S, testName: "quarantined" }, "manual");
  });
  afterEach(async () => {
    await store.close();
  });

  it("misses: unselected real failures in a full run on head_sha, minus flaky and quarantined", async () => {
    const k = async (n: string) => keyFor(store, S, n);
    await seedSelectorRun(store, { id: "sr1", headSha: "H", tests: [
      { testKey: await k("missed"), file: S, titlePath: ["missed"], reason: "below", selected: false, score: 0.4 },
      { testKey: await k("caught"), file: S, titlePath: ["caught"], reason: "scored", selected: true, score: 3 },
      { testKey: await k("flaky"), file: S, titlePath: ["flaky"], reason: "below", selected: false },
      { testKey: await k("quarantined"), file: S, titlePath: ["quarantined"], reason: "quarantined", selected: false },
      { testKey: await k("passing"), file: S, titlePath: ["passing"], reason: "below", selected: false },
      { testKey: null, file: S, titlePath: ["unknown"], reason: "below", selected: false },
    ] });
    const rows = await store.raw<{ test_key: string; head_sha: string; ci_run_id: bigint; reason: string; changed_files: string }>(
      `SELECT test_key, head_sha, ci_run_id, reason, changed_files FROM flaker_v1.misses`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].test_key).toBe(await k("missed"));
    expect(Number(rows[0].ci_run_id)).toBe(10);
    expect(rows[0].reason).toBe("below");
    expect(JSON.parse(rows[0].changed_files)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("misses: nothing for a head without a full run", async () => {
    await seedSelectorRun(store, { id: "sr2", headSha: "NOFULL", tests: [
      { testKey: await keyFor(store, S, "missed"), file: S, titlePath: ["missed"], reason: "below", selected: false },
    ] });
    const rows = await store.raw(`SELECT * FROM flaker_v1.misses WHERE head_sha = 'NOFULL'`);
    expect(rows).toEqual([]);
  });

  it("selector_verdicts and gate_calibration expose the stored rows", async () => {
    await seedSelectorRun(store, { id: "sr3", headSha: "H", tests: [
      { testKey: null, file: S, titlePath: ["x"], reason: "missing", selected: true },
    ] });
    await store.raw(
      `INSERT INTO gate_calibrations VALUES ('jev', ?, 1.5, 0.5, 1.0, 3, 2, 0.34, 'tighten', 'r')`,
      [new Date()],
    );
    const v = await store.raw<{ selector: string; reason: string; test_key: string | null }>(
      `SELECT selector, reason, test_key FROM flaker_v1.selector_verdicts WHERE selector_run_id = 'sr3'`,
    );
    expect(v).toEqual([{ selector: "jev", reason: "missing", test_key: null }]);
    const g = await store.raw<{ decision: string; cutoff: number }>(
      `SELECT decision, cutoff FROM flaker_v1.gate_calibration`,
    );
    expect(g).toEqual([{ decision: "tighten", cutoff: 1.5 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/selector-views.test.ts`
Expected: FAIL, `flaker_v1.misses` does not exist.

- [ ] **Step 3: Implement**

In `src/cli/datasets/views.ts`:

```ts
const SELECTOR_VIEWS = `
CREATE OR REPLACE VIEW flaker_v1.selector_verdicts AS
SELECT
  sr.selector_run_id,
  sr.selector,
  sr.selector_version,
  sr.head_sha,
  sr.base_sha,
  sr.context_digest,
  sr.source,
  st.test_key,
  st.file,
  st.title_path,
  st.project,
  st.score,
  st.confidence,
  st.reason,
  st.selected,
  sr.created_at
FROM selector_runs sr
JOIN selector_run_tests st ON st.selector_run_id = sr.selector_run_id;

CREATE OR REPLACE VIEW flaker_v1.gate_calibration AS
SELECT selector, calibrated_at, cutoff, unsure_below, unsure_margin,
  records, real_failures, recall_lb95, decision, rationale
FROM gate_calibrations;

-- Internal (not flaker_v1): failures in full runs that count as ground truth.
CREATE OR REPLACE VIEW selector_ground_truth AS
SELECT DISTINCT r.run_id AS ci_run_id, ru.commit_sha, r.test_key
FROM flaker_v1.results r
JOIN flaker_v1.runs ru ON ru.run_id = r.run_id
WHERE ru.is_full
  AND ru.source <> 'mutation'
  AND r.status = 'failed'
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.flaky WHERE is_flaky)
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.quarantine);

CREATE OR REPLACE VIEW flaker_v1.misses AS
SELECT DISTINCT
  v.selector_run_id,
  v.test_key,
  v.head_sha,
  gt.ci_run_id,
  v.reason,
  COALESCE(
    (SELECT to_json(list(cc.file_path ORDER BY cc.file_path))
     FROM commit_changes cc WHERE cc.commit_sha = v.head_sha),
    '[]'::JSON
  ) AS changed_files
FROM flaker_v1.selector_verdicts v
JOIN selector_ground_truth gt ON gt.commit_sha = v.head_sha AND gt.test_key = v.test_key
WHERE v.test_key IS NOT NULL AND NOT v.selected;
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS, HISTORY_VIEWS, SELECTOR_VIEWS].join("\n");
```

(Again one export. Replace the previous line.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets` → PASS. `pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/datasets/views.ts tests/datasets
git commit -m "feat: publish flaker_v1.selector_verdicts, misses and gate_calibration as views"
```

### Task A8: JSON Schemas for the nine datasets, and the row serializer

**Files:**
- Create: `src/cli/contracts/json-schema.ts`, `src/cli/contracts/flaker-v1-datasets.ts`, `src/cli/datasets/registry.ts`, `src/cli/datasets/serialize.ts`, `src/cli/datasets/read.ts`, `tests/contracts/ajv.ts`, `tests/contracts/flaker-v1-datasets.test.ts`
- Modify: `package.json` (devDependency `ajv`)

- [ ] **Step 1: Add ajv**

```bash
pnpm add -D ajv@^8.17.1
```

- [ ] **Step 2: Write the failing contract test**

```ts
// tests/contracts/ajv.ts
import Ajv2020Module from "ajv/dist/2020.js";

// ajv ships CJS; under ESM the class is either the module or its default.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (
  opts: Record<string, unknown>,
) => { compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown } };

export function validator(schema: object) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  return (data: unknown): string | null => (validate(data) ? null : JSON.stringify(validate.errors));
}
```

```ts
// tests/contracts/flaker-v1-datasets.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DATASET_NAMES } from "../../src/cli/datasets/registry.js";
import { FLAKER_V1_SCHEMAS } from "../../src/cli/contracts/flaker-v1-datasets.js";
import { readDataset } from "../../src/cli/datasets/read.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";
import { validator } from "./ajv.js";

describe("flaker_v1 dataset contracts", () => {
  let store: DuckDBStore;
  beforeAll(async () => {
    store = await memoryStore();
    await store.insertCommitChanges("H", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await store.insertCommitChanges("G", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await seedRun(store, { id: 1, commitSha: "G", daysAgo: 2, results: [
      { suite: "tests/a.test.ts", testName: "a", titlePath: ["a"], status: "failed" },
      { suite: "tests/p.spec.ts", testName: "p", titlePath: ["P", "p"], status: "passed", retryCount: 1, variant: { project: "chromium" } },
    ] });
    await seedRun(store, { id: 2, commitSha: "H", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "a", titlePath: ["a"], status: "failed" },
      { suite: "tests/p.spec.ts", testName: "p", titlePath: ["P", "p"], status: "passed", variant: { project: "chromium" } },
    ] });
    await store.addQuarantine({ suite: "tests/p.spec.ts", testName: "p", variant: { project: "chromium" } }, "manual");
    await seedSelectorRun(store, { id: "sr", headSha: "H", tests: [
      { testKey: await keyFor(store, "tests/a.test.ts", "a"), file: "tests/a.test.ts", titlePath: ["a"], reason: "below", selected: false, score: 0.2, confidence: 0.9 },
    ] });
    await store.raw(`INSERT INTO gate_calibrations VALUES ('jev', ?, 2, 0.5, 1, 1, 1, NULL, 'keep', 'r')`, [new Date()]);
  });
  afterAll(async () => {
    await store.close();
  });

  it("has a schema for every dataset and nothing else", () => {
    expect(Object.keys(FLAKER_V1_SCHEMAS).sort()).toEqual([...DATASET_NAMES].sort());
  });

  for (const name of DATASET_NAMES) {
    it(`${name}: view columns equal the schema's properties`, async () => {
      const cols = await store.raw<{ column_name: string }>(`DESCRIBE flaker_v1.${name}`);
      const props = Object.keys((FLAKER_V1_SCHEMAS[name] as { properties: object }).properties);
      expect(cols.map((c) => c.column_name)).toEqual(props);
    });

    it(`${name}: every exported row validates`, async () => {
      const rows = await readDataset(store, name);
      expect(rows.length).toBeGreaterThan(0);
      const check = validator(FLAKER_V1_SCHEMAS[name]);
      for (const row of rows) expect(check(row)).toBeNull();
    });
  }

  it("serializes bigint, timestamps and JSON columns to plain JSON values", async () => {
    const [run] = await readDataset(store, "runs");
    expect(typeof run.run_id).toBe("number");
    expect(typeof run.created_at).toBe("string");
    const [test] = await readDataset(store, "tests");
    expect(Array.isArray(test.title_path)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/contracts/flaker-v1-datasets.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement**

```ts
// src/cli/contracts/json-schema.ts
/** A JSON Schema (draft 2020-12) as a plain object. */
export type JsonSchema = { [key: string]: unknown };

export const STR: JsonSchema = { type: "string" };
export const STR_OR_NULL: JsonSchema = { type: ["string", "null"] };
export const INT: JsonSchema = { type: "integer" };
export const INT_OR_NULL: JsonSchema = { type: ["integer", "null"] };
export const NUM: JsonSchema = { type: "number" };
export const NUM_OR_NULL: JsonSchema = { type: ["number", "null"] };
export const BOOL: JsonSchema = { type: "boolean" };
export const TIME: JsonSchema = { type: "string", format: "date-time" };
export const TIME_OR_NULL: JsonSchema = { type: ["string", "null"], format: "date-time" };
export const STRINGS: JsonSchema = { type: "array", items: { type: "string" } };
export const oneOf = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
```

```ts
// src/cli/contracts/flaker-v1-datasets.ts
/**
 * Row contracts of the public datasets (DuckDB schema `flaker_v1`), as
 * `flaker export <dataset> --format json` emits them: timestamps as ISO
 * strings, JSON columns as values. Within v1 only column additions are
 * allowed, so every schema has `additionalProperties: true`.
 */
import {
  BOOL, INT, INT_OR_NULL, NUM, NUM_OR_NULL, STR, STR_OR_NULL, STRINGS, TIME, TIME_OR_NULL, oneOf,
  type JsonSchema,
} from "./json-schema.js";
import type { DatasetName } from "../datasets/registry.js";

export interface FlakerV1TestRow {
  test_key: string; suite: string; test_name: string; task_id: string;
  variant: Record<string, string> | null; file: string; title_path: string[];
  first_seen_at: string; last_seen_at: string;
}
export interface FlakerV1RunRow {
  run_id: number; source: "ci" | "local" | "mutation"; workflow_name: string | null; lane: string | null;
  commit_sha: string; branch: string | null; event: string | null; is_full: boolean; created_at: string | null;
}
export interface FlakerV1ResultRow {
  run_id: number; test_key: string; status: string; retry_count: number | null;
  duration_ms: number | null; created_at: string | null;
}
export interface FlakerV1FlakyRow {
  test_key: string; window_days: number; runs: number; failures: number;
  flaky_rate: number; is_flaky: boolean; computed_at: string;
}
export interface FlakerV1QuarantineRow {
  test_key: string; reason: string; since: string | null; source: "auto" | "manual";
}
export interface FlakerV1CoFailureRow {
  changed_file: string; test_key: string; co_failures: number; changes: number; strength: number; window_days: number;
}
export interface FlakerV1SelectorVerdictRow {
  selector_run_id: string; selector: string; selector_version: string | null;
  head_sha: string | null; base_sha: string | null; context_digest: string | null;
  source: "real" | "mutation"; test_key: string | null; file: string; title_path: string[];
  project: string | null; score: number | null; confidence: number | null; reason: string;
  selected: boolean; created_at: string;
}
export interface FlakerV1MissRow {
  selector_run_id: string; test_key: string; head_sha: string; ci_run_id: number;
  reason: string; changed_files: string[];
}
export interface FlakerV1GateCalibrationRow {
  selector: string; calibrated_at: string; cutoff: number; unsure_below: number; unsure_margin: number;
  records: number; real_failures: number; recall_lb95: number | null;
  decision: "tighten" | "loosen" | "keep"; rationale: string;
}

function datasetRow(name: DatasetName, description: string, properties: Record<string, JsonSchema>): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/mizchi/flaker/contracts/flaker_v1/${name}.json`,
    title: `flaker_v1.${name}`,
    description,
    type: "object",
    required: Object.keys(properties),
    properties,
    additionalProperties: true,
  };
}

const VARIANT: JsonSchema = { type: ["object", "null"], additionalProperties: { type: "string" } };

// Property order is the view's column order; a contract test pins both.
export const FLAKER_V1_SCHEMAS: Record<DatasetName, JsonSchema> = {
  tests: datasetRow("tests", "Test identity. file + title_path is what selectors match on.", {
    test_key: STR, suite: STR, test_name: STR, task_id: STR, variant: VARIANT, file: STR,
    title_path: STRINGS, first_seen_at: TIME, last_seen_at: TIME,
  }),
  runs: datasetRow("runs", "One execution. is_full says whether the whole suite ran.", {
    run_id: INT, source: oneOf("ci", "local", "mutation"), workflow_name: STR_OR_NULL, lane: STR_OR_NULL,
    commit_sha: STR, branch: STR_OR_NULL, event: STR_OR_NULL, is_full: BOOL, created_at: TIME_OR_NULL,
  }),
  results: datasetRow("results", "Per-test results.", {
    run_id: INT, test_key: STR, status: STR, retry_count: INT_OR_NULL, duration_ms: INT_OR_NULL,
    created_at: TIME_OR_NULL,
  }),
  flaky: datasetRow("flaky", "Flaky verdicts over the configured window.", {
    test_key: STR, window_days: INT, runs: INT, failures: INT, flaky_rate: NUM, is_flaky: BOOL,
    computed_at: TIME,
  }),
  quarantine: datasetRow("quarantine", "Quarantined tests.", {
    test_key: STR, reason: STR, since: TIME_OR_NULL, source: oneOf("auto", "manual"),
  }),
  co_failures: datasetRow("co_failures", "How often a test failed on commits that changed a file.", {
    changed_file: STR, test_key: STR, co_failures: INT, changes: INT, strength: NUM, window_days: INT,
  }),
  selector_verdicts: datasetRow("selector_verdicts", "A selector's per-test decisions.", {
    selector_run_id: STR, selector: STR, selector_version: STR_OR_NULL, head_sha: STR_OR_NULL,
    base_sha: STR_OR_NULL, context_digest: STR_OR_NULL, source: oneOf("real", "mutation"),
    test_key: STR_OR_NULL, file: STR, title_path: STRINGS, project: STR_OR_NULL, score: NUM_OR_NULL,
    confidence: NUM_OR_NULL, reason: STR, selected: BOOL, created_at: TIME,
  }),
  misses: datasetRow("misses", "Tests the selector did not select that failed in a full run.", {
    selector_run_id: STR, test_key: STR, head_sha: STR, ci_run_id: INT, reason: STR, changed_files: STRINGS,
  }),
  gate_calibration: datasetRow("gate_calibration", "Calibration history; the latest row per selector is current.", {
    selector: STR, calibrated_at: TIME, cutoff: NUM, unsure_below: NUM, unsure_margin: NUM, records: INT,
    real_failures: INT, recall_lb95: NUM_OR_NULL, decision: oneOf("tighten", "loosen", "keep"), rationale: STR,
  }),
};
```

```ts
// src/cli/datasets/registry.ts
export const DATASET_NAMES = [
  "tests", "runs", "results", "flaky", "quarantine", "co_failures",
  "selector_verdicts", "misses", "gate_calibration",
] as const;

export type DatasetName = (typeof DATASET_NAMES)[number];

/** The column `--since` filters on; null when the dataset has none. */
export const DATASET_TIME_COLUMN: Record<DatasetName, string | null> = {
  tests: "last_seen_at",
  runs: "created_at",
  results: "created_at",
  flaky: null,
  quarantine: "since",
  co_failures: null,
  selector_verdicts: "created_at",
  misses: null,
  gate_calibration: "calibrated_at",
};

export function isDatasetName(value: string): value is DatasetName {
  return (DATASET_NAMES as readonly string[]).includes(value);
}
```

```ts
// src/cli/datasets/serialize.ts
import type { JsonSchema } from "../contracts/json-schema.js";

type Prop = { type?: string | string[] };

function isStructured(prop: Prop | undefined): boolean {
  if (!prop?.type) return false;
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  return types.includes("array") || types.includes("object");
}

/** DuckDB row → the JSON shape the dataset's schema describes. */
export function normalizeRow(row: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    out[column] = normalizeValue(value, props[column]);
  }
  return out;
}

function normalizeValue(value: unknown, prop: Prop | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && isStructured(prop)) return JSON.parse(value);
  return value;
}
```

```ts
// src/cli/datasets/read.ts
import type { MetricStore } from "../storage/types.js";
import { FLAKER_V1_SCHEMAS } from "../contracts/flaker-v1-datasets.js";
import type { DatasetName } from "./registry.js";
import { normalizeRow } from "./serialize.js";

export async function readDataset(
  store: MetricStore,
  name: DatasetName,
): Promise<Record<string, unknown>[]> {
  const rows = await store.raw<Record<string, unknown>>(`SELECT * FROM flaker_v1.${name}`);
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS[name]));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run tests/contracts/flaker-v1-datasets.test.ts` → PASS. Also run `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/cli/contracts src/cli/datasets tests/contracts
git commit -m "feat: define a JSON Schema for every flaker_v1 dataset and pin it to the views"
```

### Task A9: Export core: filters, formats, parquet

**Files:**
- Create: `src/cli/commands/analyze/sql-guard.ts`, `src/cli/datasets/query.ts`, `src/cli/datasets/format.ts`, `src/cli/commands/export/dataset.ts`
- Modify: `src/cli/datasets/read.ts`, `src/cli/storage/duckdb.ts` (`copySelectToParquet`), `src/cli/categories/analyze.ts:259-264`
- Test: `tests/datasets/export.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/datasets/export.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runExportDataset } from "../../src/cli/commands/export/dataset.js";
import { FlakerUsageError } from "../../src/cli/errors.js";
import { memoryStore, seedRun } from "./helpers.js";

describe("runExportDataset", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "old", daysAgo: 30, results: [
      { suite: "tests/a.test.ts", testName: "a, with comma", titlePath: ["a, with comma"], status: "passed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "new", daysAgo: 1, results: [
      { suite: "tests/b.test.ts", testName: "b", titlePath: ["B", "b"], status: "failed" },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("json: an array of rows", async () => {
    const { text, rows } = await runExportDataset({ store, dataset: "runs", format: "json" });
    expect(rows).toBe(2);
    expect(JSON.parse(text!)).toHaveLength(2);
  });

  it("jsonl: one row per line", async () => {
    const { text } = await runExportDataset({ store, dataset: "tests", format: "jsonl" });
    const lines = text!.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.title_path)).toEqual(expect.arrayContaining([["B", "b"], ["a, with comma"]]));
  });

  it("csv: a header in schema order, quoted cells, JSON-encoded arrays", async () => {
    const { text } = await runExportDataset({ store, dataset: "tests", format: "csv", where: "file = 'tests/a.test.ts'" });
    const [header, row] = text!.trimEnd().split("\n");
    expect(header).toBe("test_key,suite,test_name,task_id,variant,file,title_path,first_seen_at,last_seen_at");
    expect(row).toContain(`"a, with comma"`);
    expect(row).toContain(`"[""a, with comma""]"`);
  });

  it("--since keeps rows at or after the date", async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const { text } = await runExportDataset({ store, dataset: "runs", format: "json", since });
    expect(JSON.parse(text!).map((r: { commit_sha: string }) => r.commit_sha)).toEqual(["new"]);
  });

  it("rejects --since on a dataset without a time column, a bad date, and an unsafe --where", async () => {
    await expect(runExportDataset({ store, dataset: "flaky", format: "json", since: "2026-01-01" }))
      .rejects.toThrow(FlakerUsageError);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", since: "yesterday" }))
      .rejects.toThrow(/Invalid --since/);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", where: "1=1; DROP TABLE test_results" }))
      .rejects.toThrow(FlakerUsageError);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", where: "run_id IN (SELECT 1 FROM read_csv('/etc/passwd'))" }))
      .rejects.toThrow(FlakerUsageError);
  });

  it("rejects an unknown dataset or format, and parquet without -o", async () => {
    await expect(runExportDataset({ store, dataset: "test_results", format: "json" })).rejects.toThrow(/Unknown dataset/);
    await expect(runExportDataset({ store, dataset: "runs", format: "xml" })).rejects.toThrow(/Unknown format/);
    await expect(runExportDataset({ store, dataset: "runs", format: "parquet" })).rejects.toThrow(/requires -o/);
  });

  it("parquet: writes a file DuckDB can read back", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "flaker-export-")), "runs.parquet");
    const { rows, text } = await runExportDataset({ store, dataset: "runs", format: "parquet", output: out });
    expect(rows).toBe(2);
    expect(text).toBeNull();
    const back = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM read_parquet('${out}')`);
    expect(back[0].n).toBe(2);
  });

  it("-o writes text formats to the file and returns no text", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "flaker-export-")), "runs.json");
    const { text } = await runExportDataset({ store, dataset: "runs", format: "json", output: out });
    expect(text).toBeNull();
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/export.test.ts`
Expected: FAIL, the module `commands/export/dataset.js` is missing.

- [ ] **Step 3: Implement**

```ts
// src/cli/commands/analyze/sql-guard.ts
import { FlakerUsageError } from "../../errors.js";

/** DuckDB table functions that read or write the filesystem or network. */
export const FILESYSTEM_FUNCTIONS =
  /\b(READ_CSV_AUTO|READ_CSV|READ_PARQUET|READ_JSON_AUTO|READ_JSON|READ_BLOB|READ_TEXT|WRITE_CSV|HTTPFS|GLOB)\s*\(/i;

/** A user-supplied SQL fragment (a WHERE condition): one expression, no file access. */
export function assertSafeSqlFragment(fragment: string, flag: string): void {
  const stripped = fragment.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (stripped.includes(";")) {
    throw new FlakerUsageError(`${flag} must be a single SQL expression (no ';')`);
  }
  if (FILESYSTEM_FUNCTIONS.test(stripped)) {
    throw new FlakerUsageError(`${flag} may not call filesystem or network functions`);
  }
}
```

In `src/cli/categories/analyze.ts`, replace the local `dangerousFns` regex (line 260) with the shared one. Add the import `import { FILESYSTEM_FUNCTIONS } from "../commands/analyze/sql-guard.js";`, then change

```ts
  const dangerousFns = /\b(READ_CSV_AUTO|READ_CSV|READ_PARQUET|READ_JSON_AUTO|READ_JSON|READ_BLOB|READ_TEXT|WRITE_CSV|HTTPFS)\s*\(/i;
  if (dangerousFns.test(stripped)) {
```
to
```ts
  if (FILESYSTEM_FUNCTIONS.test(stripped)) {
```

(`GLOB` is added to the blocked list. That is a tightening of `query`, which is fine.)

```ts
// src/cli/datasets/query.ts
import { FlakerUsageError } from "../errors.js";
import { assertSafeSqlFragment } from "../commands/analyze/sql-guard.js";
import { DATASET_TIME_COLUMN, type DatasetName } from "./registry.js";

export interface DatasetQueryOptions {
  /** ISO date or date-time; rows whose time column is at or after it. */
  since?: string;
  /** SQL condition over the dataset's columns. */
  where?: string;
}

/** A DuckDB TIMESTAMP literal body (naive UTC) for a user-supplied date. */
export function parseSince(raw: string): string {
  const ms = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(ms)) {
    throw new FlakerUsageError(`Invalid --since value: ${raw}. Expected an ISO date such as 2026-09-01.`);
  }
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** The SELECT for one dataset. Parameter-free so it can also feed COPY. */
export function buildDatasetQuery(name: DatasetName, opts: DatasetQueryOptions = {}): string {
  const clauses: string[] = [];
  if (opts.since !== undefined) {
    const column = DATASET_TIME_COLUMN[name];
    if (!column) throw new FlakerUsageError(`--since is not supported for ${name}: it has no time column`);
    clauses.push(`${column} >= TIMESTAMP '${parseSince(opts.since)}'`);
  }
  if (opts.where !== undefined) {
    assertSafeSqlFragment(opts.where, "--where");
    clauses.push(`(${opts.where})`);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return `SELECT * FROM flaker_v1.${name}${where}`;
}
```

Replace `src/cli/datasets/read.ts`:

```ts
import type { MetricStore } from "../storage/types.js";
import { FLAKER_V1_SCHEMAS } from "../contracts/flaker-v1-datasets.js";
import type { DatasetName } from "./registry.js";
import { buildDatasetQuery, type DatasetQueryOptions } from "./query.js";
import { normalizeRow } from "./serialize.js";

export async function readDataset(
  store: MetricStore,
  name: DatasetName,
  opts: DatasetQueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const rows = await store.raw<Record<string, unknown>>(buildDatasetQuery(name, opts));
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS[name]));
}
```

```ts
// src/cli/datasets/format.ts
export const EXPORT_FORMATS = ["json", "jsonl", "csv", "parquet"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type TextExportFormat = Exclude<ExportFormat, "parquet">;

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (already normalized) as text. `columns` fixes the CSV header, even for zero rows. */
export function formatRows(
  rows: Record<string, unknown>[],
  format: TextExportFormat,
  columns: string[],
): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(rows, null, 2)}\n`;
    case "jsonl":
      return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
    case "csv":
      return [columns.join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))]
        .join("\n") + "\n";
  }
}
```

Add to `DuckDBStore` in `src/cli/storage/duckdb.ts` (next to `exportRunToParquet`, reusing `sanitizeSqlLiteral`):

```ts
  /** COPY the result of a parameter-free SELECT to a Parquet file. */
  async copySelectToParquet(selectSql: string, outputPath: string): Promise<void> {
    mkdirSync(dirname(outputPath), { recursive: true });
    await this.run(
      `COPY (${selectSql}) TO '${this.sanitizeSqlLiteral(outputPath)}' (FORMAT PARQUET)`,
    );
  }
```

```ts
// src/cli/commands/export/dataset.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DuckDBStore } from "../../storage/duckdb.js";
import { FlakerUsageError } from "../../errors.js";
import { DATASET_NAMES, isDatasetName } from "../../datasets/registry.js";
import { EXPORT_FORMATS, formatRows, isExportFormat } from "../../datasets/format.js";
import { buildDatasetQuery } from "../../datasets/query.js";
import { readDataset } from "../../datasets/read.js";
import { FLAKER_V1_SCHEMAS } from "../../contracts/flaker-v1-datasets.js";

export interface ExportDatasetOpts {
  store: DuckDBStore;
  dataset: string;
  format: string;
  since?: string;
  where?: string;
  output?: string;
}

export interface ExportDatasetResult {
  rows: number;
  /** The rendered output when no `output` file was given; null otherwise. */
  text: string | null;
}

export async function runExportDataset(opts: ExportDatasetOpts): Promise<ExportDatasetResult> {
  const { store, dataset, format } = opts;
  if (!isDatasetName(dataset)) {
    throw new FlakerUsageError(`Unknown dataset "${dataset}". Expected one of: ${DATASET_NAMES.join(", ")}`);
  }
  if (!isExportFormat(format)) {
    throw new FlakerUsageError(`Unknown format "${format}". Expected one of: ${EXPORT_FORMATS.join(", ")}`);
  }
  const filter = { since: opts.since, where: opts.where };
  if (format === "parquet") {
    if (!opts.output) throw new FlakerUsageError("--format parquet requires -o <file>");
    const sql = buildDatasetQuery(dataset, filter);
    await store.copySelectToParquet(sql, resolve(opts.output));
    const [count] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM (${sql})`);
    return { rows: count?.n ?? 0, text: null };
  }
  const rows = await readDataset(store, dataset, filter);
  const columns = Object.keys((FLAKER_V1_SCHEMAS[dataset] as { properties: object }).properties);
  const text = formatRows(rows, format, columns);
  if (opts.output) {
    const path = resolve(opts.output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    return { rows: rows.length, text: null };
  }
  return { rows: rows.length, text };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets/export.test.ts tests/commands/query.test.ts tests/cli/query-top-level.test.ts` → PASS (the CLI query test needs `pnpm build` first). `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/analyze/sql-guard.ts src/cli/categories/analyze.ts src/cli/datasets src/cli/commands/export src/cli/storage/duckdb.ts tests/datasets/export.test.ts
git commit -m "feat: export a dataset as json, jsonl, csv or parquet with --since and --where"
```

### Task A10: `flaker export` command

**Files:**
- Create: `src/cli/categories/export.ts`, `tests/cli/export-cli.test.ts`, `tests/fixtures/vitest-init-report.json`
- Modify: `src/cli/main.ts`, `tests/cli/surface-reduction.test.ts`, `tests/cli/help-primary-shape.test.ts`

- [ ] **Step 1: Write the fixture and the failing CLI test**

```json
{"testResults":[{"name":"tests/init.test.ts","assertionResults":[
  {"ancestorTitles":["init"],"fullName":"init writes toml","status":"failed","title":"writes toml","duration":5,"failureMessages":["boom"]},
  {"ancestorTitles":["init"],"fullName":"init reads toml","status":"passed","title":"reads toml","duration":5,"failureMessages":[]}
]}]}
```
(saved as `tests/fixtures/vitest-init-report.json`)

```ts
// tests/cli/export-cli.test.ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");
const REPORT = resolve(__filename, "../../fixtures/vitest-init-report.json");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-export-cli-"));
  writeFileSync(
    join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
  );
  const imported = spawnSync("node", [CLI, "import", REPORT, "--adapter", "vitest", "--commit", "c1", "--source", "ci"], { cwd: dir, encoding: "utf8" });
  expect(imported.status).toBe(0);
  return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync("node", [CLI, "export", ...args], { cwd: dir, encoding: "utf8" });

describe("flaker export", () => {
  it("is listed in the top-level help", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(res.stdout).toMatch(/^\s+export\b/m);
  });

  it("prints a dataset as jsonl", () => {
    const res = run(repo(), "tests", "--format", "jsonl");
    expect(res.status).toBe(0);
    const rows = res.stdout.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.title_path)).toEqual(expect.arrayContaining([["init", "writes toml"], ["init", "reads toml"]]));
  });

  it("writes parquet with -o", () => {
    const dir = repo();
    const res = run(dir, "results", "--format", "parquet", "-o", "out/results.parquet");
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, "out/results.parquet"))).toBe(true);
  });

  it("exits 2 on an unknown dataset, parquet to stdout, and --since without a time column", () => {
    const dir = repo();
    expect(run(dir, "nope").status).toBe(2);
    expect(run(dir, "runs", "--format", "parquet").status).toBe(2);
    expect(run(dir, "flaky", "--since", "2026-01-01").status).toBe(2);
  });

  it("exits 2 without a dataset", () => {
    expect(run(repo()).status).toBe(2);
  });
});
```

- [ ] **Step 2: Build and run to verify it fails**

Run: `pnpm build && pnpm vitest run tests/cli/export-cli.test.ts`
Expected: FAIL, `error: unknown command 'export'`.

- [ ] **Step 3: Implement**

```ts
// src/cli/categories/export.ts
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { FlakerUsageError } from "../errors.js";
import { openDatasetStore } from "../datasets/open.js";
import { DATASET_NAMES } from "../datasets/registry.js";
import { runExportDataset } from "../commands/export/dataset.js";

export interface ExportCliOpts {
  format: string;
  since?: string;
  where?: string;
  output?: string;
}

export async function exportAction(dataset: string | undefined, opts: ExportCliOpts): Promise<void> {
  if (!dataset) {
    throw new FlakerUsageError(`export needs a dataset: ${DATASET_NAMES.join(", ")}`);
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = await openDatasetStore(cwd, config);
  try {
    const { rows, text } = await runExportDataset({ store, dataset, ...opts });
    if (text !== null) process.stdout.write(text);
    else process.stderr.write(`Wrote ${rows} rows of flaker_v1.${dataset} to ${opts.output}\n`);
  } finally {
    await store.close();
  }
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Write a public dataset (flaker_v1)")
    .argument("[dataset]", `Dataset: ${DATASET_NAMES.join(", ")}`)
    .option("--format <format>", "json | jsonl | csv | parquet", "json")
    .option("--since <date>", "Only rows at or after this date (datasets with a time column)")
    .option("--where <expr>", "Extra SQL condition over the dataset's columns")
    .option("-o, --output <file>", "Write to a file instead of stdout")
    .action(exportAction);
}
```

`FlakerUsageError` thrown from the action reaches `main.ts`'s `parseAsync(...).catch`, which prints `Error: …` and exits 2. No extra handling is needed.

In `src/cli/main.ts`: add `import { registerExportCommand } from "./categories/export.js";` and call `registerExportCommand(program);` after `registerCalibrateCommand(program);`. In the `Primary commands:` block of `helpInformation`, add after the `query <sql>` line:

```
  export <dataset> [--format …]                 Write a public dataset (flaker_v1)
```

In `tests/cli/surface-reduction.test.ts` add `"export",` after `"query",` in `PRIMARY`. Update the comment from "12 entries (11 primary + `report` for IO)" to "13 entries (12 primary + `report` for IO)" and the test title to "lists exactly the 13 primary entries …". Point the "requires updating" note at this plan file. In `tests/cli/help-primary-shape.test.ts` add `"export",` after `"query",` in `primaryNames` and rename the test to "lists all 12 primary commands before the closing note".

- [ ] **Step 4: Build and run to verify it passes**

Run: `pnpm build && pnpm vitest run tests/cli/export-cli.test.ts tests/cli/surface-reduction.test.ts tests/cli/help-primary-shape.test.ts tests/cli/help-shape.test.ts` → PASS. Then `pnpm test` and `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/categories/export.ts src/cli/main.ts tests/cli tests/fixtures/vitest-init-report.json
git commit -m "feat: add flaker export for the flaker_v1 datasets"
```

### Task A11: Publish the dataset contract, docs, CHANGELOG, PR

**Files:**
- Modify: `package.json` (`exports`), `tsconfig.reporting.json` (`files`), `CHANGELOG.md`, `docs/how-to-use.md`, `docs/how-to-use.ja.md`

- [ ] **Step 1: Export the contract module**

`package.json` `exports`, add:

```json
    "./contracts/flaker-v1-datasets": {
      "types": "./dist/cli/contracts/flaker-v1-datasets.d.ts",
      "default": "./dist/cli/contracts/flaker-v1-datasets.js"
    },
```

`tsconfig.reporting.json` `files`, add `"src/cli/contracts/flaker-v1-datasets.ts"`. `flaker-v1-datasets.ts` imports `DatasetName` from `../datasets/registry.js`. `tsc` follows imports, so `registry.ts` and `json-schema.ts` are emitted too. Check with `ls dist/cli/contracts dist/cli/datasets` after `pnpm build`.

- [ ] **Step 2: Docs**

In `docs/how-to-use.md`, add a section `### flaker export — public datasets (flaker_v1)` after the `flaker import` sections. It lists the nine datasets with one line each (copy the table from the spec), states the stability rule (v1 = column additions only; external tools may read `flaker_v1.*` from the DuckDB file, never the storage tables), and shows:

```bash
flaker export tests --format jsonl
flaker export runs --since 2026-09-01 --format csv -o runs.csv
flaker export results --format parquet -o .flaker/export/results.parquet
flaker query "SELECT * FROM flaker_v1.flaky WHERE is_flaky"
```

Document the `[workflow_lanes]` table form next to the existing `[workflow_lanes]` text:

```toml
[workflow_lanes]
"ci.yml" = "sampled"
"nightly.yml" = { lane = "full-batch", full = true }
```

Mirror the section in `docs/how-to-use.ja.md` in Japanese.

- [ ] **Step 3: CHANGELOG**

Under `## Unreleased`, add:

```markdown
### Added

- Public datasets: nine views in the DuckDB schema `flaker_v1` (`tests`, `runs`, `results`, `flaky`, `quarantine`, `co_failures`, `selector_verdicts`, `misses`, `gate_calibration`), each with a JSON Schema exported as `@mizchi/flaker/contracts/flaker-v1-datasets`. Within v1 only columns are added.
- `flaker export <dataset> [--format json|jsonl|csv|parquet] [--since <date>] [--where <expr>] [-o <file>]`.
- `[workflow_lanes]` entries may be `{ lane = "…", full = true }` to mark lanes that run the whole suite (`runs.is_full`).
- Vitest and Playwright results keep their title path (`test_results.title_path`), which is how selectors name a test.
```

- [ ] **Step 4: Verify and commit**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm pack:check
git add package.json tsconfig.reporting.json CHANGELOG.md docs/how-to-use.md docs/how-to-use.ja.md
git commit -m "docs: document flaker_v1 datasets and flaker export"
```
Expected: `pnpm pack:check` lists `dist/cli/contracts/flaker-v1-datasets.{js,d.ts}`.

- [ ] **Step 5: Push and open the 2a PR** (only when the owner asks you to push). Title: `feat: flaker_v1 datasets and flaker export (test-db phase 2a)`. Body: link the spec and this plan, list the open questions above.

---

# Sub-phase 2b — `import --adapter selector-record|jev`

**Needs jev-test-filter 0.1.3 on npm.** Check with `npm view jev-test-filter@0.1.3 exports --json`. It must list `./gate` and `./types`. Before publish, develop against the local branch with `pnpm add -D jev-test-filter@link:../jev-test-filter` (after `npm run build` there), and **do not commit** the `link:` specifier. Replace it with `^0.1.3` before the PR.

### Task B1: Worktree, dependency, and a bundling guard

**Files:**
- Modify: `package.json`
- Create: `tests/package/jev-bundled.test.ts`

- [ ] **Step 1: Worktree and dependency**

```bash
git -C /Users/mz/ghq/github.com/mizchi/flaker worktree add ../flaker-test-db-2b -b feat/test-db-2b main
cd ../flaker-test-db-2b
pnpm install
pnpm add -D jev-test-filter@^0.1.3
```

- [ ] **Step 2: Write the failing guard test**

```ts
// tests/package/jev-bundled.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const MAIN = resolve(__filename, "../../../dist/cli/main.js");

describe("jev-test-filter is bundled, not a runtime dependency", () => {
  it("dist/cli/main.js does not import jev-test-filter", () => {
    const text = readFileSync(MAIN, "utf8");
    expect(text).not.toMatch(/from\s*["']jev-test-filter/);
    expect(text).not.toMatch(/import\(\s*["']jev-test-filter/);
  });

  it("package.json keeps it out of dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(__filename, "../../../package.json"), "utf8"));
    expect(pkg.dependencies?.["jev-test-filter"]).toBeUndefined();
    expect(pkg.devDependencies?.["jev-test-filter"]).toMatch(/^\^0\.2\./);
  });

  it("the bundle carries jev's gate", () => {
    expect(readFileSync(MAIN, "utf8")).toContain("unsureMargin");
  });
});
```

The third assertion stays red until the CLI bundle reaches the jev adapter (Task B6, Step 4). Do not expect it to pass before then.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml tests/package/jev-bundled.test.ts
git commit -m "build: add jev-test-filter as a bundled dev dependency"
```

### Task B2: `selector-record` v1 contract

**Files:**
- Create: `src/cli/contracts/canonical-json.ts`, `src/cli/contracts/selector-record-v1.ts`, `tests/fixtures/selector-record/valid.json`, `tests/contracts/selector-record-v1.test.ts`

- [ ] **Step 1: Write the fixture and the failing test**

```json
{
  "version": 1,
  "kind": "flaker-selector-record",
  "selector": "jev",
  "selector_version": null,
  "created_at": "2026-09-20T10:00:00.000Z",
  "head_sha": "c0ffee0000000000000000000000000000000001",
  "base_sha": null,
  "context_digest": null,
  "source": "real",
  "gate": { "cutoff": 2, "unsure_below": 0.5, "unsure_margin": 1 },
  "tests": [
    { "file": "tests/init.test.ts", "title_path": ["init", "writes toml"], "score": 1.2, "confidence": 0.9, "reason": "below", "selected": false },
    { "file": "tests/p.spec.ts", "title_path": ["P", "p"], "project": "chromium", "runner_file": "p.spec.ts", "score": null, "confidence": null, "reason": "missing", "selected": true }
  ]
}
```
(saved as `tests/fixtures/selector-record/valid.json`)

```ts
// tests/contracts/selector-record-v1.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SELECTOR_RECORD_V1_SCHEMA,
  parseSelectorRecord,
  selectorRunId,
} from "../../src/cli/contracts/selector-record-v1.js";
import { canonicalJson } from "../../src/cli/contracts/canonical-json.js";
import { validator } from "./ajv.js";

const valid = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/selector-record/valid.json"), "utf8"));
const check = validator(SELECTOR_RECORD_V1_SCHEMA);

describe("selector-record v1", () => {
  it("accepts the fixture in both the parser and the schema", () => {
    expect(check(valid)).toBeNull();
    const parsed = parseSelectorRecord(valid);
    expect(parsed.tests[1]).toMatchObject({ project: "chromium", runner_file: "p.spec.ts" });
  });

  const invalid: Array<[string, (r: any) => void]> = [
    ["wrong version", (r) => { r.version = 2; }],
    ["wrong kind", (r) => { r.kind = "other"; }],
    ["empty selector", (r) => { r.selector = ""; }],
    ["bad created_at", (r) => { r.created_at = "yesterday"; }],
    ["bad source", (r) => { r.source = "synthetic"; }],
    ["gate value not a number", (r) => { r.gate.cutoff = "2"; }],
    ["tests not an array", (r) => { r.tests = {}; }],
    ["title_path not strings", (r) => { r.tests[0].title_path = [1]; }],
    ["selected not boolean", (r) => { r.tests[0].selected = "no"; }],
    ["score not a number", (r) => { r.tests[0].score = "high"; }],
  ];
  for (const [name, mutate] of invalid) {
    it(`rejects ${name} in both the parser and the schema`, () => {
      const r = structuredClone(valid);
      mutate(r);
      expect(check(r)).not.toBeNull();
      expect(() => parseSelectorRecord(r)).toThrow(/invalid selector-record/);
    });
  }

  it("derives a stable run id from the content", () => {
    const a = selectorRunId(parseSelectorRecord(valid));
    const reordered = JSON.parse(JSON.stringify(valid, Object.keys(valid).reverse()));
    expect(selectorRunId(parseSelectorRecord(reordered))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("canonicalJson sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe(`{"a":[{"c":2}],"b":1}`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/contracts/selector-record-v1.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

```ts
// src/cli/contracts/canonical-json.ts
import { createHash } from "node:crypto";

/** JSON with object keys sorted and undefined members dropped; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
```

```ts
// src/cli/contracts/selector-record-v1.ts
/**
 * `selector-record` v1: a selector's per-test decisions for one change, in
 * the shape flaker ingests (`flaker import --adapter selector-record`). Any
 * selector that writes it can be calibrated by `flaker calibrate --selector`.
 *
 * Replay semantics: `reason` values "touched", "dynamic" and "quarantined" are
 * decided by the change, not by the gate, and stay fixed under any gate; every
 * other test is re-gated from `score` / `confidence` (null score = no answer,
 * always selected).
 */
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import {
  BOOL, NUM, NUM_OR_NULL, STR, STR_OR_NULL, STRINGS, TIME, oneOf, type JsonSchema,
} from "./json-schema.js";

export const SELECTOR_RECORD_KIND = "flaker-selector-record";

export interface SelectorGateValues {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
}

export interface SelectorRecordTestV1 {
  file: string;
  title_path: string[];
  project?: string;
  /** The path as the runner spells it, when it differs from `file` (Playwright rootDir). */
  runner_file?: string;
  score: number | null;
  confidence: number | null;
  reason: string;
  selected: boolean;
}

export interface SelectorRecordV1 {
  version: 1;
  kind: typeof SELECTOR_RECORD_KIND;
  selector: string;
  selector_version: string | null;
  created_at: string;
  head_sha: string | null;
  base_sha: string | null;
  context_digest: string | null;
  source: "real" | "mutation";
  /** The gate values the decisions were made under; null when unknown. */
  gate: SelectorGateValues | null;
  tests: SelectorRecordTestV1[];
}

const GATE: JsonSchema = {
  type: ["object", "null"],
  required: ["cutoff", "unsure_below", "unsure_margin"],
  properties: { cutoff: NUM, unsure_below: NUM, unsure_margin: NUM },
};

export const SELECTOR_RECORD_V1_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/mizchi/flaker/contracts/selector-record-v1.json",
  title: "flaker selector-record v1",
  type: "object",
  required: ["version", "kind", "selector", "created_at", "tests"],
  properties: {
    version: { const: 1 },
    kind: { const: SELECTOR_RECORD_KIND },
    selector: { type: "string", minLength: 1 },
    selector_version: STR_OR_NULL,
    created_at: TIME,
    head_sha: STR_OR_NULL,
    base_sha: STR_OR_NULL,
    context_digest: STR_OR_NULL,
    source: oneOf("real", "mutation"),
    gate: GATE,
    tests: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "title_path", "score", "confidence", "reason", "selected"],
        properties: {
          file: STR, title_path: STRINGS, project: STR, runner_file: STR,
          score: NUM_OR_NULL, confidence: NUM_OR_NULL, reason: STR, selected: BOOL,
        },
      },
    },
  },
};

function fail(what: string): never {
  throw new Error(`invalid selector-record: ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function nullableString(v: unknown, at: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${at} must be a string or null`);
  return v;
}
function nullableNumber(v: unknown, at: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${at} must be a number or null`);
  return v;
}
function optionalString(v: unknown, at: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(`${at} must be a string`);
  return v;
}

function parseGate(v: unknown): SelectorGateValues | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) fail("gate must be an object or null");
  const out: Record<string, number> = {};
  for (const key of ["cutoff", "unsure_below", "unsure_margin"] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n)) fail(`gate.${key} must be a number`);
    out[key] = n;
  }
  return out as unknown as SelectorGateValues;
}

function parseTest(v: unknown, at: string): SelectorRecordTestV1 {
  if (!isObj(v)) fail(`${at} must be an object`);
  if (typeof v.file !== "string" || v.file === "") fail(`${at}.file must be a non-empty string`);
  if (!Array.isArray(v.title_path) || !v.title_path.every((s) => typeof s === "string")) {
    fail(`${at}.title_path must be an array of strings`);
  }
  if (typeof v.reason !== "string" || v.reason === "") fail(`${at}.reason must be a non-empty string`);
  if (typeof v.selected !== "boolean") fail(`${at}.selected must be a boolean`);
  const project = optionalString(v.project, `${at}.project`);
  const runnerFile = optionalString(v.runner_file, `${at}.runner_file`);
  return {
    file: v.file,
    title_path: [...(v.title_path as string[])],
    ...(project === undefined ? {} : { project }),
    ...(runnerFile === undefined ? {} : { runner_file: runnerFile }),
    score: nullableNumber(v.score, `${at}.score`),
    confidence: nullableNumber(v.confidence, `${at}.confidence`),
    reason: v.reason,
    selected: v.selected,
  };
}

export function parseSelectorRecord(raw: unknown): SelectorRecordV1 {
  if (!isObj(raw)) fail("expected a JSON object");
  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}; expected 1`);
  if (raw.kind !== SELECTOR_RECORD_KIND) fail(`kind must be "${SELECTOR_RECORD_KIND}"`);
  if (typeof raw.selector !== "string" || raw.selector === "") fail("selector must be a non-empty string");
  if (typeof raw.created_at !== "string" || Number.isNaN(Date.parse(raw.created_at))) {
    fail("created_at must be an ISO date-time");
  }
  const source = raw.source ?? "real";
  if (source !== "real" && source !== "mutation") fail(`source must be "real" or "mutation"`);
  if (!Array.isArray(raw.tests)) fail("tests must be an array");
  return {
    version: 1,
    kind: SELECTOR_RECORD_KIND,
    selector: raw.selector,
    selector_version: nullableString(raw.selector_version, "selector_version"),
    created_at: raw.created_at,
    head_sha: nullableString(raw.head_sha, "head_sha"),
    base_sha: nullableString(raw.base_sha, "base_sha"),
    context_digest: nullableString(raw.context_digest, "context_digest"),
    source,
    gate: parseGate(raw.gate),
    tests: raw.tests.map((t, i) => parseTest(t, `tests[${i}]`)),
  };
}

/** Content-derived id: re-importing the same record is a no-op. */
export function selectorRunId(record: SelectorRecordV1): string {
  return sha256Hex(canonicalJson(record)).slice(0, 32);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/contracts/selector-record-v1.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/contracts tests/contracts/selector-record-v1.test.ts tests/fixtures/selector-record
git commit -m "feat: define selector-record v1, the format flaker ingests selector decisions in"
```

### Task B3: jev record v1/v2 → selector-record, gated by jev itself

**Files:**
- Create: `src/cli/selector/jev-record.ts`, `tests/fixtures/jev/record-v1.json`, `tests/fixtures/jev/record-v2.json`, `tests/contracts/jev-record.test.ts`

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/jev/record-v2.json`:

```json
{
  "version": 2,
  "createdAt": "2026-09-20T10:00:00.000Z",
  "base": "origin/main",
  "head_sha": "c0ffee0000000000000000000000000000000001",
  "base_sha": "ba5e000000000000000000000000000000000001",
  "context_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "gate": { "cutoff": 2, "unsure_below": 0.5, "unsure_margin": 1 },
  "framework": "vitest",
  "tests": [
    { "file": "tests/config.test.ts", "titlePath": ["config", "loads toml"], "line": 5, "endLine": 9, "framework": "vitest", "dynamic": false },
    { "file": "tests/config.test.ts", "titlePath": ["config", "rejects bad key"], "line": 11, "endLine": 15, "framework": "vitest", "dynamic": false },
    { "file": "tests/init.test.ts", "titlePath": ["init", "writes toml"], "line": 3, "endLine": 8, "framework": "vitest", "dynamic": false },
    { "file": "tests/init.test.ts", "titlePath": ["init", "row ${n}"], "line": 10, "endLine": 12, "framework": "vitest", "dynamic": true },
    { "file": "tests/flaky.test.ts", "titlePath": ["flaky", "sometimes"], "line": 2, "endLine": 4, "framework": "vitest", "dynamic": false }
  ],
  "touched": ["tests/config.test.ts\u001fconfig\u001floads toml\u001f5"],
  "quarantined": ["tests/flaky.test.ts\u001fflaky\u001fsometimes\u001f2"],
  "answers": {
    "q0000": { "value": 3, "confidence": 0.9 },
    "q0001": { "value": 1.2, "confidence": 0.3 },
    "q0002": { "value": 0.4, "confidence": 0.9 },
    "q0003": null,
    "q0004": null
  },
  "fallback": null
}
```

Under the recorded gate: q0000 touched (selected), q0001 unsure (selected), q0002 below, q0003 dynamic (selected), q0004 quarantined.

`tests/fixtures/jev/record-v1.json`:

```json
{
  "version": 1,
  "createdAt": "2026-09-01T10:00:00.000Z",
  "base": null,
  "framework": "vitest",
  "tests": [
    { "file": "tests/a.test.ts", "titlePath": ["a"], "line": 1, "endLine": 3, "framework": "vitest", "dynamic": false },
    { "file": "tests/b.test.ts", "titlePath": ["b"], "line": 1, "endLine": 3, "framework": "vitest", "dynamic": false }
  ],
  "touched": [],
  "answers": { "q0000": { "value": 2.5, "confidence": 0.8 }, "q0001": { "value": 0.1, "confidence": 0.9 } },
  "fallback": null
}
```

- [ ] **Step 2: Write the failing contract test**

```ts
// tests/contracts/jev-record.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Test-only: jev's main entry pulls in @ast-grep/napi, so src/ never imports it.
import { loadRecord, replay } from "jev-test-filter";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../src/cli/selector/jev-record.js";
import { SELECTOR_RECORD_V1_SCHEMA } from "../../src/cli/contracts/selector-record-v1.js";
import { validator } from "./ajv.js";

const fixture = (name: string) => resolve(import.meta.dirname, `../fixtures/jev/${name}`);
const read = (name: string) => JSON.parse(readFileSync(fixture(name), "utf8"));

describe("jev record → selector-record", () => {
  for (const name of ["record-v1.json", "record-v2.json"]) {
    it(`${name}: parses to what jev's own loadRecord returns`, async () => {
      expect(parseJevRecord(read(name))).toEqual(await loadRecord(fixture(name)));
    });

    it(`${name}: per-test selected/reason equal jev's replay under the recorded gate`, async () => {
      const record = await loadRecord(fixture(name));
      const converted = jevRecordToSelectorRecord(parseJevRecord(read(name)))!;
      const expected = replay(record);
      expect(converted.tests.map((t) => [t.reason, t.selected]))
        .toEqual(expected.verdicts.map((v) => [v.reason, v.selected]));
      expect(validator(SELECTOR_RECORD_V1_SCHEMA)(converted)).toBeNull();
    });
  }

  it("v2 keeps shas, digest and gate; v1 has them null", () => {
    const v2 = jevRecordToSelectorRecord(parseJevRecord(read("record-v2.json")))!;
    expect(v2).toMatchObject({
      selector: "jev", source: "real",
      head_sha: "c0ffee0000000000000000000000000000000001",
      context_digest: expect.stringMatching(/^sha256:/),
      gate: { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 },
    });
    expect(v2.tests.map((t) => t.reason)).toEqual(["touched", "unsure", "below", "dynamic", "quarantined"]);
    expect(v2.tests[0]).toMatchObject({ file: "tests/config.test.ts", title_path: ["config", "loads toml"], score: 3, confidence: 0.9 });
    const v1 = jevRecordToSelectorRecord(parseJevRecord(read("record-v1.json")))!;
    expect(v1).toMatchObject({ head_sha: null, base_sha: null, context_digest: null, gate: null });
  });

  it("a record that fell back converts to nothing", () => {
    const r = read("record-v2.json");
    r.fallback = "jev failed: boom";
    expect(jevRecordToSelectorRecord(parseJevRecord(r))).toBeNull();
  });

  it("rejects an unknown version and a malformed test", () => {
    expect(() => parseJevRecord({ ...read("record-v2.json"), version: 3 })).toThrow(/invalid jev record/);
    const bad = read("record-v2.json");
    bad.tests[0].titlePath = "config";
    expect(() => parseJevRecord(bad)).toThrow(/invalid jev record/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/contracts/jev-record.test.ts`
Expected: FAIL, `src/cli/selector/jev-record.js` is missing.

- [ ] **Step 4: Implement**

```ts
// src/cli/selector/jev-record.ts
/**
 * jev-test-filter's run record (v1 or v2) → flaker's selector-record v1.
 *
 * The reason and selection of every test come from jev's own `gate()`
 * (bundled from `jev-test-filter/gate`), under the gate the record was
 * decided with. flaker never re-implements that decision.
 *
 * `touched` and `quarantined` are keyed by jev's `testId` (it includes the
 * line); `answers` by question id, which is the test's index in `tests`. Both
 * are resolved to the test itself here, so nothing downstream sees them.
 */
import { gate, gateOptions, resolveGate } from "jev-test-filter/gate";
import type { Answer, RunRecord, TestCase } from "jev-test-filter/types";
import type { SelectorRecordV1 } from "../contracts/selector-record-v1.js";
import { SELECTOR_RECORD_KIND } from "../contracts/selector-record-v1.js";

function fail(what: string): never {
  throw new Error(`invalid jev record: ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown, at: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) fail(`${at} must be an array of strings`);
  return [...v];
};
const nullableString = (v: unknown, at: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${at} must be a string or null`);
  return v;
};

function readTest(v: unknown, at: string): TestCase {
  if (!isObj(v)) fail(`${at} must be an object`);
  if (typeof v.file !== "string") fail(`${at}.file must be a string`);
  const titlePath = strings(v.titlePath, `${at}.titlePath`);
  if (typeof v.line !== "number" || typeof v.endLine !== "number") fail(`${at}.line/endLine must be numbers`);
  if (typeof v.framework !== "string") fail(`${at}.framework must be a string`);
  if (typeof v.dynamic !== "boolean") fail(`${at}.dynamic must be a boolean`);
  return {
    ...(v as unknown as TestCase),
    file: v.file,
    titlePath,
    line: v.line,
    endLine: v.endLine,
    dynamic: v.dynamic,
  };
}

function readAnswers(v: unknown): Record<string, Answer | null> {
  if (!isObj(v)) fail("answers must be an object");
  const out: Record<string, Answer | null> = {};
  for (const [id, a] of Object.entries(v)) {
    if (a === null) { out[id] = null; continue; }
    if (!isObj(a) || typeof a.value !== "number" || !(a.confidence === null || typeof a.confidence === "number")) {
      fail(`answers.${id} must be null or { value: number, confidence: number | null }`);
    }
    out[id] = { value: a.value, confidence: a.confidence as number | null };
  }
  return out;
}

function readGate(v: unknown): RunRecord["gate"] {
  if (!isObj(v)) fail("gate must be an object");
  for (const key of ["cutoff", "unsure_below", "unsure_margin"] as const) {
    if (typeof v[key] !== "number") fail(`gate.${key} must be a number`);
  }
  return { cutoff: v.cutoff as number, unsure_below: v.unsure_below as number, unsure_margin: v.unsure_margin as number };
}

/** Validate and normalize a parsed record, the same way jev's `loadRecord` does. */
export function parseJevRecord(raw: unknown): RunRecord {
  if (!isObj(raw)) fail("expected a JSON object");
  if (raw.version !== 1 && raw.version !== 2) fail(`unsupported version ${String(raw.version)}`);
  if (!Array.isArray(raw.tests)) fail("tests must be an array");
  const common = {
    ...raw,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fail("createdAt must be a string"),
    base: nullableString(raw.base, "base"),
    framework: raw.framework as TestCase["framework"],
    tests: raw.tests.map((t, i) => readTest(t, `tests[${i}]`)),
    touched: strings(raw.touched, "touched"),
    answers: readAnswers(raw.answers),
    fallback: nullableString(raw.fallback, "fallback"),
  };
  if (raw.version === 1) {
    return { ...common, version: 1, head_sha: null, base_sha: null, context_digest: null, gate: null, quarantined: [] } as RunRecord;
  }
  return {
    ...common,
    version: 2,
    head_sha: nullableString(raw.head_sha, "head_sha"),
    base_sha: nullableString(raw.base_sha, "base_sha"),
    context_digest: nullableString(raw.context_digest, "context_digest"),
    // A v2 record without a gate reads as jev's defaults, exactly as jev's loadRecord does.
    gate: raw.gate === undefined ? resolveGate() : readGate(raw.gate),
    quarantined: raw.quarantined === undefined ? [] : strings(raw.quarantined, "quarantined"),
  } as RunRecord;
}

/** Null for a record that fell back: it holds no decisions. */
export function jevRecordToSelectorRecord(record: RunRecord): SelectorRecordV1 | null {
  if (record.fallback !== null) return null;
  const selection = gate(
    record.tests,
    new Map(Object.entries(record.answers)),
    new Set(record.touched),
    gateOptions(record.gate),
    new Set(record.quarantined),
  );
  return {
    version: 1,
    kind: SELECTOR_RECORD_KIND,
    selector: "jev",
    selector_version: null,
    created_at: record.createdAt,
    head_sha: record.head_sha,
    base_sha: record.base_sha,
    context_digest: record.context_digest,
    source: "real",
    gate: record.gate,
    tests: selection.verdicts.map((v) => ({
      file: v.test.file,
      title_path: [...v.test.titlePath],
      ...(v.test.project ? { project: v.test.project } : {}),
      ...(v.test.runnerFile !== undefined ? { runner_file: v.test.runnerFile } : {}),
      score: v.answer?.value ?? null,
      confidence: v.answer?.confidence ?? null,
      reason: v.reason,
      selected: v.selected,
    })),
  };
}
```

- [ ] **Step 5: Run to verify it passes, and the bundling guard**

Run: `pnpm vitest run tests/contracts/jev-record.test.ts` → PASS. The guard stays red until something in the CLI bundle imports this module, which happens in Task B6. Do not run it yet. If `pnpm typecheck` cannot resolve `jev-test-filter/gate` types, check that the installed `node_modules/jev-test-filter/dist/gate.d.ts` imports `./types.js` rather than `./types.ts`. jev builds with `rewriteRelativeImportExtensions`, which rewrites declaration output too. If it does not, that is a jev 0.2.x packaging bug to fix upstream, not something to work around here.

- [ ] **Step 6: Commit**

```bash
git add src/cli/selector/jev-record.ts tests/contracts/jev-record.test.ts tests/fixtures/jev
git commit -m "feat: convert jev-test-filter records to selector-record using jev's own gate"
```

### Task B4: Match selector tests to `test_key`

**Files:**
- Create: `src/cli/datasets/test-match.ts`, `tests/datasets/test-match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/datasets/test-match.test.ts
import { describe, expect, it } from "vitest";
import { buildTestIndex, matchTestKey, type KnownTest } from "../../src/cli/datasets/test-match.js";

const known: KnownTest[] = [
  { test_key: "k-vitest-new", file: "tests/a.test.ts", title_path: ["A", "works"], test_name: "A works", task_id: "tests/a.test.ts", project: null },
  { test_key: "k-vitest-legacy", file: "tests/b.test.ts", title_path: ["B works"], test_name: "B works", task_id: "tests/b.test.ts", project: null },
  { test_key: "k-pw-chromium", file: "e2e/login.spec.ts", title_path: ["login", "shows form"], test_name: "shows form", task_id: "login", project: "chromium" },
  { test_key: "k-pw-firefox", file: "e2e/login.spec.ts", title_path: ["login", "shows form"], test_name: "shows form", task_id: "login", project: "firefox" },
  { test_key: "k-pw-legacy", file: "e2e/old.spec.ts", title_path: ["redirects"], test_name: "redirects", task_id: "old flow", project: "chromium" },
  { test_key: "k-dup-1", file: "tests/dup.test.ts", title_path: ["same"], test_name: "same", task_id: "x", project: null },
  { test_key: "k-dup-2", file: "tests/dup.test.ts", title_path: ["same"], test_name: "same", task_id: "y", project: null },
];
const index = buildTestIndex(known);

describe("matchTestKey", () => {
  it("tier 1: equal title_path in the same file and project", () => {
    expect(matchTestKey(index, { file: "tests/a.test.ts", title_path: ["A", "works"] })).toBe("k-vitest-new");
    expect(matchTestKey(index, { file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "firefox" })).toBe("k-pw-firefox");
  });

  it("tier 2: a legacy vitest row whose test_name is the joined path", () => {
    expect(matchTestKey(index, { file: "tests/b.test.ts", title_path: ["B", "works"] })).toBe("k-vitest-legacy");
  });

  it("tier 3: a legacy playwright row, leaf title plus parent as task_id", () => {
    expect(matchTestKey(index, { file: "e2e/old.spec.ts", title_path: ["old flow", "redirects"], project: "chromium" })).toBe("k-pw-legacy");
  });

  it("matches on runner_file when file differs, and strips a leading ./", () => {
    expect(matchTestKey(index, { file: "packages/app/e2e/login.spec.ts", runner_file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "chromium" })).toBe("k-pw-chromium");
    expect(matchTestKey(index, { file: "./tests/a.test.ts", title_path: ["A", "works"] })).toBe("k-vitest-new");
  });

  it("treats an empty project as none", () => {
    expect(matchTestKey(index, { file: "tests/a.test.ts", title_path: ["A", "works"], project: "" })).toBe("k-vitest-new");
  });

  it("returns null when ambiguous or unknown", () => {
    expect(matchTestKey(index, { file: "tests/dup.test.ts", title_path: ["same"] })).toBeNull();
    expect(matchTestKey(index, { file: "e2e/login.spec.ts", title_path: ["login", "shows form"] })).toBeNull();
    expect(matchTestKey(index, { file: "tests/none.test.ts", title_path: ["x"] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/datasets/test-match.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/cli/datasets/test-match.ts
/**
 * A selector names a test by file + title_path (+ project); flaker keys it
 * by test_key. Stable ids cannot be recomputed from the selector's name
 * because adapters spell suite / test_name / task_id differently, so the
 * name is matched against known tests in tiers. A tier wins only with
 * exactly one candidate; anything else is unmatched (null), never guessed.
 */
export interface KnownTest {
  test_key: string;
  file: string;
  title_path: string[];
  test_name: string;
  task_id: string;
  project: string | null;
}

export interface SelectorTestName {
  file: string;
  title_path: string[];
  project?: string | null;
  runner_file?: string | null;
}

export type TestIndex = Map<string, KnownTest[]>;

const normFile = (f: string) => f.replace(/^\.\//, "");
const normProject = (p: string | null | undefined) => (p ? p : null);
const bucket = (file: string, project: string | null) => `${normFile(file)}\u001e${project ?? ""}`;
const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

export function buildTestIndex(tests: KnownTest[]): TestIndex {
  const index: TestIndex = new Map();
  for (const t of tests) {
    const key = bucket(t.file, normProject(t.project));
    const list = index.get(key);
    if (list) list.push(t);
    else index.set(key, [t]);
  }
  return index;
}

export function matchTestKey(index: TestIndex, name: SelectorTestName): string | null {
  const project = normProject(name.project);
  const files = [name.file, name.runner_file].filter((f): f is string => typeof f === "string" && f !== "");
  const candidates = [...new Set(files.map(normFile))].flatMap((f) => index.get(bucket(f, project)) ?? []);
  const path = name.title_path;
  const parent = path.length >= 2 ? path[path.length - 2] : null;
  const tiers: Array<(t: KnownTest) => boolean> = [
    (t) => samePath(t.title_path, path),
    (t) => t.test_name === path.join(" "),
    (t) => t.test_name === path[path.length - 1] && (path.length === 1 || t.task_id === parent),
  ];
  for (const tier of tiers) {
    const hits = [...new Set(candidates.filter(tier).map((t) => t.test_key))];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/datasets/test-match.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/datasets/test-match.ts tests/datasets/test-match.test.ts
git commit -m "feat: match a selector's file and title path to flaker's stable test key"
```

### Task B5: Store selector records and resolve their keys

**Files:**
- Create: `src/cli/selector/store.ts`, `tests/selector/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/selector/store.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { parseSelectorRecord } from "../../src/cli/contracts/selector-record-v1.js";
import { insertSelectorRecord, resolveSelectorTestKeys } from "../../src/cli/selector/store.js";
import { keyFor, memoryStore, seedRun } from "../datasets/helpers.js";

const record = parseSelectorRecord(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../fixtures/selector-record/valid.json"), "utf8")));

describe("selector record storage", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("inserts once per content; a re-import is a duplicate", async () => {
    const first = await insertSelectorRecord(store, record);
    const second = await insertSelectorRecord(store, record);
    expect(first.inserted).toBe(true);
    expect(second).toEqual({ selectorRunId: first.selectorRunId, inserted: false });
    const rows = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.selector_verdicts`);
    expect(rows[0].n).toBe(2);
  });

  it("resolves keys for tests flaker already knows, and again after later imports", async () => {
    await insertSelectorRecord(store, record);
    expect(await resolveSelectorTestKeys(store)).toEqual({ resolved: 0, unresolved: 2 });
    await seedRun(store, { id: 1, commitSha: record.head_sha!, daysAgo: 0, results: [
      { suite: "tests/init.test.ts", testName: "init writes toml", titlePath: ["init", "writes toml"], status: "failed" },
    ] });
    expect(await resolveSelectorTestKeys(store)).toEqual({ resolved: 1, unresolved: 1 });
    const [row] = await store.raw<{ test_key: string }>(
      `SELECT test_key FROM flaker_v1.selector_verdicts WHERE file = 'tests/init.test.ts'`,
    );
    expect(row.test_key).toBe(await keyFor(store, "tests/init.test.ts", "init writes toml"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/selector/store.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/cli/selector/store.ts
import type { MetricStore } from "../storage/types.js";
import type { SelectorRecordV1 } from "../contracts/selector-record-v1.js";
import { selectorRunId } from "../contracts/selector-record-v1.js";
import { readDataset } from "../datasets/read.js";
import { buildTestIndex, matchTestKey, type KnownTest } from "../datasets/test-match.js";

export async function insertSelectorRecord(
  store: MetricStore,
  record: SelectorRecordV1,
): Promise<{ selectorRunId: string; inserted: boolean }> {
  const id = selectorRunId(record);
  const existing = await store.raw(`SELECT 1 FROM selector_runs WHERE selector_run_id = ?`, [id]);
  if (existing.length > 0) return { selectorRunId: id, inserted: false };
  await store.raw(
    `INSERT INTO selector_runs (selector_run_id, selector, selector_version, head_sha, base_sha, context_digest, source, gate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, record.selector, record.selector_version, record.head_sha, record.base_sha,
      record.context_digest, record.source, record.gate ? JSON.stringify(record.gate) : null,
      new Date(record.created_at),
    ],
  );
  for (const [ordinal, t] of record.tests.entries()) {
    await store.raw(
      `INSERT INTO selector_run_tests (selector_run_id, ordinal, test_key, file, title_path, project, runner_file, score, confidence, reason, selected)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, ordinal, t.file, JSON.stringify(t.title_path), t.project ?? null, t.runner_file ?? null,
        t.score, t.confidence, t.reason, t.selected,
      ],
    );
  }
  return { selectorRunId: id, inserted: true };
}

/** Fill `test_key` for verdicts not matched yet. Idempotent. */
export async function resolveSelectorTestKeys(
  store: MetricStore,
): Promise<{ resolved: number; unresolved: number }> {
  const pending = await store.raw<{
    selector_run_id: string; ordinal: number; file: string; title_path: string;
    project: string | null; runner_file: string | null;
  }>(
    `SELECT selector_run_id, ordinal, file, title_path, project, runner_file
     FROM selector_run_tests WHERE test_key IS NULL`,
  );
  if (pending.length === 0) return { resolved: 0, unresolved: 0 };
  const known = (await readDataset(store, "tests")).map((row): KnownTest => ({
    test_key: row.test_key as string,
    file: row.file as string,
    title_path: row.title_path as string[],
    test_name: row.test_name as string,
    task_id: row.task_id as string,
    project: ((row.variant as Record<string, string> | null)?.project) ?? null,
  }));
  const index = buildTestIndex(known);
  let resolved = 0;
  for (const p of pending) {
    const key = matchTestKey(index, {
      file: p.file, title_path: JSON.parse(p.title_path), project: p.project, runner_file: p.runner_file,
    });
    if (key === null) continue;
    await store.raw(
      `UPDATE selector_run_tests SET test_key = ? WHERE selector_run_id = ? AND ordinal = ?`,
      [key, p.selector_run_id, p.ordinal],
    );
    resolved++;
  }
  return { resolved, unresolved: pending.length - resolved };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/selector/store.test.ts` → PASS.

- [ ] **Step 5: Replace the direct-SQL seeding helper**

In `tests/datasets/helpers.ts`, keep `seedSelectorRun` (the view tests in A7 and A8 insert with a known `test_key`, which `insertSelectorRecord` cannot do). Add a one-line doc comment saying it bypasses matching on purpose. No code change.

- [ ] **Step 6: Commit**

```bash
git add src/cli/selector/store.ts tests/selector/store.test.ts tests/datasets/helpers.ts
git commit -m "feat: store selector records and resolve their tests to stable keys"
```

### Task B6: `flaker import --adapter selector-record|jev <file|dir>`

**Files:**
- Create: `src/cli/commands/import/selector.ts`, `tests/commands/import-selector.test.ts`, `tests/cli/import-selector-cli.test.ts`
- Modify: `src/cli/categories/import.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/commands/import-selector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { listRecordFiles, runImportSelector } from "../../src/cli/commands/import/selector.js";
import { memoryStore } from "../datasets/helpers.js";

const FIX = resolve(import.meta.dirname, "../fixtures");

function jevDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
  mkdirSync(join(dir, "records"));
  copyFileSync(join(FIX, "jev/record-v2.json"), join(dir, "last.json"));
  copyFileSync(join(FIX, "jev/record-v2.json"), join(dir, "records/c0ffee0000000000000000000000000000000001.json"));
  copyFileSync(join(FIX, "jev/record-v1.json"), join(dir, "records/old.json"));
  return dir;
}

describe("runImportSelector", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("lists a file, or every .json in a directory and its records/ subdirectory", () => {
    const dir = jevDir();
    expect(listRecordFiles(join(dir, "last.json"))).toEqual([join(dir, "last.json")]);
    expect(listRecordFiles(dir)).toEqual([
      join(dir, "last.json"),
      join(dir, "records/c0ffee0000000000000000000000000000000001.json"),
      join(dir, "records/old.json"),
    ]);
  });

  it("imports jev records, counting last.json's copy as a duplicate", async () => {
    const result = await runImportSelector({ store, path: jevDir(), adapter: "jev" });
    expect(result).toMatchObject({ files: 3, imported: 2, duplicates: 1, invalid: [], skipped: [] });
  });

  it("skips a record that fell back, and reports an invalid file without stopping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
    const v2 = JSON.parse(readFileSync(join(FIX, "jev/record-v2.json"), "utf8"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ ...v2, fallback: "jev failed: x" }));
    writeFileSync(join(dir, "b.json"), "{ not json");
    copyFileSync(join(FIX, "jev/record-v1.json"), join(dir, "c.json"));
    const result = await runImportSelector({ store, path: dir, adapter: "jev" });
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([{ file: join(dir, "a.json"), reason: "fallback" }]);
    expect(result.invalid.map((i) => i.file)).toEqual([join(dir, "b.json")]);
  });

  it("imports selector-record files as they are", async () => {
    const result = await runImportSelector({ store, path: join(FIX, "selector-record/valid.json"), adapter: "selector-record" });
    expect(result.imported).toBe(1);
    const rows = await store.raw<{ selector: string }>(`SELECT DISTINCT selector FROM flaker_v1.selector_verdicts`);
    expect(rows).toEqual([{ selector: "jev" }]);
  });
});
```

```ts
// tests/cli/import-selector-cli.test.ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");
const FIX = resolve(__filename, "../../fixtures");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-import-selector-"));
  writeFileSync(join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`);
  return dir;
}

describe("flaker import --adapter jev|selector-record", () => {
  it("imports a jev record and exports its verdicts", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "import", join(FIX, "jev/record-v2.json"), "--adapter", "jev"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Imported 1 selector run/);
    const out = spawnSync("node", [CLI, "export", "selector_verdicts", "--format", "jsonl"], { cwd: dir, encoding: "utf8" });
    expect(out.stdout.trimEnd().split("\n")).toHaveLength(5);
  });

  it("exits 1 when a file is invalid", () => {
    const dir = repo();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{}");
    const res = spawnSync("node", [CLI, "import", bad, "--adapter", "selector-record"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/invalid selector-record/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/commands/import-selector.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/cli/commands/import/selector.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MetricStore } from "../../storage/types.js";
import { parseSelectorRecord, type SelectorRecordV1 } from "../../contracts/selector-record-v1.js";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../selector/jev-record.js";
import { insertSelectorRecord, resolveSelectorTestKeys } from "../../selector/store.js";

export const SELECTOR_ADAPTERS = ["selector-record", "jev"] as const;
export type SelectorAdapter = (typeof SELECTOR_ADAPTERS)[number];

export function isSelectorAdapter(value: string | undefined): value is SelectorAdapter {
  return value !== undefined && (SELECTOR_ADAPTERS as readonly string[]).includes(value);
}

export interface ImportSelectorResult {
  files: number;
  imported: number;
  duplicates: number;
  skipped: Array<{ file: string; reason: string }>;
  invalid: Array<{ file: string; error: string }>;
  resolved: number;
  unresolved: number;
}

/** A file as it is; a directory's *.json, then its records/*.json (jev's layout). Sorted. */
export function listRecordFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const jsonIn = (dir: string) =>
    readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));
  const records = join(path, "records");
  return [...jsonIn(path), ...(existsSync(records) && statSync(records).isDirectory() ? jsonIn(records) : [])];
}

function toSelectorRecord(adapter: SelectorAdapter, raw: unknown): SelectorRecordV1 | null {
  return adapter === "jev" ? jevRecordToSelectorRecord(parseJevRecord(raw)) : parseSelectorRecord(raw);
}

export async function runImportSelector(opts: {
  store: MetricStore;
  path: string;
  adapter: SelectorAdapter;
}): Promise<ImportSelectorResult> {
  const files = listRecordFiles(opts.path);
  const result: ImportSelectorResult = {
    files: files.length, imported: 0, duplicates: 0, skipped: [], invalid: [], resolved: 0, unresolved: 0,
  };
  for (const file of files) {
    let record: SelectorRecordV1 | null;
    try {
      record = toSelectorRecord(opts.adapter, JSON.parse(readFileSync(file, "utf8")));
    } catch (err) {
      result.invalid.push({ file, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (record === null) {
      result.skipped.push({ file, reason: "fallback" });
      continue;
    }
    const { inserted } = await insertSelectorRecord(opts.store, record);
    if (inserted) result.imported++;
    else result.duplicates++;
  }
  const keys = await resolveSelectorTestKeys(opts.store);
  result.resolved = keys.resolved;
  result.unresolved = keys.unresolved;
  return result;
}

export function formatImportSelector(r: ImportSelectorResult): string {
  const parts = [`Imported ${r.imported} selector run${r.imported === 1 ? "" : "s"}`];
  if (r.duplicates > 0) parts.push(`${r.duplicates} duplicate`);
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} skipped (fell back)`);
  if (r.invalid.length > 0) parts.push(`${r.invalid.length} invalid`);
  const lines = [parts.join(", ")];
  if (r.resolved + r.unresolved > 0) {
    lines.push(`Matched ${r.resolved} of ${r.resolved + r.unresolved} pending tests to known test identities`);
  }
  return lines.join("\n");
}
```

In `src/cli/categories/import.ts`:
- Import `openDatasetStore` from `../datasets/open.js` and `isSelectorAdapter, runImportSelector, formatImportSelector` from `../commands/import/selector.js`.
- Change the `[file]` argument description to `"File (or, with --adapter jev|selector-record, a directory) to import"`, and the `--adapter` description to `"Adapter type override (vitest, playwright, junit, parquet, vrt-migration, vrt-bench, custom, selector-record, jev)"`.
- Right after the `if (!file) { importCmd.help(); return; }` block, insert:

```ts
      if (isSelectorAdapter(opts.adapter)) {
        const config = loadConfig(process.cwd());
        const store = await openDatasetStore(process.cwd(), config);
        try {
          const result = await runImportSelector({ store, path: resolve(file), adapter: opts.adapter });
          console.log(formatImportSelector(result));
          for (const bad of result.invalid) process.stderr.write(`${bad.file}: ${bad.error}\n`);
          if (result.invalid.length > 0) process.exitCode = 1;
        } finally {
          await store.close();
        }
        return;
      }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run tests/commands/import-selector.test.ts` → PASS. Then `pnpm build && pnpm vitest run tests/cli/import-selector-cli.test.ts tests/package/jev-bundled.test.ts tests/cli/import-cli.test.ts` → PASS (the bundling guard is now green, because `categories/import.ts` reaches `selector/jev-record.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/import/selector.ts src/cli/categories/import.ts tests/commands/import-selector.test.ts tests/cli/import-selector-cli.test.ts
git commit -m "feat: import selector decisions with --adapter selector-record or jev"
```

### Task B7: Publish the record contract, docs, CHANGELOG, PR

- [ ] **Step 1:** Add `./contracts/selector-record-v1` to `package.json` `exports` and `src/cli/contracts/selector-record-v1.ts` to `tsconfig.reporting.json` `files` (same shape as A11).
- [ ] **Step 2:** In `docs/how-to-use.md` and `.ja.md`, add `### flaker import --adapter selector-record|jev`: what a selector record is (link the schema module), `flaker import .jev-test-filter --adapter jev` (the directory form picks up `records/*.json`, and `last.json` counts as a duplicate), and a note that unmatched tests stay in `selector_verdicts` with `test_key = null`.
- [ ] **Step 3:** CHANGELOG `### Added`: `flaker import --adapter selector-record|jev <file|dir>` and `selector-record` v1 (`@mizchi/flaker/contracts/selector-record-v1`).
- [ ] **Step 4:** Verify and commit:

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm pack:check
git add package.json tsconfig.reporting.json CHANGELOG.md docs/how-to-use.md docs/how-to-use.ja.md
git commit -m "docs: document selector-record and the jev import adapter"
```

- [ ] **Step 5:** PR `feat: ingest selector records and jev runs (test-db phase 2b)`, only when asked to push.

---

# Sub-phase 2c — `flaker calibrate --selector` and `export --projection jev-context`

### Task C1: Worktree and the `[selector]` config section

**Files:**
- Modify: `src/cli/config.ts`
- Test: `tests/cli/selector-config.test.ts`

- [ ] **Step 1: Worktree**

```bash
git -C /Users/mz/ghq/github.com/mizchi/flaker worktree add ../flaker-test-db-2c -b feat/test-db-2c main
cd ../flaker-test-db-2c && pnpm install && pnpm build
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/cli/selector-config.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveSelectorConfig, validateConfigRanges } from "../../src/cli/config.js";

function withToml(extra: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-selector-config-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${extra}\n`);
  return dir;
}

describe("[selector]", () => {
  it("defaults when absent", () => {
    expect(resolveSelectorConfig(loadConfig(withToml("")))).toEqual({
      type: "jev", recall_target: 0.9, min_failures: 20, max_hinted_tests: 200,
    });
  });

  it("reads overrides", () => {
    const config = loadConfig(withToml(`[selector]\ntype = "jev"\nrecall_target = 0.95\nmin_failures = 5\nmax_hinted_tests = 50`));
    expect(resolveSelectorConfig(config)).toEqual({ type: "jev", recall_target: 0.95, min_failures: 5, max_hinted_tests: 50 });
  });

  it("rejects an unknown selector type", () => {
    expect(() => resolveSelectorConfig(loadConfig(withToml(`[selector]\ntype = "other"`)))).toThrow(/only selector is "jev"/);
  });

  it("rejects gate values in flaker.toml: the database is their source of truth", () => {
    expect(() => loadConfig(withToml(`[selector]\ncutoff = 1.5`))).toThrow(/gate_calibration/);
  });

  it("range-checks recall_target", () => {
    const errors = validateConfigRanges(loadConfig(withToml(`[selector]\nrecall_target = 1.5`)));
    expect(errors.map((e) => e.path)).toContain("selector.recall_target");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/cli/selector-config.test.ts` → FAIL.

- [ ] **Step 4: Implement**

In `src/cli/config.ts`:

```ts
export interface SelectorConfig {
  type: "jev";
  /** Loosening needs the Wilson 95% lower bound of recall to reach this. */
  recall_target: number;
  /** Loosening needs at least this many real (non-mutation) failures. */
  min_failures: number;
  /** jev-context carries hints for at most this many tests. */
  max_hinted_tests: number;
}

export const DEFAULT_SELECTOR: SelectorConfig = {
  type: "jev",
  recall_target: 0.9,
  min_failures: 20,
  max_hinted_tests: 200,
};

export function resolveSelectorConfig(config: FlakerConfig): SelectorConfig {
  const merged = { ...DEFAULT_SELECTOR, ...(config.selector ?? {}) };
  if (merged.type !== "jev") {
    throw new FlakerUsageError(`[selector] type "${String(merged.type)}" is not supported; the only selector is "jev"`);
  }
  return merged;
}
```

Add `selector?: Partial<SelectorConfig>;` to `FlakerConfig`.

In `checkLegacyKeys`, before the final `if (errors.length > 0)`:

```ts
  if (isTable(parsed.selector)) {
    for (const key of ["cutoff", "unsure_below", "unsure_margin"]) {
      if (key in parsed.selector) {
        errors.push(`[selector] ${key} is not kept in flaker.toml; gate values live in the gate_calibration dataset (run \`flaker calibrate --selector\`)`);
      }
    }
  }
```

In `validateConfigRanges`, before `return errors;`:

```ts
  if (config.selector) {
    check("selector.recall_target", config.selector.recall_target, 0, 1, "0.0-1.0");
    check("selector.min_failures", config.selector.min_failures, 0, Number.MAX_SAFE_INTEGER, ">=0");
    check("selector.max_hinted_tests", config.selector.max_hinted_tests, 0, Number.MAX_SAFE_INTEGER, ">=0");
  }
```

- [ ] **Step 5: Run to verify it passes, then commit**

Run: `pnpm vitest run tests/cli/selector-config.test.ts tests/cli/config-migration.test.ts` → PASS.

```bash
git add src/cli/config.ts tests/cli/selector-config.test.ts
git commit -m "feat: add the [selector] section: recall target, failure minimum, hint cap"
```

### Task C2: Wilson lower bound

**Files:**
- Create: `src/cli/selector/wilson.ts`, `tests/selector/wilson.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/selector/wilson.test.ts
import { describe, expect, it } from "vitest";
import { wilsonLowerBound } from "../../src/cli/selector/wilson.js";

describe("wilsonLowerBound (95%)", () => {
  it("matches reference values", () => {
    expect(wilsonLowerBound(45, 50)).toBeCloseTo(0.7864, 4);
    expect(wilsonLowerBound(19, 20)).toBeCloseTo(0.7639, 4);
    expect(wilsonLowerBound(20, 20)).toBeCloseTo(0.8389, 4);
  });

  it("puts the p = 1 threshold for 0.98 between 188 and 189", () => {
    expect(wilsonLowerBound(188, 188)).toBeLessThan(0.98);
    expect(wilsonLowerBound(189, 189)).toBeGreaterThanOrEqual(0.98);
  });

  it("is 0 with no observations", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`pnpm vitest run tests/selector/wilson.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/selector/wilson.ts
/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/** Lower bound of the Wilson score interval for k successes out of n. 0 when n is 0. */
export function wilsonLowerBound(k: number, n: number, z: number = Z95): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (centre - spread) / (1 + z2 / n);
}
```

- [ ] **Step 4: Run to verify it passes, commit**

```bash
git add src/cli/selector/wilson.ts tests/selector/wilson.test.ts
git commit -m "feat: add the Wilson 95% lower bound used by selector calibration"
```

### Task C3: Replay verdicts through jev's `decide`

**Files:**
- Create: `src/cli/selector/replay.ts`, `tests/selector/replay.test.ts`

- [ ] **Step 1: Write the failing test (unit + contract against jev's replay)**

```ts
// tests/selector/replay.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRecord, replay } from "jev-test-filter";
import { replaySelected, type GateValues } from "../../src/cli/selector/replay.js";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../src/cli/selector/jev-record.js";

const fixture = resolve(import.meta.dirname, "../fixtures/jev/record-v2.json");
const GATES: GateValues[] = [
  { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 },
  { cutoff: 1, unsure_below: 0.5, unsure_margin: 1 },
  { cutoff: 0.3, unsure_below: 0.9, unsure_margin: 0 },
  { cutoff: 3, unsure_below: 0.2, unsure_margin: 2 },
];

describe("replaySelected", () => {
  it("keeps touched / dynamic / quarantined fixed and re-gates the rest", () => {
    const verdicts = [
      { testKey: "a", score: 0, confidence: 1, reason: "touched" },
      { testKey: "b", score: null, confidence: null, reason: "dynamic" },
      { testKey: "c", score: 3, confidence: 1, reason: "quarantined" },
      { testKey: "d", score: 1.5, confidence: 0.9, reason: "below" },
      { testKey: "e", score: null, confidence: null, reason: "missing" },
    ];
    expect(replaySelected(verdicts, { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 }))
      .toEqual([true, true, false, false, true]);
    expect(replaySelected(verdicts, { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 }))
      .toEqual([true, true, false, true, true]);
  });

  for (const g of GATES) {
    it(`equals jev's own replay of the record under ${JSON.stringify(g)}`, async () => {
      const record = await loadRecord(fixture);
      const converted = jevRecordToSelectorRecord(parseJevRecord(JSON.parse(readFileSync(fixture, "utf8"))))!;
      const verdicts = converted.tests.map((t) => ({ testKey: null, score: t.score, confidence: t.confidence, reason: t.reason }));
      const expected = replay(record, { cutoff: g.cutoff, unsureBelow: g.unsure_below, unsureMargin: g.unsure_margin });
      expect(replaySelected(verdicts, g)).toEqual(expected.verdicts.map((v) => v.selected));
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails** (`pnpm vitest run tests/selector/replay.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/selector/replay.ts
/**
 * Re-gate stored verdicts under other gate values, offline. The per-test
 * decision is jev's `decide` (bundled from jev-test-filter/gate); the one rule
 * `gate()` applies before it -- a quarantined test is never selected -- is
 * carried by the stored reason. tests/selector/replay.test.ts pins this to
 * jev's own `replay()` so the two cannot drift.
 */
import { decide } from "jev-test-filter/gate";
import type { TestCase } from "jev-test-filter/types";

export interface GateValues {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
}

export interface ReplayVerdict {
  testKey: string | null;
  score: number | null;
  confidence: number | null;
  reason: string;
}

export function replaySelected(verdicts: readonly ReplayVerdict[], g: GateValues): boolean[] {
  const opts = { cutoff: g.cutoff, unsureBelow: g.unsure_below, unsureMargin: g.unsure_margin };
  return verdicts.map((v, i) => {
    if (v.reason === "quarantined") return false;
    const test: TestCase = {
      file: "", titlePath: [String(i)], line: 0, endLine: 0, framework: "unknown",
      dynamic: v.reason === "dynamic",
    };
    const answer = v.score === null ? null : { value: v.score, confidence: v.confidence };
    return decide(`r${i}`, test, answer, v.reason === "touched", opts).selected;
  });
}
```

- [ ] **Step 4: Run to verify it passes, commit**

```bash
git add src/cli/selector/replay.ts tests/selector/replay.test.ts
git commit -m "feat: replay stored verdicts through jev's gate decision"
```

### Task C4: Calibration core (pure adoption rule)

**Files:**
- Create: `src/cli/selector/calibrate-core.ts`, `tests/selector/calibrate-core.test.ts`

- [ ] **Step 1: Write the failing table tests**

```ts
// tests/selector/calibrate-core.test.ts
import { describe, expect, it } from "vitest";
import {
  calibrateGate, DEFAULT_GRID, type CalibrationRecord,
} from "../../src/cli/selector/calibrate-core.js";
import type { GateValues } from "../../src/cli/selector/replay.js";

const DEFAULTS: GateValues = { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 };

/** One record: a failing test with this score, plus passing tests with these scores. All confident. */
function record(id: string, failingScore: number, passing: number[], source: "real" | "mutation" = "real"): CalibrationRecord {
  return {
    selectorRunId: id,
    source,
    contextDigest: null,
    verdicts: [
      { testKey: `${id}:fail`, score: failingScore, confidence: 0.9, reason: failingScore >= 2 ? "scored" : "below" },
      ...passing.map((s, i) => ({ testKey: `${id}:p${i}`, score: s, confidence: 0.9, reason: s >= 2 ? "scored" : "below" })),
    ],
    failures: [`${id}:fail`],
  };
}
const many = (n: number, score: number, passing: number[], source: "real" | "mutation" = "real") =>
  Array.from({ length: n }, (_, i) => record(`r${i}`, score, passing, source));

const base = { defaults: DEFAULTS, recallTarget: 0.98, minFailures: 20 };

describe("calibrateGate", () => {
  it("keeps, with a reason, when no record has ground truth", () => {
    const d = calibrateGate({ ...base, records: [], current: DEFAULTS });
    expect(d).toMatchObject({ decision: "keep", gate: DEFAULTS, records: 0, realFailures: 0, recallLb95: null });
    expect(d.rationale).toMatch(/no selector record/);
  });

  it("tightens at once on a single miss, to the fewest-selection gate that catches it", () => {
    const d = calibrateGate({ ...base, records: [record("a", 1.2, [0.2, 0.4, 0.8])], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
    expect(d.gate).toEqual({ cutoff: 1, unsure_below: 0.5, unsure_margin: 1 });
    expect(d.current.missed).toBe(1);
    expect(d.adopted).toMatchObject({ missed: 0, selected: 1 });
  });

  it("mutation failures justify tightening too", () => {
    const d = calibrateGate({ ...base, records: [record("m", 1.2, [0.2], "mutation")], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
  });

  it("keeps when too few real failures are observed to loosen", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, records: many(5, 2.5, [1.6]), current });
    expect(d.decision).toBe("keep");
    expect(d.gate).toEqual(current);
    expect(d.rationale).toMatch(/only 5 real failures.*at least 20/);
  });

  it("keeps when the recall lower bound misses the target (20 of 20 → 0.839 < 0.98)", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, records: many(20, 2.5, [1.6]), current });
    expect(d.decision).toBe("keep");
    expect(d.recallLb95).toBeCloseTo(0.8389, 4);
    expect(d.rationale).toMatch(/below the target 0.98/);
  });

  it("loosens when there are enough real failures and the bound meets the target; ties go to the defaults", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, recallTarget: 0.8, records: many(20, 2.5, [1.6]), current });
    expect(d.decision).toBe("loosen");
    expect(d.gate).toEqual(DEFAULTS);
    expect(d.adopted.selected).toBeLessThan(d.current.selected);
  });

  it("mutation failures never justify loosening", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, recallTarget: 0.5, minFailures: 1, records: many(30, 2.5, [1.6], "mutation"), current });
    expect(d.decision).toBe("keep");
    expect(d.realFailures).toBe(0);
  });

  it("keeps when no looser candidate avoids every miss", () => {
    const d = calibrateGate({ ...base, records: many(3, 2, [0.1]), current: DEFAULTS });
    expect(d.decision).toBe("keep");
    expect(d.rationale).toMatch(/no candidate selects fewer/);
  });

  it("reports per context digest", () => {
    const a = { ...record("a", 1.2, [0.2]), contextDigest: "sha256:aa" };
    const b = { ...record("b", 2.5, [0.2]), contextDigest: "sha256:bb" };
    const d = calibrateGate({ ...base, records: [a, b], current: DEFAULTS });
    expect(d.byDigest).toEqual([
      { contextDigest: "sha256:aa", records: 1, failures: 1, missedUnderCurrent: 1 },
      { contextDigest: "sha256:bb", records: 1, failures: 1, missedUnderCurrent: 0 },
    ]);
  });

  it("the default grid includes the defaults and a cutoff low enough to catch any scored failure", () => {
    expect(DEFAULT_GRID).toContainEqual(DEFAULTS);
    expect(Math.min(...DEFAULT_GRID.map((g) => g.cutoff))).toBeLessThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`pnpm vitest run tests/selector/calibrate-core.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/selector/calibrate-core.ts
/**
 * Selector gate calibration as a pure function: records (verdicts + the
 * failures a full run proved) and the current gate in, the adopted gate and
 * why out. "Tighten at once, loosen with care":
 *
 * - a candidate that misses any observed failure (real or mutation) is out;
 * - a miss under the current gate switches at once to the fewest-selection
 *   candidate that catches everything (tighten);
 * - selecting fewer tests (loosen) needs >= minFailures real failures and a
 *   Wilson 95% lower bound of real recall >= recallTarget;
 * - otherwise keep, and say why. Ties go to the candidate nearest the defaults.
 */
import { replaySelected, type GateValues, type ReplayVerdict } from "./replay.js";
import { wilsonLowerBound } from "./wilson.js";

export interface CalibrationRecord {
  selectorRunId: string;
  source: "real" | "mutation";
  contextDigest: string | null;
  verdicts: ReplayVerdict[];
  /** test_keys that failed in a full run on the record's head (ground truth). */
  failures: string[];
}

export interface CalibrateInput {
  records: CalibrationRecord[];
  current: GateValues;
  defaults: GateValues;
  grid?: GateValues[];
  recallTarget: number;
  minFailures: number;
}

export interface CandidateOutcome {
  gate: GateValues;
  selected: number;
  missed: number;
  realCaught: number;
  realMissed: number;
}

export interface DigestReport {
  contextDigest: string | null;
  records: number;
  failures: number;
  missedUnderCurrent: number;
}

export interface CalibrationDecision {
  decision: "tighten" | "loosen" | "keep";
  gate: GateValues;
  records: number;
  realFailures: number;
  recallLb95: number | null;
  rationale: string;
  current: CandidateOutcome;
  adopted: CandidateOutcome;
  byDigest: DigestReport[];
}

export function buildGrid(cutoffs: number[], unsureBelows: number[], unsureMargins: number[]): GateValues[] {
  return cutoffs.flatMap((cutoff) =>
    unsureBelows.flatMap((unsure_below) =>
      unsureMargins.map((unsure_margin) => ({ cutoff, unsure_below, unsure_margin }))));
}

export const DEFAULT_GRID: GateValues[] = buildGrid(
  [0.5, 1, 1.5, 2, 2.5, 3],
  [0.3, 0.5, 0.7, 0.9],
  [0, 0.5, 1, 1.5, 2],
);

const gateKey = (g: GateValues) => `${g.cutoff}/${g.unsure_below}/${g.unsure_margin}`;
const distance = (a: GateValues, b: GateValues) =>
  Math.abs(a.cutoff - b.cutoff) + Math.abs(a.unsure_below - b.unsure_below) + Math.abs(a.unsure_margin - b.unsure_margin);
const fmt = (g: GateValues) => `cutoff ${g.cutoff} / unsure_below ${g.unsure_below} / unsure_margin ${g.unsure_margin}`;

export function evaluateCandidate(records: readonly CalibrationRecord[], gate: GateValues): CandidateOutcome {
  let selected = 0, missed = 0, realCaught = 0, realMissed = 0;
  for (const r of records) {
    const flags = replaySelected(r.verdicts, gate);
    const keys = new Set<string>();
    r.verdicts.forEach((v, i) => {
      if (!flags[i]) return;
      selected++;
      if (v.testKey) keys.add(v.testKey);
    });
    for (const failure of r.failures) {
      const caught = keys.has(failure);
      if (!caught) missed++;
      if (r.source === "real") {
        if (caught) realCaught++;
        else realMissed++;
      }
    }
  }
  return { gate, selected, missed, realCaught, realMissed };
}

function pickFewest(candidates: CandidateOutcome[], defaults: GateValues): CandidateOutcome {
  return [...candidates].sort((a, b) =>
    a.selected - b.selected
    || distance(a.gate, defaults) - distance(b.gate, defaults)
    || gateKey(a.gate).localeCompare(gateKey(b.gate)))[0];
}

export function calibrateGate(input: CalibrateInput): CalibrationDecision {
  const { records, defaults } = input;
  const realFailures = records.filter((r) => r.source === "real").reduce((n, r) => n + r.failures.length, 0);
  const totalFailures = records.reduce((n, r) => n + r.failures.length, 0);
  const current = evaluateCandidate(records, input.current);
  const lb = (o: CandidateOutcome) => (realFailures === 0 ? null : wilsonLowerBound(o.realCaught, realFailures));

  const byDigest = new Map<string | null, DigestReport>();
  for (const r of records) {
    const entry = byDigest.get(r.contextDigest) ?? { contextDigest: r.contextDigest, records: 0, failures: 0, missedUnderCurrent: 0 };
    entry.records++;
    entry.failures += r.failures.length;
    entry.missedUnderCurrent += evaluateCandidate([r], input.current).missed;
    byDigest.set(r.contextDigest, entry);
  }
  const digestReports = [...byDigest.values()].sort((a, b) => String(a.contextDigest).localeCompare(String(b.contextDigest)));

  const decide = (decision: CalibrationDecision["decision"], adopted: CandidateOutcome, rationale: string): CalibrationDecision => ({
    decision, gate: adopted.gate, records: records.length, realFailures, recallLb95: lb(adopted),
    rationale, current, adopted, byDigest: digestReports,
  });

  if (records.length === 0) {
    return decide("keep", current, "no selector record has a full run on its head commit yet");
  }

  const seen = new Set<string>();
  const candidates = [...(input.grid ?? DEFAULT_GRID), input.current, defaults]
    .filter((g) => (seen.has(gateKey(g)) ? false : (seen.add(gateKey(g)), true)))
    .map((g) => evaluateCandidate(records, g));
  const feasible = candidates.filter((c) => c.missed === 0);

  if (current.missed > 0) {
    if (feasible.length === 0) {
      return decide("keep", current,
        `the current gate misses ${current.missed} of ${totalFailures} failures and no candidate in the grid catches all of them`);
    }
    const best = pickFewest(feasible, defaults);
    return decide("tighten", best,
      `the current gate (${fmt(input.current)}) missed ${current.missed} of ${totalFailures} failures; ${fmt(best.gate)} catches all of them with the fewest selected tests`);
  }

  const looser = feasible.filter((c) => c.selected < current.selected);
  if (looser.length === 0) {
    return decide("keep", current, "no candidate selects fewer tests without missing a failure");
  }
  if (realFailures < input.minFailures) {
    return decide("keep", current,
      `only ${realFailures} real failures observed; loosening needs at least ${input.minFailures}`);
  }
  const best = pickFewest(looser, defaults);
  const bound = lb(best) ?? 0;
  if (bound < input.recallTarget) {
    return {
      ...decide("keep", current,
        `recall lower bound ${bound.toFixed(3)} over ${realFailures} real failures is below the target ${input.recallTarget}`),
      recallLb95: bound,
    };
  }
  return decide("loosen", best,
    `${fmt(best.gate)} selects ${current.selected - best.selected} fewer tests and still catches all ${realFailures} real failures (recall lower bound ${bound.toFixed(3)})`);
}
```

- [ ] **Step 4: Run to verify it passes, commit**

Run: `pnpm vitest run tests/selector/calibrate-core.test.ts` → PASS.

```bash
git add src/cli/selector/calibrate-core.ts tests/selector/calibrate-core.test.ts
git commit -m "feat: decide the selector gate: tighten on any miss, loosen only on enough real evidence"
```

### Task C5: Load calibration records and ground truth from the datasets

**Files:**
- Create: `src/cli/selector/ground-truth.ts`, `tests/selector/ground-truth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/selector/ground-truth.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { loadCalibrationRecords } from "../../src/cli/selector/ground-truth.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";

const S = "tests/g.test.ts";

describe("loadCalibrationRecords", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "H", daysAgo: 1, results: [
      { suite: S, testName: "known", status: "failed" },
      { suite: S, testName: "unknown-to-selector", status: "failed" },
      { suite: S, testName: "ok", status: "passed" },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("joins verdicts to the full run on head_sha; unmatched failures are listed, not counted", async () => {
    await seedSelectorRun(store, { id: "sr1", headSha: "H", contextDigest: "sha256:aa", tests: [
      { testKey: await keyFor(store, S, "known"), file: S, titlePath: ["known"], reason: "below", selected: false, score: 0.4, confidence: 0.9 },
      { testKey: await keyFor(store, S, "ok"), file: S, titlePath: ["ok"], reason: "scored", selected: true, score: 3, confidence: 0.9 },
    ] });
    await seedSelectorRun(store, { id: "sr2", headSha: "NOFULL", tests: [] });
    const loaded = await loadCalibrationRecords(store, { selector: "jev", since: new Date(0) });
    expect(loaded.withoutFullRun).toBe(1);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0]).toMatchObject({
      selectorRunId: "sr1", source: "real", contextDigest: "sha256:aa",
      failures: [await keyFor(store, S, "known")],
    });
    expect(loaded.records[0].verdicts).toHaveLength(2);
    expect(loaded.unmatched).toEqual([
      { selectorRunId: "sr1", headSha: "H", testKey: await keyFor(store, S, "unknown-to-selector") },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`pnpm vitest run tests/selector/ground-truth.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/selector/ground-truth.ts
import type { MetricStore } from "../storage/types.js";
import type { CalibrationRecord } from "./calibrate-core.js";

export interface UnmatchedFailure {
  selectorRunId: string;
  headSha: string;
  testKey: string;
}

export interface LoadedCalibration {
  records: CalibrationRecord[];
  /** Selector runs with no full run on their head (or no head at all). */
  withoutFullRun: number;
  /** Real failures on a record's head that no verdict of that record names. */
  unmatched: UnmatchedFailure[];
}

export async function loadCalibrationRecords(
  store: MetricStore,
  opts: { selector: string; since: Date },
): Promise<LoadedCalibration> {
  const since = opts.since.toISOString().replace("T", " ").replace("Z", "");
  const verdictRows = await store.raw<{
    selector_run_id: string; source: "real" | "mutation"; context_digest: string | null; head_sha: string | null;
    test_key: string | null; score: number | null; confidence: number | null; reason: string;
  }>(
    `SELECT selector_run_id, source, context_digest, head_sha, test_key, score, confidence, reason
     FROM flaker_v1.selector_verdicts
     WHERE selector = ? AND created_at >= ?::TIMESTAMP`,
    [opts.selector, since],
  );
  const runIds = await store.raw<{ selector_run_id: string; head_sha: string | null; source: "real" | "mutation"; context_digest: string | null }>(
    `SELECT selector_run_id, head_sha, source, context_digest FROM selector_runs
     WHERE selector = ? AND created_at >= ?::TIMESTAMP ORDER BY created_at, selector_run_id`,
    [opts.selector, since],
  );
  const fullHeads = new Set((await store.raw<{ commit_sha: string }>(
    `SELECT DISTINCT commit_sha FROM flaker_v1.runs WHERE is_full AND source <> 'mutation'`,
  )).map((r) => r.commit_sha));
  const truth = new Map<string, Set<string>>();
  for (const row of await store.raw<{ commit_sha: string; test_key: string }>(
    `SELECT DISTINCT commit_sha, test_key FROM selector_ground_truth`,
  )) {
    const set = truth.get(row.commit_sha) ?? new Set<string>();
    set.add(row.test_key);
    truth.set(row.commit_sha, set);
  }

  const byRun = new Map<string, CalibrationRecord["verdicts"]>();
  for (const v of verdictRows) {
    const list = byRun.get(v.selector_run_id) ?? [];
    list.push({ testKey: v.test_key, score: v.score, confidence: v.confidence, reason: v.reason });
    byRun.set(v.selector_run_id, list);
  }

  const out: LoadedCalibration = { records: [], withoutFullRun: 0, unmatched: [] };
  for (const run of runIds) {
    if (run.head_sha === null || !fullHeads.has(run.head_sha)) {
      out.withoutFullRun++;
      continue;
    }
    const verdicts = byRun.get(run.selector_run_id) ?? [];
    const named = new Set(verdicts.map((v) => v.testKey).filter((k): k is string => k !== null));
    const failures: string[] = [];
    for (const key of [...(truth.get(run.head_sha) ?? [])].sort()) {
      if (named.has(key)) failures.push(key);
      else out.unmatched.push({ selectorRunId: run.selector_run_id, headSha: run.head_sha, testKey: key });
    }
    out.records.push({
      selectorRunId: run.selector_run_id, source: run.source, contextDigest: run.context_digest, verdicts, failures,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes, commit**

```bash
git add src/cli/selector/ground-truth.ts tests/selector/ground-truth.test.ts
git commit -m "feat: join selector runs to full runs on the same commit for calibration"
```

### Task C6: `flaker calibrate --selector`

**Files:**
- Create: `src/cli/commands/calibrate/selector.ts`, `tests/commands/calibrate-selector.test.ts`
- Modify: `src/cli/categories/calibrate.ts`, `tests/cli/calibrate-cli.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/commands/calibrate-selector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../../src/cli/config.js";
import { latestGateCalibration, runSelectorCalibration } from "../../src/cli/commands/calibrate/selector.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";

const S = "tests/c.test.ts";

describe("runSelectorCalibration", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "H", daysAgo: 1, results: [
      { suite: S, testName: "regressed", status: "failed" },
      { suite: S, testName: "fine", status: "passed" },
    ] });
    await seedSelectorRun(store, { id: "sr1", headSha: "H", tests: [
      { testKey: await keyFor(store, S, "regressed"), file: S, titlePath: ["regressed"], reason: "below", selected: false, score: 1.2, confidence: 0.9 },
      { testKey: await keyFor(store, S, "fine"), file: S, titlePath: ["fine"], reason: "below", selected: false, score: 0.2, confidence: 0.9 },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("appends a tighten row and uses it as the current gate next time", async () => {
    const first = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
    expect(first.decision.decision).toBe("tighten");
    expect(first.written).toBe(true);
    const latest = await latestGateCalibration(store, "jev");
    expect(latest).toMatchObject({ cutoff: 1, decision: "tighten", records: 1, real_failures: 1 });
    // gate_calibrations is keyed by (selector, calibrated_at): give the second run its own instant.
    const second = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false, now: new Date(Date.now() + 1000) });
    expect(second.decision.current.gate.cutoff).toBe(1);
    expect(second.decision.decision).toBe("keep");
  });

  it("--dry-run appends nothing", async () => {
    const r = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: true });
    expect(r.written).toBe(false);
    expect(await latestGateCalibration(store, "jev")).toBeNull();
  });
});
```

Append to `tests/cli/calibrate-cli.test.ts` inside its `describe`:

```ts
  it("--selector --dry-run --json reports a keep on an empty database", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate", "--selector", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { selector: string; decision: { decision: string }; written: boolean };
    expect(out).toMatchObject({ selector: "jev", decision: { decision: "keep" }, written: false });
  });

  it("--selector with another name exits 2", () => {
    const res = spawnSync("node", [CLI, "calibrate", "--selector", "other"], { cwd: repo(), encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("bare calibrate still writes [sampling] and touches no gate", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(JSON.parse(res.stdout).sampling.strategy).toBe("hybrid");
  });
```

- [ ] **Step 2: Run to verify they fail** (`pnpm vitest run tests/commands/calibrate-selector.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/commands/calibrate/selector.ts
import { DEFAULT_CUTOFF, DEFAULT_UNSURE_BELOW, DEFAULT_UNSURE_MARGIN } from "jev-test-filter/gate";
import type { MetricStore } from "../../storage/types.js";
import type { SelectorConfig } from "../../config.js";
import { resolveSelectorTestKeys } from "../../selector/store.js";
import { loadCalibrationRecords, type UnmatchedFailure } from "../../selector/ground-truth.js";
import { calibrateGate, type CalibrationDecision } from "../../selector/calibrate-core.js";
import type { GateValues } from "../../selector/replay.js";
import { FLAKER_V1_SCHEMAS, type FlakerV1GateCalibrationRow } from "../../contracts/flaker-v1-datasets.js";
import { normalizeRow } from "../../datasets/serialize.js";

/** jev's own defaults, single-sourced from jev-test-filter/gate. */
export const JEV_DEFAULT_GATE: GateValues = {
  cutoff: DEFAULT_CUTOFF,
  unsure_below: DEFAULT_UNSURE_BELOW,
  unsure_margin: DEFAULT_UNSURE_MARGIN,
};

export async function latestGateCalibration(
  store: MetricStore,
  selector: string,
): Promise<FlakerV1GateCalibrationRow | null> {
  const [row] = await store.raw<Record<string, unknown>>(
    `SELECT * FROM flaker_v1.gate_calibration WHERE selector = ? ORDER BY calibrated_at DESC LIMIT 1`,
    [selector],
  );
  return row ? (normalizeRow(row, FLAKER_V1_SCHEMAS.gate_calibration) as unknown as FlakerV1GateCalibrationRow) : null;
}

export interface SelectorCalibrationResult {
  selector: string;
  calibratedAt: string;
  decision: CalibrationDecision;
  withoutFullRun: number;
  unmatched: UnmatchedFailure[];
  written: boolean;
}

export async function runSelectorCalibration(opts: {
  store: MetricStore;
  selector: SelectorConfig;
  windowDays: number;
  dryRun: boolean;
  now?: Date;
}): Promise<SelectorCalibrationResult> {
  const now = opts.now ?? new Date();
  const name = opts.selector.type;
  await resolveSelectorTestKeys(opts.store);
  const latest = await latestGateCalibration(opts.store, name);
  const current: GateValues = latest
    ? { cutoff: latest.cutoff, unsure_below: latest.unsure_below, unsure_margin: latest.unsure_margin }
    : JEV_DEFAULT_GATE;
  const loaded = await loadCalibrationRecords(opts.store, {
    selector: name,
    since: new Date(now.getTime() - opts.windowDays * 86_400_000),
  });
  const decision = calibrateGate({
    records: loaded.records,
    current,
    defaults: JEV_DEFAULT_GATE,
    recallTarget: opts.selector.recall_target,
    minFailures: opts.selector.min_failures,
  });
  if (!opts.dryRun) {
    await opts.store.raw(
      `INSERT INTO gate_calibrations (selector, calibrated_at, cutoff, unsure_below, unsure_margin, records, real_failures, recall_lb95, decision, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, now, decision.gate.cutoff, decision.gate.unsure_below, decision.gate.unsure_margin,
        decision.records, decision.realFailures, decision.recallLb95, decision.decision, decision.rationale,
      ],
    );
  }
  return {
    selector: name, calibratedAt: now.toISOString(), decision,
    withoutFullRun: loaded.withoutFullRun, unmatched: loaded.unmatched, written: !opts.dryRun,
  };
}

const g = (v: GateValues) => `cutoff ${v.cutoff} / unsure_below ${v.unsure_below} / unsure_margin ${v.unsure_margin}`;

export function formatSelectorCalibration(r: SelectorCalibrationResult): string {
  const d = r.decision;
  const lines = [
    `Selector gate calibration (${r.selector})`,
    `  records with a full run:  ${d.records} (${r.withoutFullRun} without one)`,
    `  real failures:            ${d.realFailures}`,
    `  current gate:             ${g(d.current.gate)} → selected ${d.current.selected}, missed ${d.current.missed}`,
    `  decision:                 ${d.decision} → ${g(d.gate)} (selected ${d.adopted.selected}, missed ${d.adopted.missed})`,
    `  recall lower bound (95%): ${d.recallLb95 === null ? "n/a" : d.recallLb95.toFixed(3)}`,
    `  rationale:                ${d.rationale}`,
  ];
  if (d.byDigest.length > 1) {
    lines.push("  by context digest:");
    for (const b of d.byDigest) {
      lines.push(`    ${b.contextDigest ?? "(none)"}  records ${b.records}  failures ${b.failures}  missed under current ${b.missedUnderCurrent}`);
    }
  }
  if (r.unmatched.length > 0) {
    lines.push(`  unmatched failures:       ${r.unmatched.length} (not counted as misses)`);
    for (const u of r.unmatched.slice(0, 20)) lines.push(`    ${u.testKey} at ${u.headSha}`);
  }
  lines.push(r.written
    ? "Appended to gate_calibration. Run `flaker export --projection jev-context -o .flaker/context.json` to hand it to jev-test-filter."
    : "Dry run: gate_calibration was not changed.");
  return lines.join("\n");
}
```

Replace `src/cli/categories/calibrate.ts`'s `CalibrateCliOpts`, `calibrateAction` entry and registration:

```ts
import { FlakerUsageError } from "../errors.js";
import { resolveSelectorConfig } from "../config.js";
import { openDatasetStore } from "../datasets/open.js";
import { formatSelectorCalibration, runSelectorCalibration } from "../commands/calibrate/selector.js";

export interface CalibrateCliOpts {
  windowDays: string;
  dryRun?: boolean;
  json?: boolean;
  /** true for a bare `--selector`, the name for `--selector <name>`. */
  selector?: string | boolean;
}

export async function calibrateAction(opts: CalibrateCliOpts): Promise<void> {
  if (opts.selector !== undefined) {
    await selectorCalibrateAction(opts);
    return;
  }
  // … the existing body, unchanged …
}

async function selectorCalibrateAction(opts: CalibrateCliOpts): Promise<void> {
  const windowDays = parsePositiveIntOption("--window-days", opts.windowDays);
  if (windowDays == null) {
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const selector = resolveSelectorConfig(config);
  if (typeof opts.selector === "string" && opts.selector !== selector.type) {
    throw new FlakerUsageError(`unknown selector "${opts.selector}"; configured selector is "${selector.type}"`);
  }
  const store = await openDatasetStore(cwd, config);
  try {
    const result = await runSelectorCalibration({ store, selector, windowDays, dryRun: opts.dryRun === true });
    if (opts.json) {
      console.log(JSON.stringify({
        selector: result.selector,
        calibrated_at: result.calibratedAt,
        decision: result.decision,
        without_full_run: result.withoutFullRun,
        unmatched: result.unmatched,
        written: result.written,
      }, null, 2));
    } else {
      console.log(formatSelectorCalibration(result));
    }
  } finally {
    await store.close();
  }
}

export function registerCalibrateCommand(program: Command): void {
  program
    .command("calibrate")
    .description("Recommend [sampling] from history and write it to flaker.toml; with --selector, calibrate the selector gate")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--selector [name]", "Calibrate the selector's gate (jev) from its records and full runs; appends to gate_calibration")
    .option("--dry-run", "Report without writing flaker.toml or gate_calibration")
    .option("--json", "Output as JSON")
    .action(calibrateAction);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/commands/calibrate-selector.test.ts` → PASS. `pnpm build && pnpm vitest run tests/cli/calibrate-cli.test.ts` → PASS. `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/calibrate src/cli/categories/calibrate.ts tests/commands/calibrate-selector.test.ts tests/cli/calibrate-cli.test.ts
git commit -m "feat: add calibrate --selector, appending the adopted gate to gate_calibration"
```

### Task C7: `jev-context` v1 contract and the pure projection

**Files:**
- Create: `src/cli/contracts/jev-context-v1.ts`, `src/cli/contracts/jev-compat.ts`, `src/cli/projections/jev-context.ts`, `tests/projections/jev-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/projections/jev-context.test.ts
import { describe, expect, it } from "vitest";
import { buildJevContext, type JevContextInput } from "../../src/cli/projections/jev-context.js";
import { JEV_CONTEXT_V1_SCHEMA } from "../../src/cli/contracts/jev-context-v1.js";
import { validator } from "../contracts/ajv.js";

const t = (key: string, file: string, title_path: string[], project?: string) => ({
  test_key: key, file, title_path, variant: project ? { project } : null,
});

function input(over: Partial<JevContextInput> = {}): JevContextInput {
  return {
    tests: [
      t("init", "tests/cli/init.test.ts", ["init", "writes toml"]),
      t("login", "e2e/login.spec.ts", ["login", "shows form"], "chromium"),
      t("flaky", "tests/f.test.ts", ["f"]),
      t("q", "tests/a.test.ts", ["A", "b"]),
    ],
    quarantine: [{ test_key: "q" }],
    flaky: [{ test_key: "flaky", is_flaky: true }, { test_key: "init", is_flaky: false }],
    misses: [{ test_key: "init", selector_run_id: "s1" }, { test_key: "init", selector_run_id: "s2" }],
    co_failures: [
      ...["a", "b", "c", "d", "e", "f"].map((f, i) => ({ changed_file: `src/${f}.ts`, test_key: "init", co_failures: 2 + i, strength: 0.5 })),
      { changed_file: "src/cli/config.ts", test_key: "init", co_failures: 3, strength: 0.9 },
      { changed_file: "src/one-off.ts", test_key: "login", co_failures: 1, strength: 1 },
      { changed_file: "src/auth.ts", test_key: "login", co_failures: 2, strength: 0.4 },
      { changed_file: "src/x.ts", test_key: "flaky", co_failures: 9, strength: 1 },
      { changed_file: "src/x.ts", test_key: "q", co_failures: 9, strength: 1 },
    ],
    gate: { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1, records: 42, real_failures: 17, recall_lb95: 0.83 },
    generatedAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

describe("buildJevContext", () => {
  it("builds skip from quarantine and hints from misses and co_failures", () => {
    const ctx = buildJevContext(input());
    expect(ctx.version).toBe(1);
    expect(ctx.gate).toEqual({ cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1, basis: { records: 42, real_failures: 17, recall_lb95: 0.83 } });
    expect(ctx.skip).toEqual([{ file: "tests/a.test.ts", title_path: ["A", "b"], reason: "quarantined" }]);
    expect(ctx.tests).toEqual([
      {
        file: "tests/cli/init.test.ts", title_path: ["init", "writes toml"], missed: 2,
        failed_with: ["src/cli/config.ts", "src/f.ts", "src/e.ts", "src/d.ts", "src/c.ts"],
      },
      { file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "chromium", failed_with: ["src/auth.ts"] },
    ]);
    expect(validator(JEV_CONTEXT_V1_SCHEMA)(ctx)).toBeNull();
  });

  it("caps hinted tests, keeping the most missed first", () => {
    const ctx = buildJevContext(input({ limits: { maxHintedTests: 1 } }));
    expect(ctx.tests.map((x) => x.file)).toEqual(["tests/cli/init.test.ts"]);
  });

  it("gate is null without a calibration", () => {
    expect(buildJevContext(input({ gate: null })).gate).toBeNull();
  });

  it("digest covers skip and tests only, and ignores input row order", () => {
    const a = buildJevContext(input());
    const b = buildJevContext(input({
      co_failures: [...input().co_failures].reverse(),
      misses: [...input().misses].reverse(),
      gate: null,
      generatedAt: "2030-01-01T00:00:00.000Z",
    }));
    expect(b.digest).toBe(a.digest);
    expect(a.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const c = buildJevContext(input({ quarantine: [] }));
    expect(c.digest).not.toBe(a.digest);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`pnpm vitest run tests/projections/jev-context.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/contracts/jev-context-v1.ts
/**
 * `jev-context` v1: what flaker hands jev-test-filter (`--context <file>`).
 * Produced by `flaker export --projection jev-context`. A test is named by
 * file + title_path (+ project), never by jev's line-bearing testId.
 * `digest` = "sha256:" + sha256(canonical JSON of { skip, tests }).
 */
import { NUM, NUM_OR_NULL, INT, STR, STRINGS, TIME, type JsonSchema } from "./json-schema.js";

export interface JevContextGateV1 {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
  basis: { records: number; real_failures: number; recall_lb95: number | null };
}
export interface JevContextNameV1 { file: string; title_path: string[]; project?: string }
export interface JevContextSkipV1 extends JevContextNameV1 { reason: "quarantined" }
export interface JevContextTestV1 extends JevContextNameV1 { failed_with: string[]; missed?: number }
export interface JevContextV1 {
  version: 1;
  digest: string;
  generated_at: string;
  gate: JevContextGateV1 | null;
  skip: JevContextSkipV1[];
  tests: JevContextTestV1[];
}

const NAME = { file: { type: "string", minLength: 1 }, title_path: STRINGS, project: STR };

export const JEV_CONTEXT_V1_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/mizchi/flaker/contracts/jev-context-v1.json",
  title: "flaker jev-context v1",
  type: "object",
  required: ["version", "digest", "gate", "skip", "tests"],
  properties: {
    version: { const: 1 },
    digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    generated_at: TIME,
    gate: {
      type: ["object", "null"],
      required: ["cutoff", "unsure_below", "unsure_margin", "basis"],
      properties: {
        cutoff: NUM, unsure_below: NUM, unsure_margin: NUM,
        basis: {
          type: "object", required: ["records", "real_failures", "recall_lb95"],
          properties: { records: INT, real_failures: INT, recall_lb95: NUM_OR_NULL },
        },
      },
    },
    skip: {
      type: "array",
      items: { type: "object", required: ["file", "title_path", "reason"], properties: { ...NAME, reason: { const: "quarantined" } } },
    },
    tests: {
      type: "array",
      items: {
        type: "object", required: ["file", "title_path", "failed_with"],
        properties: { ...NAME, failed_with: { ...STRINGS, maxItems: 5 }, missed: INT },
      },
    },
  },
};
```

```ts
// src/cli/contracts/jev-compat.ts
/**
 * Compile-time check that flaker's jev-context is what jev-test-filter
 * reads. Not exported from the package (its .d.ts would reference a
 * devDependency). `pnpm typecheck` fails if the shapes diverge.
 */
import type { JevContext } from "jev-test-filter/types";
import type { JevContextV1 } from "./jev-context-v1.js";

type Assignable<A, B> = A extends B ? true : false;
export const JEV_CONTEXT_COMPATIBLE: Assignable<JevContextV1, JevContext> = true;
```

```ts
// src/cli/projections/jev-context.ts
import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import type {
  JevContextNameV1, JevContextSkipV1, JevContextTestV1, JevContextV1,
} from "../contracts/jev-context-v1.js";

export const MAX_FILES_PER_TEST = 5;
export const DEFAULT_MAX_HINTED_TESTS = 200;
/** One co-failure on a multi-file commit cannot tell the file from its siblings. */
export const MIN_CO_FAILURES_FOR_HINT = 2;

export interface JevContextInput {
  tests: Array<{ test_key: string; file: string; title_path: string[]; variant: Record<string, string> | null }>;
  quarantine: Array<{ test_key: string }>;
  flaky: Array<{ test_key: string; is_flaky: boolean }>;
  misses: Array<{ test_key: string; selector_run_id: string }>;
  co_failures: Array<{ changed_file: string; test_key: string; co_failures: number; strength: number }>;
  gate: {
    cutoff: number; unsure_below: number; unsure_margin: number;
    records: number; real_failures: number; recall_lb95: number | null;
  } | null;
  generatedAt: string;
  limits?: { maxFilesPerTest?: number; maxHintedTests?: number; minCoFailures?: number };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nameKey = (n: JevContextNameV1) => `${n.file}\u001f${n.title_path.join("\u001f")}\u001e${n.project ?? ""}`;

export function buildJevContext(input: JevContextInput): JevContextV1 {
  const maxFiles = input.limits?.maxFilesPerTest ?? MAX_FILES_PER_TEST;
  const maxTests = input.limits?.maxHintedTests ?? DEFAULT_MAX_HINTED_TESTS;
  const minCo = input.limits?.minCoFailures ?? MIN_CO_FAILURES_FOR_HINT;

  const names = new Map<string, JevContextNameV1>();
  for (const t of input.tests) {
    const project = t.variant?.project;
    names.set(t.test_key, { file: t.file, title_path: [...t.title_path], ...(project ? { project } : {}) });
  }
  const quarantined = new Set(input.quarantine.map((q) => q.test_key));
  const flaky = new Set(input.flaky.filter((f) => f.is_flaky).map((f) => f.test_key));

  const skip: JevContextSkipV1[] = [...quarantined]
    .flatMap((key) => {
      const n = names.get(key);
      return n ? [{ ...n, reason: "quarantined" as const }] : [];
    })
    .sort((a, b) => cmp(nameKey(a), nameKey(b)));

  const missed = new Map<string, Set<string>>();
  for (const m of input.misses) {
    const set = missed.get(m.test_key) ?? new Set<string>();
    set.add(m.selector_run_id);
    missed.set(m.test_key, set);
  }
  const hints = new Map<string, Array<{ file: string; co: number; strength: number }>>();
  for (const c of input.co_failures) {
    if (c.co_failures < minCo) continue;
    const list = hints.get(c.test_key) ?? [];
    list.push({ file: c.changed_file, co: c.co_failures, strength: c.strength });
    hints.set(c.test_key, list);
  }

  const candidates = [...new Set([...missed.keys(), ...hints.keys()])]
    .filter((key) => !quarantined.has(key) && !flaky.has(key) && names.has(key))
    .map((key) => {
      const files = (hints.get(key) ?? [])
        .sort((a, b) => b.strength - a.strength || b.co - a.co || cmp(a.file, b.file));
      return {
        key,
        name: names.get(key)!,
        missed: missed.get(key)?.size ?? 0,
        best: files[0]?.strength ?? 0,
        failedWith: files.slice(0, maxFiles).map((f) => f.file),
      };
    })
    .filter((c) => c.missed > 0 || c.failedWith.length > 0)
    .sort((a, b) => b.missed - a.missed || b.best - a.best || cmp(nameKey(a.name), nameKey(b.name)))
    .slice(0, maxTests);

  const tests: JevContextTestV1[] = candidates.map((c) => ({
    ...c.name,
    failed_with: c.failedWith,
    ...(c.missed > 0 ? { missed: c.missed } : {}),
  }));

  return {
    version: 1,
    digest: `sha256:${sha256Hex(canonicalJson({ skip, tests }))}`,
    generated_at: input.generatedAt,
    gate: input.gate === null ? null : {
      cutoff: input.gate.cutoff,
      unsure_below: input.gate.unsure_below,
      unsure_margin: input.gate.unsure_margin,
      basis: { records: input.gate.records, real_failures: input.gate.real_failures, recall_lb95: input.gate.recall_lb95 },
    },
    skip,
    tests,
  };
}
```

Order check for the test: init's co-failures are config.ts (0.9, 3) and then a–f (all strength 0.5, co 2..7). They sort by co desc, giving f(7), e(6), d(5), c(4), b(3), a(2). Top 5: config, f, e, d, c. That matches the expected array. Key order in the expected objects does not matter for `toEqual`.

- [ ] **Step 4: Run to verify it passes, typecheck the compat file**

Run: `pnpm vitest run tests/projections/jev-context.test.ts` → PASS. `pnpm typecheck` → clean (fails if `JevContextV1` is not assignable to jev's `JevContext`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/contracts/jev-context-v1.ts src/cli/contracts/jev-compat.ts src/cli/projections/jev-context.ts tests/projections
git commit -m "feat: build the jev-context projection with capped hints and a stable digest"
```

### Task C8: `flaker export --projection jev-context`

**Files:**
- Create: `src/cli/projections/index.ts`
- Modify: `src/cli/categories/export.ts`, `tests/cli/export-cli.test.ts`
- Test: `tests/projections/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/projections/registry.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../../src/cli/config.js";
import { runProjection } from "../../src/cli/projections/index.js";
import { memoryStore, seedRun } from "../datasets/helpers.js";

describe("runProjection", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("builds jev-context from the datasets", async () => {
    await seedRun(store, { id: 1, commitSha: "c", daysAgo: 1, results: [
      { suite: "tests/q.test.ts", testName: "q", titlePath: ["q"], status: "failed" },
    ] });
    await store.addQuarantine({ suite: "tests/q.test.ts", testName: "q" }, "manual");
    const ctx = await runProjection("jev-context", store, { selector: DEFAULT_SELECTOR, now: new Date("2026-09-24T00:00:00Z") });
    expect(ctx).toMatchObject({ version: 1, gate: null, skip: [{ file: "tests/q.test.ts", title_path: ["q"], reason: "quarantined" }], tests: [] });
  });

  it("rejects an unknown projection", async () => {
    await expect(runProjection("nope", store, { selector: DEFAULT_SELECTOR })).rejects.toThrow(/Unknown projection/);
  });
});
```

Append to `tests/cli/export-cli.test.ts`:

```ts
  it("--projection jev-context writes a v1 context", () => {
    const dir = repo();
    const res = run(dir, "--projection", "jev-context");
    expect(res.status).toBe(0);
    const ctx = JSON.parse(res.stdout);
    expect(ctx.version).toBe(1);
    expect(ctx.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("--projection with a dataset, or with a non-json format, exits 2", () => {
    const dir = repo();
    expect(run(dir, "tests", "--projection", "jev-context").status).toBe(2);
    expect(run(dir, "--projection", "jev-context", "--format", "csv").status).toBe(2);
  });
```

- [ ] **Step 2: Run to verify they fail** (`pnpm vitest run tests/projections/registry.test.ts`)

- [ ] **Step 3: Implement**

```ts
// src/cli/projections/index.ts
import type { MetricStore } from "../storage/types.js";
import type { SelectorConfig } from "../config.js";
import { FlakerUsageError } from "../errors.js";
import { readDataset } from "../datasets/read.js";
import { resolveSelectorTestKeys } from "../selector/store.js";
import { latestGateCalibration } from "../commands/calibrate/selector.js";
import { buildJevContext, type JevContextInput } from "./jev-context.js";

export const PROJECTION_NAMES = ["jev-context"] as const;

export async function runProjection(
  name: string,
  store: MetricStore,
  opts: { selector: SelectorConfig; now?: Date },
): Promise<unknown> {
  if (name !== "jev-context") {
    throw new FlakerUsageError(`Unknown projection "${name}". Expected one of: ${PROJECTION_NAMES.join(", ")}`);
  }
  await resolveSelectorTestKeys(store);
  const [tests, quarantine, flaky, misses, coFailures, latest] = await Promise.all([
    readDataset(store, "tests"),
    readDataset(store, "quarantine"),
    readDataset(store, "flaky"),
    readDataset(store, "misses"),
    readDataset(store, "co_failures"),
    latestGateCalibration(store, opts.selector.type),
  ]);
  return buildJevContext({
    tests: tests as unknown as JevContextInput["tests"],
    quarantine: quarantine as unknown as JevContextInput["quarantine"],
    flaky: flaky as unknown as JevContextInput["flaky"],
    misses: misses as unknown as JevContextInput["misses"],
    co_failures: coFailures as unknown as JevContextInput["co_failures"],
    gate: latest,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    limits: { maxHintedTests: opts.selector.max_hinted_tests },
  });
}
```

(`latest` is a `FlakerV1GateCalibrationRow`. It has every field `JevContextInput["gate"]` needs, plus more, so it is assignable.)

`Promise.all` over one DuckDB connection: the `duckdb` binding serializes statements on a connection, so this is safe. If a test shows interleaving errors, switch to sequential `await`s.

Update `src/cli/categories/export.ts`:

```ts
import { resolveSelectorConfig } from "../config.js";
import { runProjection, PROJECTION_NAMES } from "../projections/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ExportCliOpts {
  format: string;
  since?: string;
  where?: string;
  output?: string;
  projection?: string;
}

export async function exportAction(dataset: string | undefined, opts: ExportCliOpts): Promise<void> {
  const cwd = process.cwd();
  if (opts.projection !== undefined) {
    if (dataset) throw new FlakerUsageError("--projection does not take a dataset");
    if (opts.format !== "json") throw new FlakerUsageError("--projection writes JSON; drop --format");
    if (opts.since !== undefined || opts.where !== undefined) throw new FlakerUsageError("--since and --where apply to datasets, not projections");
    const config = loadConfig(cwd);
    const store = await openDatasetStore(cwd, config);
    try {
      const out = await runProjection(opts.projection, store, { selector: resolveSelectorConfig(config) });
      const text = `${JSON.stringify(out, null, 2)}\n`;
      if (opts.output) {
        const path = resolve(opts.output);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
        process.stderr.write(`Wrote ${opts.projection} to ${opts.output}\n`);
      } else {
        process.stdout.write(text);
      }
    } finally {
      await store.close();
    }
    return;
  }
  // … the dataset branch from Task A10, unchanged …
}
```

In `registerExportCommand`, change the description to `"Write a public dataset (flaker_v1) or a projection"` and add:

```ts
    .option("--projection <name>", `Emit a projection instead of a dataset: ${PROJECTION_NAMES.join(", ")}`)
```

"--format with a projection" check: `opts.format` defaults to `"json"`, so `--format csv` is what fails. That is enough.

In `src/cli/main.ts` help, change the export line to:

```
  export <dataset> | export --projection <name> Write a public dataset (flaker_v1) or a projection
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/projections` → PASS. `pnpm build && pnpm vitest run tests/cli/export-cli.test.ts tests/cli/surface-reduction.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/projections/index.ts src/cli/categories/export.ts src/cli/main.ts tests/projections/registry.test.ts tests/cli/export-cli.test.ts
git commit -m "feat: add export --projection jev-context"
```

### Task C9: End-to-end loop: import → calibrate → export → jev replay

**Files:**
- Create: `tests/integration-test-db.test.ts`

The spec suggests the `dev eval-fixture` tooling for this. That generator targets sampling strategies and has no notion of selector records, so this test builds a small fixture by hand. It is short enough to read in full.

- [ ] **Step 1: Write the test**

```ts
// tests/integration-test-db.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRecord, replay } from "jev-test-filter";
import { gateOptions } from "jev-test-filter/gate";
import type { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../src/cli/config.js";
import { runImport } from "../src/cli/commands/import/report.js";
import { runImportSelector } from "../src/cli/commands/import/selector.js";
import { runSelectorCalibration } from "../src/cli/commands/calibrate/selector.js";
import { runProjection } from "../src/cli/projections/index.js";
import type { JevContextV1 } from "../src/cli/contracts/jev-context-v1.js";
import { JEV_CONTEXT_V1_SCHEMA } from "../src/cli/contracts/jev-context-v1.js";
import { validator } from "./contracts/ajv.js";
import { memoryStore } from "./datasets/helpers.js";

const REPORT = resolve(import.meta.dirname, "fixtures/vitest-init-report.json");
const HEAD = "c0ffee0000000000000000000000000000000002";

describe("test-db loop", () => {
  let store: DuckDBStore;
  let dir: string;
  beforeEach(async () => {
    store = await memoryStore();
    dir = mkdtempSync(join(tmpdir(), "flaker-loop-"));
  });
  afterEach(async () => {
    await store.close();
  });

  it("a miss tightens the gate, the context carries it, and jev's replay then selects the test", async () => {
    // Two full CI runs (earlier commit and HEAD) where config.ts changed and `init writes toml` failed.
    for (const sha of ["b0000000000000000000000000000000000000001", HEAD]) {
      await store.insertCommitChanges(sha, [{ filePath: "src/cli/config.ts", changeType: "modified", additions: 1, deletions: 0 }]);
      await runImport({ store, filePath: REPORT, adapterType: "vitest", commitSha: sha, branch: "main", source: "ci", workflowName: "ci" });
      // runImport uses Date.now() as the run id; keep the two runs distinct.
      await new Promise((r) => setTimeout(r, 5));
    }
    // jev judged HEAD and left the failing test out.
    const record = {
      version: 2, createdAt: new Date().toISOString(), base: "origin/main",
      head_sha: HEAD, base_sha: null, context_digest: null,
      gate: { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 }, framework: "vitest",
      tests: [
        { file: "tests/init.test.ts", titlePath: ["init", "writes toml"], line: 3, endLine: 5, framework: "vitest", dynamic: false },
        { file: "tests/init.test.ts", titlePath: ["init", "reads toml"], line: 7, endLine: 9, framework: "vitest", dynamic: false },
      ],
      touched: [], quarantined: [],
      answers: { q0000: { value: 1.2, confidence: 0.9 }, q0001: { value: 0.2, confidence: 0.9 } },
      fallback: null,
    };
    const recordPath = join(dir, `${HEAD}.json`);
    writeFileSync(recordPath, JSON.stringify(record));

    const imported = await runImportSelector({ store, path: recordPath, adapter: "jev" });
    expect(imported).toMatchObject({ imported: 1, resolved: 2, unresolved: 0 });

    const misses = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.misses`);
    expect(misses[0].n).toBe(1);

    const cal = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
    expect(cal.decision.decision).toBe("tighten");
    expect(cal.decision.gate.cutoff).toBe(1);

    const ctx = (await runProjection("jev-context", store, { selector: DEFAULT_SELECTOR })) as JevContextV1;
    expect(validator(JEV_CONTEXT_V1_SCHEMA)(ctx)).toBeNull();
    expect(ctx.gate).toMatchObject({ cutoff: 1, basis: { records: 1, real_failures: 1 } });
    expect(ctx.tests).toEqual([
      { file: "tests/init.test.ts", title_path: ["init", "writes toml"], failed_with: ["src/cli/config.ts"], missed: 1 },
    ]);

    // jev, given the context's gate, now selects the test it missed.
    const again = replay(await loadRecord(recordPath), gateOptions(ctx.gate));
    expect(again.verdicts.find((v) => v.test.titlePath[1] === "writes toml")?.selected).toBe(true);
  });
});
```

`gateOptions(ctx.gate)` receives a `JevContextGateV1`. It only reads `cutoff`, `unsure_below` and `unsure_margin`, which is the same shape jev's `RecordGate` uses.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/integration-test-db.test.ts`
Expected: PASS. Each earlier task has its own tests, so a failure here points at a seam between them. Typical seams are `is_full` (both runs have the same two tests, so both are full), key matching (vitest `titlePath` from Task A2), and `co_failures ≥ 2` (two commits changed `config.ts`). Debug with `store.raw("SELECT * FROM flaker_v1.<view>")` before changing code.

- [ ] **Step 3: Full verification and commit**

```bash
pnpm build && pnpm test && pnpm typecheck
git add tests/integration-test-db.test.ts
git commit -m "test: cover the import, calibrate, export and jev replay loop end to end"
```

### Task C10: Publish the context contract, docs, CHANGELOG, PR

- [ ] **Step 1:** Add `./contracts/jev-context-v1` to `package.json` `exports` and `src/cli/contracts/jev-context-v1.ts` to `tsconfig.reporting.json` `files`. Do **not** add `jev-compat.ts`.
- [ ] **Step 2:** Docs (`docs/how-to-use.md` and `.ja.md`): a `### Selector calibration with jev-test-filter` section with the loop:

```bash
jev-test-filter --context .flaker/context.json …        # writes .jev-test-filter/records/<sha>.json
flaker import .jev-test-filter --adapter jev
flaker import --ci                                       # full runs on the same commits
flaker calibrate --selector                              # appends to gate_calibration
flaker export --projection jev-context -o .flaker/context.json
```

State the adoption rule in one paragraph. Put the numbers from open question 2 in the docs as they are: with the defaults, loosening needs about 189 real failures. Document `[selector]`, and say that gate values are never kept in `flaker.toml`.
- [ ] **Step 3:** CHANGELOG `### Added`: `flaker calibrate --selector [name]`, `flaker export --projection jev-context`, `[selector]` (`recall_target`, `min_failures`, `max_hinted_tests`), `@mizchi/flaker/contracts/jev-context-v1`. Add a `### Requires` line saying jev-test-filter 0.1.3 or later is needed to read the context.
- [ ] **Step 4:** Verify and commit:

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm pack:check
git add package.json tsconfig.reporting.json CHANGELOG.md docs/how-to-use.md docs/how-to-use.ja.md
git commit -m "docs: document selector calibration and the jev-context projection"
```

- [ ] **Step 5:** PR `feat: selector gate calibration and jev-context (test-db phase 2c)`, only when asked to push. After merge, release `0.14.0` with the `flaker-manual-release` skill.

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Nine `flaker_v1` datasets as views, shared `test_key` | A5, A6, A7 |
| JSON Schema per dataset in contracts, fixtures validate | A8 |
| `runs.is_full` from `[workflow_lanes]` `full = true`, else ≥ 95% | A3, A5 |
| `flaker export <dataset> --format json|jsonl|csv|parquet --since --where -o` | A9, A10 |
| `flaker export --projection jev-context` (no `context` command) | C8 |
| `selector-record` v1 (score / confidence / reason / selected, shas, digest, gate) | B2 |
| `import --adapter selector-record` / `--adapter jev` (v2 → selector-record, reads v1) | B3, B6 |
| jev notes: `digest` verbatim, `quarantined` testIds, question ids / testIds mapped through `tests[index]`, v1 nulls | B3 (gate + `record.tests`), C7 (digest computed by flaker) |
| Calibrate join: full run on `head_sha`, ground truth − flaky − quarantine, unmatched reported and not counted | A7 (`selector_ground_truth`, `misses`), C5 |
| Replay over the grid with jev's `./gate`, offline | C3, C4 |
| Adoption: reject any miss, tighten at once, loosen with `min_failures` + Wilson ≥ `recall_target`, keep with rationale, ties → defaults, mutations never loosen | C2, C4 |
| Output: append to `gate_calibration`, `--dry-run` appends nothing, `--json` | C6 |
| Report split by digest | C4 (`byDigest`), C6 (text) |
| Hints: `failed_with` top 5, ≤ 200 hinted tests, `missed`, skip from quarantine, gate from latest calibration | C7, C8 |
| `digest` = sha256 of normalized `skip` + `tests`, excluding `gate` | C7 |
| `[selector]` config; gate values not in `flaker.toml` | C1 |
| End to end loop | C9 |
| `flaker query` default search path `flaker_v1` + `--internal` | **Deferred to phase 3** (open question 3) |
| Mutation evaluation (`calibrate --mutate`) | Out of scope (phase 4); the data model (`source = mutation`) and the "never loosens" rule are in place |
