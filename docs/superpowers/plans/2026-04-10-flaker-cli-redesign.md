# flaker CLI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the flaker CLI into a two-level category hierarchy, merge `sample` into `run --dry-run`, unify `flaker.toml` unit conventions, and refresh all documentation. Ship as `0.1.0` (breaking).

**Architecture:** Split `src/cli/main.ts` (2076 lines) into nine category modules under `src/cli/categories/`, each exporting `registerXCommands(program)`. Move each command handler into `src/cli/commands/<category>/<name>.ts`. Keep top-level aliases (`init`, `run`, `kpi`, `collect`) as thin wrappers that delegate to category handlers. Config layer is rewritten with suffix-per-unit naming and a hard-fail migration error for legacy keys.

**Tech Stack:** TypeScript (pnpm v24), commander.js for CLI, vitest for tests, smol-toml for config, DuckDB for storage (untouched).

**Spec:** [docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md](../specs/2026-04-10-flaker-cli-redesign-design.md)

---

## Execution order rationale

Tasks are ordered so that the build stays green after every commit:

1. **Phase A (task 1):** Create empty categories scaffolding and wire it to main.ts. No behavior change.
2. **Phase B (tasks 2–10):** Move commands into categories one group at a time. Each task deletes the old top-level registration and registers the command under its category. After every task the CLI still builds and all existing tests pass.
3. **Phase C (tasks 11–14):** Behavior changes inside categories — merge sample into run, rename `--last` to `--days`, extend `init`, rework `confirm` exit codes.
4. **Phase D (tasks 15–16):** Top-level aliases and help layout override.
5. **Phase E (tasks 17–19):** New tests (help shape, config migration, confirm exit codes).
6. **Phase F (task 20):** Config layer rewrite. Atomically renames all keys in `config.ts`, all consumers, and the repo's own `flaker.toml`. This is the only hard-break commit.
7. **Phase G (tasks 21–27):** Documentation and release artifacts.

---

## Files touched (overview)

### Created
- `src/cli/categories/{setup,exec,collect,import,report,analyze,debug,policy,dev}.ts`
- `src/cli/commands/{setup,exec,collect,import,report,analyze,debug,policy,dev}/*.ts` (moved from flat `commands/`)
- `tests/cli/help-shape.test.ts`
- `tests/cli/config-migration.test.ts`
- `tests/cli/confirm-exit-code.test.ts`
- `docs/contributing.md`
- `CHANGELOG.md`

### Modified
- `src/cli/main.ts` (shrinks from ~2076 to ~200 lines)
- `src/cli/config.ts` (rewritten key names and loader)
- `src/cli/commands/run.ts` → `src/cli/commands/exec/run.ts` (absorbs sample.ts)
- `README.md`, `docs/how-to-use.md`, `docs/how-to-use.ja.md`, `docs/why-flaker.md`, `docs/why-flaker.ja.md`, `docs/introduce.ja.md`
- `flaker.toml` (repo dogfood config)
- `.github/workflows/ci.yml`, `.github/workflows/nightly-self-host.yml`
- `scripts/dev-cli.mjs`, `scripts/self-host-review.mjs`
- `package.json`, `moon.mod.json`, `TODO.md`

### Deleted
- `src/cli/commands/sample.ts` (merged into exec/run.ts)

---

## Task 1: Create empty category scaffolding

**Files:**
- Create: `src/cli/categories/setup.ts`, `src/cli/categories/exec.ts`, `src/cli/categories/collect.ts`, `src/cli/categories/import.ts`, `src/cli/categories/report.ts`, `src/cli/categories/analyze.ts`, `src/cli/categories/debug.ts`, `src/cli/categories/policy.ts`, `src/cli/categories/dev.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Create the nine category files with empty registerXCommands**

Each file has the same shape. Write all nine now.

```typescript
// src/cli/categories/setup.ts
import type { Command } from "commander";

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Project scaffolding");

  // subcommands registered in Task 2
  void setup;
}
```

Repeat for `exec`, `collect`, `import`, `report`, `analyze`, `debug`, `policy`, `dev`. The description strings:

- `setup`: "Project scaffolding"
- `exec`: "Test selection and execution"
- `collect`: "Import history and calibration"
- `import`: "Ingest external reports"
- `report`: "Normalize and diff reports"
- `analyze`: "Read-only inspection of flaker data"
- `debug`: "Active investigation and environment checks"
- `policy`: "Enforcement and ownership"
- `dev`: "Model training and benchmarks"

- [ ] **Step 2: Wire the nine categories into main.ts**

In `src/cli/main.ts`, after `program` is constructed and before any `.command()` call, add:

```typescript
import { registerSetupCommands } from "./categories/setup.js";
import { registerExecCommands } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands } from "./categories/analyze.js";
import { registerDebugCommands } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";

// ... inside createProgram(), right after `const program = new Command()`:
registerSetupCommands(program);
registerExecCommands(program);
registerCollectCommands(program);
registerImportCommands(program);
registerReportCommands(program);
registerAnalyzeCommands(program);
registerDebugCommands(program);
registerPolicyCommands(program);
registerDevCommands(program);
```

- [ ] **Step 3: Build and verify the CLI still works**

Run: `pnpm build && node dist/cli/main.js --help`
Expected: help output identical to before plus nine new empty category entries (`setup`, `exec`, ...). All existing commands still listed at the top level.

- [ ] **Step 4: Run existing tests**

Run: `pnpm test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/categories src/cli/main.ts
git commit -m "Scaffold CLI category modules"
```

---

## Task 2: Move init and build setup category

**Files:**
- Create: `src/cli/commands/setup/init.ts`
- Delete: `src/cli/commands/init.ts` (after move)
- Modify: `src/cli/categories/setup.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move init.ts to setup/init.ts**

```bash
mkdir -p src/cli/commands/setup
git mv src/cli/commands/init.ts src/cli/commands/setup/init.ts
```

- [ ] **Step 2: Fix the import path inside setup/init.ts**

Any relative imports like `import { loadConfig } from "../config.js"` become `"../../config.js"`. Grep for `from "\.\./` and add one more `../` level.

- [ ] **Step 3: Register init under setup category**

Cut the `.command("init")` block from `src/cli/main.ts` (currently around line 345) and paste it into `src/cli/categories/setup.ts`, replacing the existing stub:

```typescript
import type { Command } from "commander";
import { runInit } from "../commands/setup/init.js";

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Project scaffolding");

  setup
    .command("init")
    .description("Create flaker.toml (auto-detects owner/name from git remote)")
    .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
    .option("--name <name>", "Repository name (auto-detected from git remote)")
    .action(async (opts) => {
      // exact body copied from the old top-level init action
      await runInit(opts);
    });
}
```

- [ ] **Step 4: Remove the old top-level `.command("init")` block from main.ts**

Delete the entire `program.command("init")...` chain from `main.ts`. Also remove the now-orphan `import { runInit } from "./commands/init.js"` at the top.

- [ ] **Step 5: Build and test**

Run: `pnpm build && node dist/cli/main.js setup init --help`
Expected: shows the init options.

Run: `pnpm test`
Expected: all existing tests pass (they do not reference `flaker init` by path).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Move init under setup category"
```

---

## Task 3: Move exec commands (run, affected) into exec category

**Files:**
- Create: `src/cli/commands/exec/run.ts`, `src/cli/commands/exec/affected.ts`, `src/cli/commands/exec/sampling-options.ts`
- Delete: `src/cli/commands/run.ts`, `src/cli/commands/affected.ts`, `src/cli/commands/sampling-options.ts` (after move)
- Keep: `src/cli/commands/sample.ts` (absorbed in Task 11)
- Modify: `src/cli/categories/exec.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move the three files**

```bash
mkdir -p src/cli/commands/exec
git mv src/cli/commands/run.ts src/cli/commands/exec/run.ts
git mv src/cli/commands/affected.ts src/cli/commands/exec/affected.ts
git mv src/cli/commands/sampling-options.ts src/cli/commands/exec/sampling-options.ts
```

- [ ] **Step 2: Fix import paths inside the three moved files**

Any relative import like `from "../..."` now needs one extra `../`. Grep each file and adjust.

Important: `exec/run.ts` imports from `../sample.js` (still at old path `commands/sample.ts`). Leave that import as `from "../sample.js"`. We'll delete sample.ts in Task 11.

- [ ] **Step 3: Register run and affected under exec category**

Cut the `.command("run")` and `.command("affected [paths...]")` blocks from `main.ts` into `src/cli/categories/exec.ts`:

```typescript
import type { Command } from "commander";
import { runTests } from "../commands/exec/run.js";
import { runAffected, formatAffectedReport } from "../commands/exec/affected.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "../commands/exec/sampling-options.js";
// plus whatever other imports the old action bodies used

export function registerExecCommands(program: Command): void {
  const exec = program
    .command("exec")
    .description("Test selection and execution");

  exec
    .command("run")
    .description("Select and run tests (auto-detects changed files and strategy from config)")
    // ... all the same .option(...) calls from the old block
    .action(async (opts) => {
      // exact body copied from the old top-level run action
    });

  exec
    .command("affected [paths...]")
    .description("Explain affected test selection for changed files")
    // ... all the same .option(...) calls
    .action(async (paths, opts) => {
      // exact body copied from the old top-level affected action
    });
}
```

The action body for `run` is long; copy it verbatim from the current `main.ts` `.command("run")` action block.

- [ ] **Step 4: Remove the old top-level `run` and `affected` blocks from main.ts**

Also remove the now-unused imports at the top of `main.ts` (`runTests`, `runAffected`, `formatAffectedReport`, `parseSampleCount`, etc.) — if another command still uses them, keep them.

- [ ] **Step 5: Build and verify both commands work**

```bash
pnpm build
node dist/cli/main.js exec run --help
node dist/cli/main.js exec affected --help
```
Expected: both show their options.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move run and affected under exec category"
```

---

## Task 4: Move collect commands into collect category

**Files:**
- Create: `src/cli/commands/collect/{ci,local,coverage,commit-changes,calibrate}.ts`
- Delete: `src/cli/commands/{collect,collect-local,collect-coverage,collect-commit-changes,calibrate}.ts` (after move)
- Modify: `src/cli/categories/collect.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move five files**

```bash
mkdir -p src/cli/commands/collect
git mv src/cli/commands/collect.ts src/cli/commands/collect/ci.ts
git mv src/cli/commands/collect-local.ts src/cli/commands/collect/local.ts
git mv src/cli/commands/collect-coverage.ts src/cli/commands/collect/coverage.ts
git mv src/cli/commands/collect-commit-changes.ts src/cli/commands/collect/commit-changes.ts
git mv src/cli/commands/calibrate.ts src/cli/commands/collect/calibrate.ts
```

- [ ] **Step 2: Fix import paths in the five moved files**

Add one `../` level to every relative import.

- [ ] **Step 3: Register all five under collect category**

Cut the five `.command(...)` blocks (`collect`, `collect-local`, `collect-coverage`, `collect-commit-changes`, `calibrate`) from `main.ts` and rewrite in `src/cli/categories/collect.ts`:

```typescript
import type { Command } from "commander";
// imports from ../commands/collect/{ci,local,coverage,commit-changes,calibrate}.js

export function registerCollectCommands(program: Command): void {
  const collect = program
    .command("collect")
    .description("Import history and calibration");

  collect
    .command("ci")
    .description("Collect workflow runs from GitHub")
    .option("--last <days>", "Number of days to look back", "30") // renamed in Task 12
    .option("--branch <branch>", "Filter by branch")
    .option("--json", "Output JSON summary")
    .option("--output <file>", "Write collect summary to a file")
    .option("--fail-on-errors", "Exit with status 1 when any workflow run fails to collect")
    .action(async (opts) => {
      // body copied from old .command("collect") action
    });

  collect
    .command("local")
    .description("Import actrun local run history into flaker")
    // ... options and action from old collect-local block

  collect
    .command("coverage")
    .description("Collect test coverage data and store edges in DuckDB")
    // ... options and action from old collect-coverage block

  collect
    .command("commit-changes")
    .description("Collect commit change data")
    // ... options and action from old collect-commit-changes block

  collect
    .command("calibrate")
    .description("Analyze project history and write optimal [sampling] config to flaker.toml")
    // ... options and action from old calibrate block
}
```

Keep `--last` for now; it is renamed to `--days` in Task 12.

- [ ] **Step 4: Remove the old top-level blocks from main.ts**

Remove `.command("collect")`, `.command("collect-local")`, `.command("collect-coverage")`, `.command("collect-commit-changes")`, `.command("calibrate")`, and any imports that are now unused.

- [ ] **Step 5: Build and verify**

```bash
pnpm build
node dist/cli/main.js collect --help
node dist/cli/main.js collect ci --help
node dist/cli/main.js collect local --help
node dist/cli/main.js collect coverage --help
node dist/cli/main.js collect commit-changes --help
node dist/cli/main.js collect calibrate --help
```
Expected: all show their options.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move collect commands under collect category"
```

---

## Task 5: Move import commands into import category

**Files:**
- Create: `src/cli/commands/import/{report,parquet}.ts`
- Delete: `src/cli/commands/import.ts`, `src/cli/commands/export-parquet.ts` (if parquet lives there)
- Modify: `src/cli/categories/import.ts`, `src/cli/main.ts`

- [ ] **Step 1: Identify the parquet import source file**

Run: `grep -l "import-parquet" src/cli/commands/*.ts`

If the parquet import logic lives in `export-parquet.ts` despite the name, that's the source. If it lives in main.ts inline, create a new file.

- [ ] **Step 2: Move the files**

```bash
mkdir -p src/cli/commands/import
git mv src/cli/commands/import.ts src/cli/commands/import/report.ts
# if parquet source exists as its own file:
git mv src/cli/commands/export-parquet.ts src/cli/commands/import/parquet.ts
```

If the parquet action body is inline in main.ts, create `src/cli/commands/import/parquet.ts` manually and move the body into an exported function `runImportParquet(args): Promise<void>`.

- [ ] **Step 3: Fix imports in moved files**

- [ ] **Step 4: Register under import category**

```typescript
// src/cli/categories/import.ts
import type { Command } from "commander";
import { runImport } from "../commands/import/report.js";
import { runImportParquet } from "../commands/import/parquet.js";

export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Ingest external reports");

  importCmd
    .command("report <file>")
    .description("Import a local test report file")
    // options from old .command("import <file>")
    .action(async (file, opts) => {
      // body from old action
    });

  importCmd
    .command("parquet <dir>")
    .description("Import flaker parquet artifacts from a directory")
    .action(async (dir) => {
      // body from old action
    });
}
```

- [ ] **Step 5: Remove old top-level `import <file>` and `import-parquet <dir>` blocks from main.ts**

- [ ] **Step 6: Build and verify**

```bash
pnpm build
node dist/cli/main.js import --help
node dist/cli/main.js import report --help
node dist/cli/main.js import parquet --help
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move import commands under import category"
```

---

## Task 6: Move report commands into report category

**Files:**
- Create: `src/cli/commands/report/index.ts` (keep as one file since report is already a group)
- Delete: `src/cli/commands/report.ts` (after move)
- Modify: `src/cli/categories/report.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move report.ts**

```bash
mkdir -p src/cli/commands/report
git mv src/cli/commands/report.ts src/cli/commands/report/index.ts
```

- [ ] **Step 2: Fix imports**

- [ ] **Step 3: Register three subcommands under report category**

Note: old `.command("report")` wraps `.command("summarize")`, `.command("diff")`, `.command("aggregate <dir>")`. In the new layout the outer `report` is the category itself and the three subcommands attach directly to it. Rename `summarize` → `summary`.

```typescript
// src/cli/categories/report.ts
import type { Command } from "commander";
import {
  runReportSummarize,
  runReportDiff,
  runReportAggregate,
  formatReportSummary,
  formatReportDiff,
  formatReportAggregate,
  formatPrComment,
  parseReportSummary,
  createReportSummaryArtifact,
  loadReportSummaryArtifactsFromDir,
} from "../commands/report/index.js";

export function registerReportCommands(program: Command): void {
  const report = program
    .command("report")
    .description("Normalize and diff reports");

  report
    .command("summary")
    .description("Summarize a normalized test report")
    // options from old .command("summarize")
    .action(async (opts) => {
      // body from old action
    });

  report
    .command("diff")
    .description("Diff two normalized reports")
    // options
    .action(async (opts) => { /* ... */ });

  report
    .command("aggregate <dir>")
    .description("Aggregate normalized reports from a directory")
    .action(async (dir, opts) => { /* ... */ });
}
```

- [ ] **Step 4: Remove old `.command("report")` group and its three subcommands from main.ts**

- [ ] **Step 5: Build and verify**

```bash
pnpm build
node dist/cli/main.js report --help
node dist/cli/main.js report summary --help
node dist/cli/main.js report diff --help
node dist/cli/main.js report aggregate --help
```

- [ ] **Step 6: Update tests that reference `report summarize`**

Run: `grep -rn "report summarize" tests/ src/ docs/`

Every match inside tests/ must be changed to `report summary`. Docs are handled in Phase G.

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move report commands under report category, rename summarize to summary"
```

---

## Task 7: Move analyze commands into analyze category

**Files:**
- Create: `src/cli/commands/analyze/{kpi,flaky,reason,insights,eval,context,query}.ts`
- Delete: `src/cli/commands/{kpi,flaky,reason,insights,eval,context,query}.ts`
- Modify: `src/cli/categories/analyze.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move seven files**

```bash
mkdir -p src/cli/commands/analyze
for f in kpi flaky reason insights eval context query; do
  git mv src/cli/commands/$f.ts src/cli/commands/analyze/$f.ts
done
```

- [ ] **Step 2: Fix imports in all seven files**

- [ ] **Step 3: Register all seven under analyze category**

```typescript
// src/cli/categories/analyze.ts
import type { Command } from "commander";
import { computeKpi } from "../commands/analyze/kpi.js";
import { runFlaky, formatFlakyTable, runFlakyTrend, formatFlakyTrend, runTrueFlaky, formatTrueFlakyTable } from "../commands/analyze/flaky.js";
import { runReason, formatReasoningReport } from "../commands/analyze/reason.js";
import { runInsights } from "../commands/analyze/insights.js";
import { runEval, renderEvalReport, runSamplingKpi, writeEvalReport } from "../commands/analyze/eval.js";
import { /* context exports */ } from "../commands/analyze/context.js";
import { runQuery, formatQueryResult } from "../commands/analyze/query.js";

export function registerAnalyzeCommands(program: Command): void {
  const analyze = program
    .command("analyze")
    .description("Read-only inspection of flaker data");

  analyze.command("kpi")
    .description("KPI dashboard — sampling effectiveness, flaky tracking, data quality")
    // options and action from old .command("kpi")

  analyze.command("flaky")
    .description("Inspect flaky tests and failure-rate trends")
    // options and action

  analyze.command("reason")
    .description("Analyze flaky tests and produce actionable recommendations")
    // options and action

  analyze.command("insights")
    .description("Compare CI vs local failure patterns to identify environment-specific issues")
    // options and action

  analyze.command("eval")
    .description("Measure whether local sampled runs predict CI")
    // options and action

  analyze.command("context")
    .description("Show environment data and strategy characteristics for decision-making")
    // options and action

  analyze.command("query <sql>")
    .description("Execute a read-only SQL query against the metrics database")
    .action(async (sql) => {
      // body from old .command("query <sql>")
    });
}
```

- [ ] **Step 4: Delete the seven old top-level blocks from main.ts**

- [ ] **Step 5: Build and verify all seven**

```bash
pnpm build
for cmd in kpi flaky reason insights eval context query; do
  node dist/cli/main.js analyze $cmd --help
done
```
Expected: all show help.

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move analysis commands under analyze category"
```

---

## Task 8: Move debug commands into debug category

**Files:**
- Create: `src/cli/commands/debug/{diagnose,bisect,confirm,confirm-local,confirm-remote,retry,doctor}.ts`
- Delete: old flat versions
- Modify: `src/cli/categories/debug.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move seven files**

```bash
mkdir -p src/cli/commands/debug
for f in diagnose bisect confirm confirm-local confirm-remote retry doctor; do
  git mv src/cli/commands/$f.ts src/cli/commands/debug/$f.ts
done
```

- [ ] **Step 2: Fix imports in all seven files**

- [ ] **Step 3: Register under debug category (keeping old confirm exit code semantics — reworked in Task 14)**

```typescript
// src/cli/categories/debug.ts
import type { Command } from "commander";
import { runDoctor, formatDoctorReport } from "../commands/debug/doctor.js";
import { runBisect } from "../commands/debug/bisect.js";
import { runRetry, formatRetryReport } from "../commands/debug/retry.js";
import { parseConfirmTarget, formatConfirmResult } from "../commands/debug/confirm.js";
import { runConfirmLocal } from "../commands/debug/confirm-local.js";
import { runConfirmRemote } from "../commands/debug/confirm-remote.js";
// diagnose: import whatever the existing diagnose action uses

export function registerDebugCommands(program: Command): void {
  const debug = program
    .command("debug")
    .description("Active investigation and environment checks");

  debug.command("diagnose")
    .description("Diagnose flaky test causes by applying mutations (order, repeat, env, isolate)")
    // options and action from old .command("diagnose")

  debug.command("bisect")
    .description("Find commit range where a test became flaky")
    // options and action

  debug.command("confirm <target>")
    .description("Re-run a specific test N times to distinguish broken/flaky/transient")
    // options and action (exit codes reworked in Task 14)

  debug.command("retry")
    .description("Re-run failed tests from a CI workflow run locally")
    // options and action

  debug.command("doctor")
    .description("Check local flaker runtime requirements")
    .action(async () => {
      // body from old .command("doctor")
    });
}
```

- [ ] **Step 4: Delete old top-level blocks from main.ts**

- [ ] **Step 5: Build and verify**

```bash
pnpm build
for cmd in diagnose bisect confirm retry doctor; do
  node dist/cli/main.js debug $cmd --help
done
```

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move debug commands under debug category"
```

---

## Task 9: Move policy commands into policy category

**Files:**
- Create: `src/cli/commands/policy/{quarantine,check}.ts`
- Delete: `src/cli/commands/{quarantine,check}.ts`
- Modify: `src/cli/categories/policy.ts`, `src/cli/main.ts`

- [ ] **Step 1: Move two files**

```bash
mkdir -p src/cli/commands/policy
git mv src/cli/commands/quarantine.ts src/cli/commands/policy/quarantine.ts
git mv src/cli/commands/check.ts src/cli/commands/policy/check.ts
```

- [ ] **Step 2: Fix imports**

- [ ] **Step 3: Register under policy category**

```typescript
// src/cli/categories/policy.ts
import type { Command } from "commander";
import { runQuarantine, formatQuarantineTable, buildQuarantineIssueOpts } from "../commands/policy/quarantine.js";
import {
  runConfigCheck,
  formatConfigCheckReport,
  loadTaskDefinitionsForCheck,
  discoverTestSpecsForCheck,
  appendConfigWarnings,
} from "../commands/policy/check.js";

export function registerPolicyCommands(program: Command): void {
  const policy = program
    .command("policy")
    .description("Enforcement and ownership");

  policy.command("quarantine")
    .description("Manage quarantined tests")
    // options and action from old .command("quarantine")

  policy.command("check")
    .description("Validate test spec ownership and config drift")
    // options and action from old .command("check")
}
```

- [ ] **Step 4: Delete old top-level blocks from main.ts**

- [ ] **Step 5: Build and verify**

```bash
pnpm build
node dist/cli/main.js policy quarantine --help
node dist/cli/main.js policy check --help
```

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move policy commands under policy category"
```

---

## Task 10: Move dev commands into dev category

**Files:**
- Create: `src/cli/commands/dev/{train,tune,self-eval,eval-fixture,eval-co-failure,test-key}.ts`
- Delete: `src/cli/commands/{train,self-eval,test-key}.ts` and the inline `tune` / `eval-fixture` / `co-failure-window` sources
- Modify: `src/cli/categories/dev.ts`, `src/cli/main.ts`

- [ ] **Step 1: Identify sources for tune, eval-fixture, eval-co-failure**

Run:
```bash
ls src/cli/commands | grep -E "train|self-eval|tune|eval-fixture|co-failure|test-key"
```

Expected matches at least: `train.ts`, `self-eval.ts`, `test-key.ts`, `co-failure-window.ts`. `tune` is likely inline in main.ts — extract it into a new file `src/cli/commands/dev/tune.ts` exporting a `runTune(opts)` function. `eval-fixture` action body lives in main.ts around line 1506 and uses helpers from `./eval/fixture-*`; the action body moves into `src/cli/commands/dev/eval-fixture.ts` exporting `runEvalFixture(opts)`.

- [ ] **Step 2: Move existing files**

```bash
mkdir -p src/cli/commands/dev
git mv src/cli/commands/train.ts src/cli/commands/dev/train.ts
git mv src/cli/commands/self-eval.ts src/cli/commands/dev/self-eval.ts
git mv src/cli/commands/test-key.ts src/cli/commands/dev/test-key.ts
git mv src/cli/commands/co-failure-window.ts src/cli/commands/dev/eval-co-failure.ts
```

- [ ] **Step 3: Create tune.ts and eval-fixture.ts by extracting from main.ts**

Create `src/cli/commands/dev/tune.ts` with an exported `runTune(opts)` containing the body of the old `.command("tune")` action. Same for `src/cli/commands/dev/eval-fixture.ts`.

- [ ] **Step 4: Fix imports in all moved/created files**

- [ ] **Step 5: Register under dev category**

```typescript
// src/cli/categories/dev.ts
import type { Command } from "commander";
import { runTrain } from "../commands/dev/train.js";
import { runTune } from "../commands/dev/tune.js";
import { runSelfEval, formatSelfEvalReport } from "../commands/dev/self-eval.js";
import { runEvalFixture } from "../commands/dev/eval-fixture.js";
// eval-co-failure exports:
import { /* ... */ } from "../commands/dev/eval-co-failure.js";
import { /* ... */ } from "../commands/dev/test-key.js";

export function registerDevCommands(program: Command): void {
  const dev = program
    .command("dev")
    .description("Model training and benchmarks");

  dev.command("train")
    .description("Train a GBDT model from historical test results")
    // options and action

  dev.command("tune")
    .description("Auto-tune co-failure alpha parameter using historical data")
    // options and action

  dev.command("self-eval")
    .description("Run self-evaluation scenarios to validate recommendation logic")
    // options and action

  dev.command("eval-fixture")
    .description("Evaluate sampling strategies with synthetic data")
    // options and action

  dev.command("eval-co-failure")
    .description("Analyze co-failure data across different time windows")
    // options and action

  dev.command("test-key")
    .description("Debug test key generation")
    // options and action
}
```

- [ ] **Step 6: Delete old top-level blocks from main.ts**

Blocks to remove: `train`, `self-eval`, `tune`, `eval-fixture`, `eval-co-failure-window`, `test-key`.

- [ ] **Step 7: Build and verify**

```bash
pnpm build
for cmd in train tune self-eval eval-fixture eval-co-failure test-key; do
  node dist/cli/main.js dev $cmd --help
done
```

- [ ] **Step 8: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Move developer commands under dev category"
```

---

## Task 11: Merge sample into exec run via --dry-run and --explain

**Files:**
- Modify: `src/cli/commands/exec/run.ts`
- Delete: `src/cli/commands/sample.ts` (after content is folded in)
- Modify: `src/cli/categories/exec.ts`

- [ ] **Step 1: Move sample.ts into exec and rename internally**

The `planSample`, `formatSamplingSummary`, and `SamplingSummary` exports from `commands/sample.ts` are the selection logic used by `run.ts`. Move the whole file under exec:

```bash
git mv src/cli/commands/sample.ts src/cli/commands/exec/plan.ts
```

Update import in `exec/run.ts`:
```typescript
import { planSample, formatSamplingSummary, type SamplingSummary } from "./plan.js";
```

Fix any other file that imports from `../sample.js` — grep: `grep -rn "commands/sample\|from \"\.\./sample" src/ tests/`.

- [ ] **Step 2: Write failing test for --dry-run behavior**

Create `tests/cli/run-dry-run.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("flaker exec run --dry-run", () => {
  it("prints selection plan without executing the runner", () => {
    // fixture: a throwaway flaker.toml + empty data dir
    const output = execSync(
      `node dist/cli/main.js exec run --dry-run --strategy random --count 1 --json`,
      { cwd: "tests/fixtures/empty-project", encoding: "utf-8" }
    );
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("sampled");
    expect(parsed).not.toHaveProperty("runResult");
  });
});
```

Create the fixture directory if it does not exist: `tests/fixtures/empty-project/flaker.toml` with minimal config.

Run: `pnpm test tests/cli/run-dry-run.test.ts`
Expected: FAIL (flag `--dry-run` does not exist yet).

- [ ] **Step 3: Add --dry-run and --explain to exec run in exec.ts**

In `src/cli/categories/exec.ts`, add options to `exec run`:

```typescript
exec
  .command("run")
  .description("Select and run tests (auto-detects changed files and strategy from config)")
  .option("--profile <name>", "Execution profile: scheduled, ci, local (auto-detected if omitted)")
  .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid, gbdt, full")
  .option("--count <n>", "Number of tests to sample")
  .option("--percentage <n>", "Percentage of tests to sample")
  .option("--skip-quarantined", "Exclude quarantined tests")
  .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
  .option("--co-failure-days <days>", "Co-failure analysis window in days")
  .option("--holdout-ratio <ratio>", "Fraction of skipped tests to run as holdout (0-1)")
  .option("--model-path <path>", "Path to GBDT model JSON")
  .option("--runner <runner>", "Runner type: direct or actrun", "direct")
  .option("--retry", "Retry failed tests (actrun only)")
  .option("--dry-run", "Select but do not execute")
  .option("--explain", "Print selection reasons per test")
  .option("--json", "Machine-readable output")
  .action(async (opts) => {
    // delegates to a new helper in exec/run.ts
  });
```

- [ ] **Step 4: Extend runTests in exec/run.ts to branch on dryRun and explain**

In `src/cli/commands/exec/run.ts`:

```typescript
export interface RunOpts {
  // ... existing fields
  dryRun?: boolean;
  explain?: boolean;
  json?: boolean;
}

export interface RunCommandResult extends ExecuteResult {
  samplingSummary: SamplingSummary;
  sampledTests: TestId[];
  holdoutTests: TestId[];
  holdoutResult?: ExecuteResult;
  dryRun: boolean;
  explain: boolean;
}

export async function runTests(opts: RunOpts): Promise<RunCommandResult> {
  const listedTests = await loadListedTests(opts.runner, opts.cwd);
  const plan = await planSample({
    store: opts.store,
    count: opts.count,
    percentage: opts.percentage,
    mode: opts.mode,
    fallbackMode: opts.fallbackMode,
    seed: opts.seed,
    resolver: opts.resolver,
    changedFiles: opts.changedFiles,
    skipQuarantined: opts.skipQuarantined,
    quarantineManifestEntries: opts.quarantineManifestEntries,
    listedTests,
    coFailureDays: opts.coFailureDays,
    holdoutRatio: opts.holdoutRatio,
  });

  const tests = enrichSampledTests(plan.sampled, listedTests);
  const holdoutTests = enrichSampledTests(plan.holdout, listedTests);

  if (opts.dryRun) {
    return {
      exitCode: 0,
      results: [],
      durationMs: 0,
      samplingSummary: plan.summary,
      sampledTests: tests,
      holdoutTests,
      dryRun: true,
      explain: opts.explain ?? false,
    } as RunCommandResult;
  }

  const runtimeRunner =
    opts.quarantineManifestEntries && opts.quarantineManifestEntries.length > 0
      ? withQuarantineRuntime(opts.runner, opts.quarantineManifestEntries)
      : opts.runner;
  const result = await orchestrate(runtimeRunner, tests, { cwd: opts.cwd });

  let holdoutResult: ExecuteResult | undefined;
  if (holdoutTests.length > 0) {
    holdoutResult = await orchestrate(runtimeRunner, holdoutTests, { cwd: opts.cwd });
  }

  return {
    ...result,
    samplingSummary: plan.summary,
    sampledTests: tests,
    holdoutTests,
    holdoutResult,
    dryRun: false,
    explain: opts.explain ?? false,
  };
}
```

- [ ] **Step 5: Print plan in the action handler when --dry-run or --json is set**

In the `.action` block of `exec run` in `src/cli/categories/exec.ts`, after calling `runTests(...)`:

```typescript
const result = await runTests({ /* ... */ dryRun: opts.dryRun, explain: opts.explain, json: opts.json });

if (opts.json) {
  const payload = {
    sampled: result.sampledTests.map((t) => {
      const base = { suite: t.suite, testName: t.testName, taskId: t.taskId };
      if (result.explain) {
        // Attach tier/score/reason from samplingSummary
        // (samplingSummary.reasons is the existing Map or array produced by planSample)
        return { ...base, ...lookupExplain(result.samplingSummary, t) };
      }
      return base;
    }),
    holdout: result.holdoutTests.map((t) => ({ suite: t.suite, testName: t.testName })),
    summary: result.samplingSummary,
    ...(result.dryRun ? {} : { runResult: { exitCode: result.exitCode, durationMs: result.durationMs } }),
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(result.dryRun ? 0 : result.exitCode);
}

// text output path:
console.log(formatSamplingSummary(result.samplingSummary));
if (result.explain) {
  console.log(formatExplainTable(result.sampledTests, result.samplingSummary));
}
if (result.dryRun) {
  process.exit(0);
}
// fall through to normal run output formatting
```

`lookupExplain` and `formatExplainTable` are new helpers in `src/cli/commands/exec/run.ts`:

```typescript
export function lookupExplain(
  summary: SamplingSummary,
  test: TestId,
): { tier?: string; score?: number; reason?: string } {
  // samplingSummary already contains tier info per selected test;
  // read the corresponding entry by suite+testName+taskId
  const entry = summary.reasons?.find(
    (r) => r.suite === test.suite && r.test_name === test.testName
  );
  if (!entry) return {};
  return { tier: entry.tier, score: entry.score, reason: entry.reason };
}

export function formatExplainTable(
  tests: TestId[],
  summary: SamplingSummary,
): string {
  const header = "TEST\tTIER\tSCORE\tREASON";
  const rows = tests.map((t) => {
    const e = lookupExplain(summary, t);
    return `${t.suite}::${t.testName}\t${e.tier ?? "-"}\t${e.score ?? "-"}\t${e.reason ?? ""}`;
  });
  return [header, ...rows].join("\n");
}
```

If `summary.reasons` does not exist in the current `SamplingSummary` shape, add a `reasons?: Array<{ suite: string; test_name: string; tier: string; score: number; reason: string }>` field and populate it in `planSample` where tiers are already being computed. Grep `planSample` for the tier assignment site.

- [ ] **Step 6: Run dry-run test and verify it passes**

```bash
pnpm build
pnpm test tests/cli/run-dry-run.test.ts
```
Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Merge sample into exec run with --dry-run and --explain"
```

---

## Task 12: Rename --last to --days on collect ci

**Files:**
- Modify: `src/cli/categories/collect.ts`, `src/cli/commands/collect/ci.ts`

- [ ] **Step 1: Write failing test for --days flag**

Append to or create `tests/cli/collect-ci-flags.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("flaker collect ci --days", () => {
  it("accepts --days and shows it in help", () => {
    const help = execSync("node dist/cli/main.js collect ci --help", { encoding: "utf-8" });
    expect(help).toContain("--days");
    expect(help).not.toContain("--last");
  });
});
```

Run: `pnpm build && pnpm test tests/cli/collect-ci-flags.test.ts`
Expected: FAIL.

- [ ] **Step 2: Change the option in collect.ts category**

In `src/cli/categories/collect.ts`:

```typescript
collect
  .command("ci")
  .description("Collect workflow runs from GitHub")
  .option("--days <n>", "Number of days to look back", "30")
  .option("--branch <branch>", "Filter by branch")
  .option("--json", "Output JSON summary")
  .option("--output <file>", "Write collect summary to a file")
  .option("--fail-on-errors", "Exit with status 1 when any workflow run fails to collect")
  .action(async (opts) => {
    // inside: rename opts.last → opts.days
    const days = Number(opts.days);
    // ... rest of body
  });
```

Check the action body for references to `opts.last` and rename to `opts.days`. Also check `src/cli/commands/collect/ci.ts` for any parsing helpers that took a `last` parameter and rename to `days`.

- [ ] **Step 3: Build and run test**

```bash
pnpm build
pnpm test tests/cli/collect-ci-flags.test.ts
```
Expected: PASS.

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename collect ci --last to --days"
```

---

## Task 13: Add --adapter and --runner flags to setup init

**Files:**
- Modify: `src/cli/categories/setup.ts`, `src/cli/commands/setup/init.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/setup-init-flags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("flaker setup init --adapter --runner", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-init-"));
    execSync("git init -q && git remote add origin https://github.com/acme/demo.git", { cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes [adapter] and [runner] sections when flags are provided", () => {
    execSync(
      `node ${process.cwd()}/dist/cli/main.js setup init --adapter vitest --runner vitest`,
      { cwd: dir }
    );
    const toml = readFileSync(join(dir, "flaker.toml"), "utf-8");
    expect(toml).toMatch(/\[adapter\][\s\S]*type = "vitest"/);
    expect(toml).toMatch(/\[runner\][\s\S]*type = "vitest"/);
  });

  it("rejects unknown adapter values", () => {
    expect(() => execSync(
      `node ${process.cwd()}/dist/cli/main.js setup init --adapter frobnitz`,
      { cwd: dir, stdio: "pipe" }
    )).toThrow();
  });
});
```

Run: `pnpm build && pnpm test tests/cli/setup-init-flags.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add flags to setup.ts and validate in init.ts**

In `src/cli/categories/setup.ts`:

```typescript
const VALID_ADAPTERS = ["playwright", "vitest", "jest", "junit"] as const;
const VALID_RUNNERS = ["vitest", "playwright", "jest", "actrun"] as const;

setup
  .command("init")
  .description("Create flaker.toml (auto-detects owner/name from git remote)")
  .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
  .option("--name <name>", "Repository name (auto-detected from git remote)")
  .option(
    "--adapter <type>",
    `Test result adapter: ${VALID_ADAPTERS.join("|")}`
  )
  .option(
    "--runner <type>",
    `Test runner: ${VALID_RUNNERS.join("|")}`
  )
  .action(async (opts) => {
    if (opts.adapter && !VALID_ADAPTERS.includes(opts.adapter)) {
      console.error(`Error: unknown adapter "${opts.adapter}". Valid: ${VALID_ADAPTERS.join(", ")}`);
      process.exit(1);
    }
    if (opts.runner && !VALID_RUNNERS.includes(opts.runner)) {
      console.error(`Error: unknown runner "${opts.runner}". Valid: ${VALID_RUNNERS.join(", ")}`);
      process.exit(1);
    }
    await runInit(opts);
  });
```

In `src/cli/commands/setup/init.ts`, extend `runInit` to receive `adapter` / `runner` and write them into the generated TOML:

```typescript
// Inside runInit, after existing logic that assembles the TOML template:
const RUNNER_COMMAND_DEFAULTS: Record<string, string> = {
  vitest: "pnpm exec vitest run",
  playwright: "pnpm exec playwright test",
  jest: "pnpm exec jest",
  actrun: "actrun",
};

function adapterSection(adapter?: string): string {
  if (adapter) return `[adapter]\ntype = "${adapter}"\n`;
  return `# [adapter]\n# type = "playwright"\n`;
}

function runnerSection(runner?: string): string {
  if (runner) {
    const cmd = RUNNER_COMMAND_DEFAULTS[runner] ?? "";
    return `[runner]\ntype = "${runner}"\ncommand = "${cmd}"\n`;
  }
  return `# [runner]\n# type = "vitest"\n# command = "pnpm exec vitest run"\n`;
}
```

Wire these into the TOML template the existing `runInit` writes.

- [ ] **Step 3: Build and test**

```bash
pnpm build
pnpm test tests/cli/setup-init-flags.test.ts
```
Expected: PASS.

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add --adapter and --runner flags to setup init"
```

---

## Task 14: Rework debug confirm exit codes and JSON output

**Files:**
- Modify: `src/cli/categories/debug.ts`, `src/cli/commands/debug/confirm.ts`, `src/cli/commands/debug/confirm-local.ts`, `src/cli/commands/debug/confirm-remote.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/confirm-exit-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatConfirmResult, confirmExitCode, type ConfirmVerdict } from "../../src/cli/commands/debug/confirm.js";

describe("confirm exit codes", () => {
  it("TRANSIENT → 0", () => {
    expect(confirmExitCode("TRANSIENT")).toBe(0);
  });
  it("FLAKY → 1", () => {
    expect(confirmExitCode("FLAKY")).toBe(1);
  });
  it("BROKEN → 2", () => {
    expect(confirmExitCode("BROKEN")).toBe(2);
  });
  it("ERROR → 3", () => {
    expect(confirmExitCode("ERROR")).toBe(3);
  });
});

describe("confirm --json", () => {
  it("emits verdict and runs fields", () => {
    const json = formatConfirmResult(
      { verdict: "BROKEN", runs: [{ status: "failed", durationMs: 120 }] },
      { json: true }
    );
    const parsed = JSON.parse(json);
    expect(parsed.verdict).toBe("BROKEN");
    expect(Array.isArray(parsed.runs)).toBe(true);
  });
});
```

Run: `pnpm test tests/cli/confirm-exit-code.test.ts`
Expected: FAIL (missing `confirmExitCode` export or wrong values).

- [ ] **Step 2: Implement exit code helper and extend formatConfirmResult**

In `src/cli/commands/debug/confirm.ts`:

```typescript
export type ConfirmVerdict = "BROKEN" | "FLAKY" | "TRANSIENT" | "ERROR";

export function confirmExitCode(verdict: ConfirmVerdict): number {
  switch (verdict) {
    case "TRANSIENT": return 0;
    case "FLAKY":     return 1;
    case "BROKEN":    return 2;
    case "ERROR":     return 3;
  }
}

export interface ConfirmResultPayload {
  verdict: ConfirmVerdict;
  runs: Array<{ status: string; durationMs?: number; [k: string]: unknown }>;
}

export function formatConfirmResult(
  payload: ConfirmResultPayload,
  opts: { json?: boolean } = {},
): string {
  if (opts.json) {
    return JSON.stringify(payload, null, 2);
  }
  // existing human-readable formatter body
  // ...
}
```

If the existing `formatConfirmResult` has a different signature, adapt — keep the old human output behavior and add the `opts.json` branch.

- [ ] **Step 3: Add --json flag and wire exit code in debug.ts**

```typescript
debug.command("confirm <target>")
  .description("Re-run a specific test N times to distinguish broken/flaky/transient")
  .option("--runner <runner>", "Runner type: local or remote", "remote")
  .option("--repeat <n>", "Number of times to repeat", "5")
  .option("--json", "Machine-readable JSON output")
  .action(async (target, opts) => {
    let payload: ConfirmResultPayload;
    try {
      const runResult = opts.runner === "local"
        ? await runConfirmLocal({ target, repeat: Number(opts.repeat) })
        : await runConfirmRemote({ target, repeat: Number(opts.repeat) });
      payload = runResult;
    } catch (err) {
      payload = { verdict: "ERROR", runs: [] };
      console.error(String(err));
    }

    const output = formatConfirmResult(payload, { json: opts.json });
    process.stdout.write(output + "\n");
    process.exit(confirmExitCode(payload.verdict));
  });
```

Update `runConfirmLocal` / `runConfirmRemote` to return `ConfirmResultPayload`. If they currently return a different shape, add a thin adapter in the action.

- [ ] **Step 4: Update help text with exit codes block**

In `src/cli/categories/debug.ts`, after the `confirm` command is registered:

```typescript
const confirmCmd = debug.commands.find((c) => c.name() === "confirm");
if (confirmCmd) {
  confirmCmd.addHelpText("after", `
Exit codes:
  0  TRANSIENT  Not reproducible (no further action)
  1  FLAKY      Intermittent (pass and fail both observed)
  2  BROKEN     Regression reproduced (fix required)
  3  ERROR      Runner or config failure

With --json, prints: {"verdict": "BROKEN|FLAKY|TRANSIENT", "runs": [...]}
`);
}
```

- [ ] **Step 5: Run test**

```bash
pnpm build
pnpm test tests/cli/confirm-exit-code.test.ts
```
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Rework debug confirm exit codes and add --json"
```

---

## Task 15: Wire top-level aliases (init, run, kpi, collect)

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Add the four aliases**

After the nine `registerXCommands(program)` calls in `src/cli/main.ts`, register top-level shortcuts that delegate to the same action functions:

```typescript
// Top-level aliases
program
  .command("init")
  .description("Alias for `flaker setup init`")
  .option("--owner <owner>")
  .option("--name <name>")
  .option("--adapter <type>")
  .option("--runner <type>")
  .action(async (opts) => {
    // call same runInit path the setup init action calls
    await runInitWithValidation(opts);
  });

program
  .command("run")
  .description("Alias for `flaker exec run`")
  // copy ALL options from exec run verbatim
  .action(async (opts) => {
    await execRunAction(opts);
  });

program
  .command("kpi")
  .description("Alias for `flaker analyze kpi`")
  .option("--window-days <days>", "Analysis window in days", "30")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    await analyzeKpiAction(opts);
  });

program
  .command("collect")
  .description("Alias for `flaker collect ci`")
  .option("--days <n>", "Number of days to look back", "30")
  .option("--branch <branch>")
  .option("--json")
  .option("--output <file>")
  .option("--fail-on-errors")
  .action(async (opts) => {
    await collectCiAction(opts);
  });
```

To avoid duplicating action bodies, extract the action bodies of `setup init`, `exec run`, `analyze kpi`, and `collect ci` into exported standalone functions in their respective category files:

```typescript
// src/cli/categories/setup.ts
export async function runInitWithValidation(opts: {...}): Promise<void> { /* ... */ }

// src/cli/categories/exec.ts
export async function execRunAction(opts: {...}): Promise<void> { /* ... */ }

// src/cli/categories/analyze.ts
export async function analyzeKpiAction(opts: {...}): Promise<void> { /* ... */ }

// src/cli/categories/collect.ts
export async function collectCiAction(opts: {...}): Promise<void> { /* ... */ }
```

Then both the category subcommand and the top-level alias call the same exported function.

- [ ] **Step 2: Build and verify aliases work**

```bash
pnpm build
node dist/cli/main.js init --help
node dist/cli/main.js run --help
node dist/cli/main.js kpi --help
node dist/cli/main.js collect --help
```
Expected: each shows options and mentions the canonical form in the description.

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add top-level aliases for init, run, kpi, collect"
```

---

## Task 16: Override top-level help layout

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write failing test for help shape**

Create `tests/cli/help-shape.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

function help(args: string = ""): string {
  return execSync(`node dist/cli/main.js ${args} --help`, { encoding: "utf-8" });
}

describe("flaker --help", () => {
  it("contains Getting started section", () => {
    expect(help()).toContain("Getting started:");
  });
  it("contains Daily workflow section", () => {
    expect(help()).toContain("Daily workflow:");
  });
  it("contains Commands (by category) section", () => {
    expect(help()).toContain("Commands (by category):");
  });
  for (const category of ["setup", "exec", "collect", "import", "report", "analyze", "debug", "policy", "dev"]) {
    it(`lists ${category} category`, () => {
      expect(help()).toContain(category);
    });
  }
});

describe("category help", () => {
  for (const category of ["analyze", "debug", "collect"]) {
    it(`${category} --help lists its subcommands`, () => {
      const h = help(category);
      expect(h).toContain(`Usage: flaker ${category}`);
    });
  }
});
```

Run: `pnpm build && pnpm test tests/cli/help-shape.test.ts`
Expected: FAIL (no custom help sections yet).

- [ ] **Step 2: Override helpInformation in main.ts**

```typescript
// inside createProgram(), after all commands are registered:
const originalHelp = program.helpInformation.bind(program);
program.helpInformation = () => {
  const base = originalHelp();
  const extras = `
Getting started:
  flaker init                       Create flaker.toml (auto-detects repo)
  flaker collect calibrate          Analyze history, write optimal sampling config
  flaker debug doctor               Check runtime requirements
  flaker run                        Select and execute tests

Daily workflow:
  flaker run                        Execute with auto-selected profile
  flaker run --dry-run --explain    Preview selection with reasons
  flaker analyze kpi                KPI dashboard (sampling, flaky, data quality)

Commands (by category):
  setup      Project scaffolding            (init)
  exec       Test selection and execution   (run, affected)
  collect    Import history and calibration (ci, local, coverage, commit-changes, calibrate)
  import     Ingest external reports        (report, parquet)
  report     Normalize and diff reports     (summary, diff, aggregate)
  analyze    Read-only inspection           (kpi, flaky, reason, insights, eval, context, query)
  debug      Active investigation           (diagnose, bisect, confirm, retry, doctor)
  policy     Enforcement and ownership      (quarantine, check)
  dev        Model training and benchmarks  (train, tune, self-eval, eval-fixture, eval-co-failure, test-key)

Run \`flaker <category> --help\` for the full list under each category.
Run \`flaker <category> <command> --help\` for per-command options.
`;
  return base + extras;
};
```

- [ ] **Step 3: Build and run help test**

```bash
pnpm build
pnpm test tests/cli/help-shape.test.ts
```
Expected: PASS.

- [ ] **Step 4: Add analyze query examples**

In `src/cli/categories/analyze.ts`, after the `query` command is registered:

```typescript
const queryCmd = analyze.commands.find((c) => c.name() === "query");
if (queryCmd) {
  queryCmd.addHelpText("after", `
Examples:
  flaker analyze query "SELECT test_name, COUNT(*) AS fails FROM test_results WHERE status='failed' GROUP BY 1 ORDER BY fails DESC LIMIT 10"
  flaker analyze query "SELECT commit_sha, AVG(CASE WHEN status='failed' THEN 1.0 ELSE 0 END) AS fail_rate FROM test_results GROUP BY 1 ORDER BY fail_rate DESC LIMIT 20"
  flaker analyze query "SELECT * FROM test_results ORDER BY created_at DESC LIMIT 20"
`);
}
```

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Override top-level help layout with category sections"
```

---

## Task 17: Write config-migration test (failing)

**Files:**
- Create: `tests/cli/config-migration.test.ts`, `tests/fixtures/legacy-config/flaker.toml`

- [ ] **Step 1: Create a fixture with legacy keys**

Create `tests/fixtures/legacy-config/flaker.toml`:

```toml
[repo]
owner = "acme"
name = "demo"

[storage]
path = ".flaker/data.duckdb"

[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm exec vitest run"

[affected]
resolver = "workspace"

[flaky]
window_days = 14
detection_threshold = 2.0

[quarantine]
auto = true
flaky_rate_threshold = 30.0
min_runs = 10

[sampling]
strategy = "hybrid"
percentage = 30
holdout_ratio = 0.1
co_failure_days = 90

[profile.ci]
strategy = "hybrid"
percentage = 30
adaptive = true
adaptive_fnr_low = 0.02
adaptive_fnr_high = 0.05
adaptive_min_percentage = 15
```

- [ ] **Step 2: Write the test**

Create `tests/cli/config-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/cli/config.js";

describe("config migration error", () => {
  it("rejects legacy [sampling] percentage key", () => {
    expect(() => loadConfig("tests/fixtures/legacy-config")).toThrow(
      /deprecated key `percentage` in \[sampling\][\s\S]*sample_percentage/
    );
  });

  it("error message points to the migration doc", () => {
    try {
      loadConfig("tests/fixtures/legacy-config");
    } catch (err) {
      expect(String(err)).toContain("docs/how-to-use.md#config-migration");
      return;
    }
    throw new Error("expected loadConfig to throw");
  });
});
```

Run: `pnpm test tests/cli/config-migration.test.ts`
Expected: FAIL (current loader tolerates legacy keys).

- [ ] **Step 3: Commit the failing test and fixture**

```bash
git add tests/cli/config-migration.test.ts tests/fixtures/legacy-config
git commit -m "Add failing config migration test"
```

---

## Task 18: Rewrite config.ts with new keys and hard-fail loader

**Files:**
- Modify: `src/cli/config.ts`
- Modify: every consumer that reads old keys

- [ ] **Step 1: Redefine types**

In `src/cli/config.ts`:

```typescript
export interface SamplingConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  model_path?: string;
  skip_quarantined?: boolean;
  calibrated_at?: string;
  detected_flaky_rate_ratio?: number;   // was `detected_flaky_rate`
  detected_co_failure_strength_ratio?: number;  // was `detected_co_failure_strength`
  detected_test_count?: number;
}

export interface ProfileConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive?: boolean;
  adaptive_fnr_low_ratio?: number;      // was `adaptive_fnr_low`
  adaptive_fnr_high_ratio?: number;     // was `adaptive_fnr_high`
  adaptive_min_percentage?: number;
  adaptive_step?: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  collect?: { workflow_paths?: string[] };
  adapter: { type: string; command?: string; artifact_name?: string };
  runner: { /* unchanged */ };
  affected: { resolver: string; config: string };
  quarantine: { auto: boolean; flaky_rate_threshold_percentage: number; min_runs: number };
  flaky: { window_days: number; detection_threshold_ratio: number };
  coverage?: CoverageConfig;
  sampling?: SamplingConfig;
  profile?: Record<string, ProfileConfig>;
}
```

- [ ] **Step 2: Add legacy key detection table and migration error**

```typescript
interface LegacyKeyEntry {
  section: string;
  oldKey: string;
  newKey: string;
  unitNote: string;
}

const LEGACY_KEYS: LegacyKeyEntry[] = [
  { section: "sampling", oldKey: "percentage", newKey: "sample_percentage", unitNote: "value range 0-100" },
  { section: "sampling", oldKey: "co_failure_days", newKey: "co_failure_window_days", unitNote: "days (int)" },
  { section: "sampling", oldKey: "detected_flaky_rate", newKey: "detected_flaky_rate_ratio", unitNote: "0.0-1.0" },
  { section: "sampling", oldKey: "detected_co_failure_strength", newKey: "detected_co_failure_strength_ratio", unitNote: "0.0-1.0" },
  { section: "flaky", oldKey: "detection_threshold", newKey: "detection_threshold_ratio", unitNote: "0.0-1.0" },
  { section: "quarantine", oldKey: "flaky_rate_threshold", newKey: "flaky_rate_threshold_percentage", unitNote: "value range 0-100" },
];

const LEGACY_PROFILE_KEYS: LegacyKeyEntry[] = [
  { section: "profile.*", oldKey: "percentage", newKey: "sample_percentage", unitNote: "value range 0-100" },
  { section: "profile.*", oldKey: "co_failure_days", newKey: "co_failure_window_days", unitNote: "days (int)" },
  { section: "profile.*", oldKey: "adaptive_fnr_low", newKey: "adaptive_fnr_low_ratio", unitNote: "0.0-1.0" },
  { section: "profile.*", oldKey: "adaptive_fnr_high", newKey: "adaptive_fnr_high_ratio", unitNote: "0.0-1.0" },
];

function checkLegacyKeys(parsed: Record<string, unknown>): void {
  const errors: string[] = [];

  for (const entry of LEGACY_KEYS) {
    const section = parsed[entry.section];
    if (section && typeof section === "object" && entry.oldKey in (section as Record<string, unknown>)) {
      errors.push(
        `  [${entry.section}] \`${entry.oldKey}\` → rename to \`${entry.newKey}\` (${entry.unitNote})`
      );
    }
  }

  const profiles = parsed.profile as Record<string, unknown> | undefined;
  if (profiles && typeof profiles === "object") {
    for (const [profileName, profileValue] of Object.entries(profiles)) {
      if (!profileValue || typeof profileValue !== "object") continue;
      for (const entry of LEGACY_PROFILE_KEYS) {
        if (entry.oldKey in (profileValue as Record<string, unknown>)) {
          errors.push(
            `  [profile.${profileName}] \`${entry.oldKey}\` → rename to \`${entry.newKey}\` (${entry.unitNote})`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `flaker.toml uses deprecated keys:\n${errors.join("\n")}\n` +
      `  → see docs/how-to-use.md#config-migration for the full mapping`
    );
  }
}
```

- [ ] **Step 3: Call checkLegacyKeys from loadConfigWithDiagnostics**

```typescript
export function loadConfigWithDiagnostics(dir: string): LoadedConfigDiagnostics {
  const filePath = join(dir, "flaker.toml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${filePath}. Run 'flaker init' to create one.`);
  }
  const parsed = parse(content) as unknown as Record<string, unknown>;
  checkLegacyKeys(parsed);
  const config = deepMerge(DEFAULT_CONFIG, parsed);
  // normalizeThresholdWarnings is no longer needed — delete the call and the function
  return { config, warnings: [] };
}
```

Delete `normalizeThresholdWarnings` and the `ConfigWarning` / `ConfigWarningCode` / `LoadedConfigDiagnostics` types, OR simplify `LoadedConfigDiagnostics` to just return `config`. If other code references `LoadedConfigDiagnostics.warnings`, keep the field as an empty array for compatibility within this commit.

- [ ] **Step 4: Update DEFAULT_CONFIG**

```typescript
const DEFAULT_CONFIG: FlakerConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".flaker/data" },
  collect: { workflow_paths: [] },
  adapter: { type: "playwright" },
  runner: { type: "vitest", command: "pnpm test" },
  affected: { resolver: "git", config: "" },
  quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold_ratio: 0.02 },
};
```

- [ ] **Step 5: Update writeSamplingConfig to use new keys**

```typescript
export function writeSamplingConfig(dir: string, sampling: SamplingConfig): void {
  const filePath = join(dir, "flaker.toml");
  const content = readFileSync(filePath, "utf-8");

  const lines: string[] = [
    "[sampling]",
    `strategy = "${sampling.strategy}"`,
  ];
  if (sampling.sample_percentage != null) lines.push(`sample_percentage = ${sampling.sample_percentage}`);
  if (sampling.holdout_ratio != null) lines.push(`holdout_ratio = ${sampling.holdout_ratio}`);
  if (sampling.co_failure_window_days != null) lines.push(`co_failure_window_days = ${sampling.co_failure_window_days}`);
  if (sampling.model_path != null) lines.push(`model_path = "${sampling.model_path}"`);
  if (sampling.skip_quarantined != null) lines.push(`skip_quarantined = ${sampling.skip_quarantined}`);
  if (sampling.calibrated_at != null) lines.push(`calibrated_at = "${sampling.calibrated_at}"`);
  if (sampling.detected_flaky_rate_ratio != null) lines.push(`detected_flaky_rate_ratio = ${sampling.detected_flaky_rate_ratio}`);
  if (sampling.detected_co_failure_strength_ratio != null) lines.push(`detected_co_failure_strength_ratio = ${sampling.detected_co_failure_strength_ratio}`);
  if (sampling.detected_test_count != null) lines.push(`detected_test_count = ${sampling.detected_test_count}`);

  const samplingBlock = lines.join("\n") + "\n";
  const sectionRegex = /^\[sampling\]\n(?:(?!\n\[)[^\n]*\n)*/m;
  const updated = sectionRegex.test(content)
    ? content.replace(sectionRegex, samplingBlock)
    : content.trimEnd() + "\n\n" + samplingBlock;
  writeFileSync(filePath, updated, "utf-8");
}
```

- [ ] **Step 6: Update all consumers**

Run: `grep -rn "\.percentage\|\.co_failure_days\|\.detection_threshold\b\|\.flaky_rate_threshold\b\|\.detected_flaky_rate\b\|\.detected_co_failure_strength\b\|\.adaptive_fnr_low\b\|\.adaptive_fnr_high\b" src/cli`

For every hit, rename per the mapping:

| Old | New |
|---|---|
| `sampling.percentage` | `sampling.sample_percentage` |
| `sampling.co_failure_days` | `sampling.co_failure_window_days` |
| `sampling.detected_flaky_rate` | `sampling.detected_flaky_rate_ratio` |
| `sampling.detected_co_failure_strength` | `sampling.detected_co_failure_strength_ratio` |
| `flaky.detection_threshold` | `flaky.detection_threshold_ratio` |
| `quarantine.flaky_rate_threshold` | `quarantine.flaky_rate_threshold_percentage` |
| `profile[x].percentage` | `profile[x].sample_percentage` |
| `profile[x].co_failure_days` | `profile[x].co_failure_window_days` |
| `profile[x].adaptive_fnr_low` | `profile[x].adaptive_fnr_low_ratio` |
| `profile[x].adaptive_fnr_high` | `profile[x].adaptive_fnr_high_ratio` |

Also update `src/cli/profile.ts` (`resolveProfile`, `computeAdaptivePercentage`), `src/cli/commands/collect/calibrate.ts`, `src/cli/commands/policy/check.ts`, and any file under `src/cli/eval/` that reads profile config.

If a consumer had a number that was "percentage 0.3" style (legacy ratio-as-percentage), the old `normalizeThresholdWarnings` used to multiply by 100. With the new explicit keys, the consumer must use the percentage value directly: `flaky_rate_threshold_percentage = 30` is just `30`, no normalization. Delete any `* 100` or `/ 100` that was bridging the mismatch.

- [ ] **Step 7: Migrate the repo's own flaker.toml**

Edit `flaker.toml` at the repo root in place:

```toml
[sampling]
strategy = "hybrid"
sample_percentage = 30
holdout_ratio = 0.1
co_failure_window_days = 90
calibrated_at = "2026-04-04"
detected_flaky_rate_ratio = 0.005
detected_co_failure_strength_ratio = 0.5
detected_test_count = 437

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
holdout_ratio = 0.1
adaptive = true
adaptive_fnr_low_ratio = 0.02
adaptive_fnr_high_ratio = 0.05
adaptive_min_percentage = 15
```

- [ ] **Step 8: Run config-migration test (should now pass)**

```bash
pnpm build
pnpm test tests/cli/config-migration.test.ts
```
Expected: PASS.

- [ ] **Step 9: Run full suite**

Run: `pnpm test`
Expected: all pass. If any test fixture under `tests/fixtures/` still uses legacy keys (other than the intentional `legacy-config` fixture), update it.

Run: `pnpm build && node dist/cli/main.js debug doctor`
Expected: all checks pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Rewrite config layer with suffix-per-unit keys and hard-fail migration"
```

---

## Task 19: Add range validation to debug doctor and policy check

**Files:**
- Modify: `src/cli/commands/debug/doctor.ts`, `src/cli/commands/policy/check.ts`

- [ ] **Step 1: Write failing test for range validation**

Append to `tests/cli/config-migration.test.ts`:

```typescript
import { validateConfigRanges } from "../../src/cli/config.js";

describe("config range validation", () => {
  it("rejects holdout_ratio above 1", () => {
    const errs = validateConfigRanges({
      sampling: { strategy: "random", holdout_ratio: 1.5 },
    } as any);
    expect(errs).toContainEqual(
      expect.objectContaining({ path: "sampling.holdout_ratio" })
    );
  });

  it("rejects flaky_rate_threshold_percentage above 100", () => {
    const errs = validateConfigRanges({
      quarantine: { auto: true, flaky_rate_threshold_percentage: 150, min_runs: 5 },
      flaky: { window_days: 14, detection_threshold_ratio: 0.02 },
    } as any);
    expect(errs.some((e) => e.path === "quarantine.flaky_rate_threshold_percentage")).toBe(true);
  });
});
```

Run: `pnpm test tests/cli/config-migration.test.ts`
Expected: FAIL (no `validateConfigRanges` export).

- [ ] **Step 2: Add validateConfigRanges to config.ts**

```typescript
export interface ConfigRangeError {
  path: string;
  value: number;
  expected: string;
}

export function validateConfigRanges(config: FlakerConfig): ConfigRangeError[] {
  const errors: ConfigRangeError[] = [];
  const check = (path: string, value: number | undefined, min: number, max: number, label: string) => {
    if (value == null) return;
    if (value < min || value > max) {
      errors.push({ path, value, expected: label });
    }
  };

  check("flaky.detection_threshold_ratio", config.flaky.detection_threshold_ratio, 0, 1, "0.0-1.0");
  check("quarantine.flaky_rate_threshold_percentage", config.quarantine.flaky_rate_threshold_percentage, 0, 100, "0-100");

  if (config.sampling) {
    check("sampling.sample_percentage", config.sampling.sample_percentage, 0, 100, "0-100");
    check("sampling.holdout_ratio", config.sampling.holdout_ratio, 0, 1, "0.0-1.0");
    check("sampling.detected_flaky_rate_ratio", config.sampling.detected_flaky_rate_ratio, 0, 1, "0.0-1.0");
    check("sampling.detected_co_failure_strength_ratio", config.sampling.detected_co_failure_strength_ratio, 0, 1, "0.0-1.0");
  }

  if (config.profile) {
    for (const [name, p] of Object.entries(config.profile)) {
      check(`profile.${name}.sample_percentage`, p.sample_percentage, 0, 100, "0-100");
      check(`profile.${name}.holdout_ratio`, p.holdout_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_fnr_low_ratio`, p.adaptive_fnr_low_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_fnr_high_ratio`, p.adaptive_fnr_high_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_min_percentage`, p.adaptive_min_percentage, 0, 100, "0-100");
    }
  }

  return errors;
}
```

- [ ] **Step 3: Call from debug doctor and policy check**

In `src/cli/commands/debug/doctor.ts`, add a "ranges" check that calls `validateConfigRanges(config)` and reports each error with severity OK/ERROR.

In `src/cli/commands/policy/check.ts`, call `validateConfigRanges(config)` before returning; append each error to the report.

- [ ] **Step 4: Run tests**

```bash
pnpm build
pnpm test tests/cli/config-migration.test.ts
pnpm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add config range validation to debug doctor and policy check"
```

---

## Task 20: Rewrite README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace all command examples with new hierarchy**

Read `README.md` top to bottom. Every `flaker <command>` example must be updated per the rename in `docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md` §2.1:

- `flaker init` → stays (alias)
- `flaker collect --last 30` → `flaker collect --days 30` (alias of `flaker collect ci --days 30`)
- `flaker collect-local` → `flaker collect local`
- `flaker flaky` → `flaker analyze flaky`
- `flaker sample` → `flaker run --dry-run`
- `flaker run` → stays (alias)
- `flaker eval` → `flaker analyze eval`
- `flaker reason` → `flaker analyze reason`
- `flaker kpi` → stays (alias)
- `flaker confirm` → `flaker debug confirm`
- `flaker retry` → `flaker debug retry`
- `flaker quarantine` → `flaker policy quarantine`
- `flaker check` → `flaker policy check`
- `flaker affected` → `flaker exec affected`
- `flaker query` → `flaker analyze query`
- `flaker train` → `flaker dev train`
- `flaker report summarize` → `flaker report summary`
- `flaker calibrate` → `flaker collect calibrate`

- [ ] **Step 2: Update Getting started section to 4 steps**

Replace the "Quick Start" and "Getting started (3 commands)" text with:

```markdown
## Quick Start

1. **Initialize**: `flaker init`
2. **Calibrate**: `flaker collect calibrate`
3. **Check environment**: `flaker debug doctor`
4. **Run**: `flaker run`
```

- [ ] **Step 3: Add flag precedence block to the sampling section**

Insert verbatim the block from spec §3.2 into the "Sample tests before pushing" section.

- [ ] **Step 4: Remove sibling checkout section**

Delete the entire "Sibling Checkout" block from `README.md` and add one line in its place:

```markdown
For contributing and dogfood workflows, see [docs/contributing.md](docs/contributing.md).
```

- [ ] **Step 5: Update config example**

Replace the "Minimal Configuration" block with the new key names:

```toml
[repo]
owner = "your-org"
name = "your-repo"

[storage]
path = ".flaker/data.duckdb"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm exec vitest run"

[affected]
resolver = "workspace"

[flaky]
window_days = 14
detection_threshold_ratio = 0.02

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 10

[sampling]
strategy = "hybrid"
sample_percentage = 30
holdout_ratio = 0.1
co_failure_window_days = 90

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
```

- [ ] **Step 6: Add link to config migration section**

Near the top of the file (below the feature list), add:

```markdown
> **Upgrading from 0.0.x?** See [docs/how-to-use.md#config-migration](docs/how-to-use.md#config-migration) for the full rename map.
```

- [ ] **Step 7: Run doctor and a dry-run to sanity check examples**

```bash
pnpm build
node dist/cli/main.js debug doctor
node dist/cli/main.js run --dry-run --strategy random --count 1
```
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "Rewrite README for new CLI hierarchy"
```

---

## Task 21: Rewrite docs/how-to-use.md with config-migration section

**Files:**
- Modify: `docs/how-to-use.md`

- [ ] **Step 1: Replace all command examples**

Same rename table as Task 20.

- [ ] **Step 2: Add flag precedence block**

In the section that covers `run`, paste the block from spec §3.2 verbatim.

- [ ] **Step 3: Add `#config-migration` section at the end**

```markdown
## Config migration

`flaker 0.1.0` renames config keys to follow a suffix-per-unit convention: `*_ratio` (0.0-1.0), `*_percentage` (0-100), `*_days`, `*_seconds`, `*_count`. Values without a unit suffix are gone.

Upgrade by running the rename table below against your `flaker.toml`. The CLI refuses to start on a legacy config and points here.

| Section | Old key | New key | Unit |
|---|---|---|---|
| `[sampling]` | `percentage` | `sample_percentage` | 0-100 |
| `[sampling]` | `co_failure_days` | `co_failure_window_days` | days (int) |
| `[sampling]` | `detected_flaky_rate` | `detected_flaky_rate_ratio` | 0.0-1.0 |
| `[sampling]` | `detected_co_failure_strength` | `detected_co_failure_strength_ratio` | 0.0-1.0 |
| `[flaky]` | `detection_threshold` | `detection_threshold_ratio` | 0.0-1.0 |
| `[quarantine]` | `flaky_rate_threshold` | `flaky_rate_threshold_percentage` | 0-100 |
| `[profile.*]` | `percentage` | `sample_percentage` | 0-100 |
| `[profile.*]` | `co_failure_days` | `co_failure_window_days` | days (int) |
| `[profile.*]` | `adaptive_fnr_low` | `adaptive_fnr_low_ratio` | 0.0-1.0 |
| `[profile.*]` | `adaptive_fnr_high` | `adaptive_fnr_high_ratio` | 0.0-1.0 |

Unit interpretation also changed for `quarantine.flaky_rate_threshold_percentage`. Previously a bare `30.0` was treated as 30% and a bare `0.3` was auto-normalized. Now the value is taken literally as a percentage. If your old config had `flaky_rate_threshold = 0.3`, rename to `flaky_rate_threshold_percentage = 30`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/how-to-use.md
git commit -m "Rewrite how-to-use.md for new CLI hierarchy"
```

---

## Task 22: Mirror changes into docs/how-to-use.ja.md

**Files:**
- Modify: `docs/how-to-use.ja.md`

- [ ] **Step 1: Apply the same command rename as Task 20**

- [ ] **Step 2: Translate the config-migration section from Task 21 into Japanese**

- [ ] **Step 3: Commit**

```bash
git add docs/how-to-use.ja.md
git commit -m "Mirror how-to-use.ja.md against new CLI hierarchy"
```

---

## Task 23: Create docs/contributing.md

**Files:**
- Create: `docs/contributing.md`

- [ ] **Step 1: Write contributing.md**

```markdown
# Contributing to flaker

This document covers local development, sibling-repo dogfooding, and the MoonBit/TypeScript build pipeline. For user-facing usage, see [README.md](../README.md).

## Repository layout

- `src/cli/` — TypeScript CLI (commander)
- `src/` — MoonBit core library
- `tests/` — vitest tests
- `docs/` — user docs
- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans

## Build

```bash
pnpm install
pnpm build
```

The build produces `dist/cli/main.js` (bundled by Rolldown) and `dist/moonbit/flaker.js` (the MoonBit JS target, consumed by the CLI).

## Sibling checkout dogfood

When you want to test flaker against another project on your machine without publishing to npm:

```bash
# one-time setup in the flaker repo
pnpm install

# from the sibling project root (e.g. ../sample-webapp-2026)
node ../flaker/scripts/dev-cli.mjs run --dry-run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

`scripts/dev-cli.mjs` reuses `dist/cli/main.js` when it is current, auto-builds when sources are newer, and preserves the caller's cwd through `INIT_CWD`. Use `--rebuild` to force a fresh build.

If multiple local commands share the same `.flaker/data.duckdb`, run them sequentially — DuckDB is single-writer.

## MoonBit / TypeScript fallback

The CLI expects `dist/moonbit/flaker.js` for core algorithms. When it is missing, the TS fallback in `src/cli/core/loader.ts` loads a plain-JS implementation of the same contract. See `src/cli/core/` for the interface.

To build only the MoonBit side: `moon build --target js`.

## Tests

```bash
pnpm test                    # full suite
pnpm test <path>             # specific test
```

New CLI behaviors should come with a test under `tests/cli/`. Prefer integration tests that invoke `node dist/cli/main.js ...` through `execSync` over deep unit tests when exercising user-visible behavior.

## Commit style

This repository uses Conventional-style short commits (`verb: subject`). Link the spec path when a commit implements a design doc.

## Releases

See `CHANGELOG.md` for the version history.
```

- [ ] **Step 2: Commit**

```bash
git add docs/contributing.md
git commit -m "Add docs/contributing.md"
```

---

## Task 24: Sweep remaining docs for stale command names

**Files:**
- Modify: `docs/why-flaker.md`, `docs/why-flaker.ja.md`, `docs/introduce.ja.md`, `docs/diagnose.md`, `docs/runner-adapters.md`, `docs/test-result-adapters.md`, `docs/ml-test-selection-design.md`, `docs/sampling-strategy-evaluation-report.md`, `docs/sampling-strategy-evaluation-report.ja.md`, `docs/design-partner-rollout.ja.md`, `docs/coverage-guided-sampling.md`, `docs/duckdb-debug.md`, `docs/adr/*.md`

- [ ] **Step 1: Grep for old command references**

```bash
grep -rln "flaker collect-local\|flaker collect-coverage\|flaker flaky\|flaker reason\|flaker eval\|flaker sample\|flaker quarantine\|flaker check\|flaker confirm\|flaker retry\|flaker diagnose\|flaker bisect\|flaker doctor\|flaker kpi\|flaker insights\|flaker context\|flaker train\|flaker tune\|flaker self-eval\|flaker eval-fixture\|flaker eval-co-failure-window\|flaker affected\|flaker calibrate\|flaker import-parquet\|flaker query\|flaker test-key\|flaker report summarize" docs/
```

- [ ] **Step 2: For every match, rename per the table in Task 20**

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "Sweep docs for stale command names"
```

---

## Task 25: Update CI workflows and scripts

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/nightly-self-host.yml`, `scripts/dev-cli.mjs`, `scripts/self-host-review.mjs`

- [ ] **Step 1: Grep for old command strings**

```bash
grep -n "flaker " .github/workflows/*.yml scripts/*.mjs scripts/*.sh 2>/dev/null
```

- [ ] **Step 2: Rename per the table**

Watch especially for:
- `flaker run --profile ci` → unchanged (alias)
- `flaker run --profile scheduled` → unchanged (alias)
- `flaker collect --last` → `flaker collect --days`
- `flaker report summarize` → `flaker report summary`
- `flaker eval` (ambiguous) → `flaker analyze eval`
- `flaker kpi` → unchanged (alias)
- `flaker sample` → `flaker run --dry-run`

- [ ] **Step 3: Run workflow lint if available, otherwise eyeball**

Run: `gh workflow view ci.yml` if logged in, otherwise skip.

- [ ] **Step 4: Commit**

```bash
git add .github scripts
git commit -m "Update workflows and scripts for new CLI hierarchy"
```

---

## Task 26: Update TODO.md

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Mark completed items**

Items in `## sample-webapp-2026 で見えた UX 改善` that the spec implements (the flag precedence block, `flaker eval --output`, cold-start explanation) are already marked. Do not touch them. But add a new section at the top:

```markdown
## 0.1.0 CLI redesign (2026-04-10)

- [x] See docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md and docs/superpowers/plans/2026-04-10-flaker-cli-redesign.md
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "Note 0.1.0 CLI redesign in TODO"
```

---

## Task 27: CHANGELOG.md and version bump

**Files:**
- Create: `CHANGELOG.md`
- Modify: `package.json`, `moon.mod.json`

- [ ] **Step 1: Write CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 — 2026-04-10

### Breaking changes

This release restructures the CLI into a two-level category hierarchy, merges `sample` into `run --dry-run`, and renames config keys to follow a suffix-per-unit convention. There is no backward compatibility layer. Configs and scripts must be updated before upgrading.

See the [redesign spec](docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md) for the full rationale and the [config migration section](docs/how-to-use.md#config-migration) for the `flaker.toml` rename map.

#### Removed commands

- `flaker sample` — use `flaker run --dry-run` (add `--explain` for selection reasons).

#### Renamed commands

| Old | New |
|---|---|
| `flaker collect` | `flaker collect ci` (alias `flaker collect` preserved) |
| `flaker collect-local` | `flaker collect local` |
| `flaker collect-coverage` | `flaker collect coverage` |
| `flaker collect-commit-changes` | `flaker collect commit-changes` |
| `flaker calibrate` | `flaker collect calibrate` |
| `flaker import <file>` | `flaker import report <file>` |
| `flaker import-parquet <dir>` | `flaker import parquet <dir>` |
| `flaker affected` | `flaker exec affected` |
| `flaker report summarize` | `flaker report summary` |
| `flaker flaky` | `flaker analyze flaky` |
| `flaker reason` | `flaker analyze reason` |
| `flaker insights` | `flaker analyze insights` |
| `flaker eval` | `flaker analyze eval` |
| `flaker context` | `flaker analyze context` |
| `flaker query` | `flaker analyze query` |
| `flaker diagnose` | `flaker debug diagnose` |
| `flaker bisect` | `flaker debug bisect` |
| `flaker confirm` | `flaker debug confirm` |
| `flaker retry` | `flaker debug retry` |
| `flaker doctor` | `flaker debug doctor` |
| `flaker quarantine` | `flaker policy quarantine` |
| `flaker check` | `flaker policy check` |
| `flaker train` | `flaker dev train` |
| `flaker tune` | `flaker dev tune` |
| `flaker self-eval` | `flaker dev self-eval` |
| `flaker eval-fixture` | `flaker dev eval-fixture` |
| `flaker eval-co-failure-window` | `flaker dev eval-co-failure` |
| `flaker test-key` | `flaker dev test-key` |

Top-level aliases preserved: `flaker init`, `flaker run`, `flaker kpi`, `flaker collect`.

#### Renamed flags

- `flaker collect ci --last <days>` → `--days <n>`

#### Renamed config keys

See [docs/how-to-use.md#config-migration](docs/how-to-use.md#config-migration) for the full table. The CLI refuses to start on a legacy config and prints the rename hints.

#### New `debug confirm` exit codes

| Code | Verdict | Meaning |
|---|---|---|
| 0 | TRANSIENT | Not reproducible |
| 1 | FLAKY | Intermittent |
| 2 | BROKEN | Regression reproduced |
| 3 | ERROR | Runner or config failure |

### New features

- `flaker run --dry-run` — preview selection without executing.
- `flaker run --explain` — print per-test selection tier, score, and reason.
- `flaker setup init --adapter <type> --runner <type>` — generate populated `[adapter]` and `[runner]` sections.
- `flaker debug confirm --json` — machine-readable verdict output.
- `flaker analyze query` now has three example queries in `--help`.
- `flaker debug doctor` and `flaker policy check` validate config value ranges.
- Top-level `--help` is organized into Getting started, Daily workflow, and nine category sections.
```

- [ ] **Step 2: Bump versions**

In `package.json`:
```json
"version": "0.1.0"
```

In `moon.mod.json`:
```json
"version": "0.1.0"
```

- [ ] **Step 3: Verify smoke tests**

```bash
pnpm build
pnpm test
node dist/cli/main.js --help
node dist/cli/main.js debug doctor
node dist/cli/main.js run --dry-run --strategy random --count 1
```
Expected: all succeed.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md package.json moon.mod.json
git commit -m "Bump version to 0.1.0 and add CHANGELOG"
```

---

## Post-implementation self-review

Before declaring the branch ready:

- [ ] Run `pnpm build && pnpm test` — all green.
- [ ] Run `node dist/cli/main.js --help` and visually confirm the nine categories and four top-level aliases appear.
- [ ] Run `node dist/cli/main.js <category> --help` for all nine categories.
- [ ] Run `node dist/cli/main.js debug doctor` against the repo's own `flaker.toml`.
- [ ] Run `node dist/cli/main.js run --dry-run` against the repo.
- [ ] `grep -rn "flaker sample\|flaker collect-local\|collect-coverage\|collect-commit-changes\|flaker flaky\|flaker reason\|flaker eval\|flaker insights\|flaker context\|flaker query\|flaker diagnose\|flaker bisect\|flaker doctor\|flaker quarantine\|flaker check\|flaker confirm\|flaker retry\|flaker train\|flaker tune\|flaker self-eval\|flaker eval-fixture\|flaker eval-co-failure-window\|flaker test-key\|flaker affected\|flaker calibrate\|flaker import-parquet\|report summarize" README.md docs/ .github/ scripts/` — zero hits (except inside `CHANGELOG.md` and the spec itself).
- [ ] `grep -rn "percentage =\|detection_threshold =\|flaky_rate_threshold =\|co_failure_days =\|detected_flaky_rate =\|detected_co_failure_strength =\|adaptive_fnr_low =\|adaptive_fnr_high =" flaker.toml tests/fixtures/` — only the intentional `legacy-config` fixture should match.
