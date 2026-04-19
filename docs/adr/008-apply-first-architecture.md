# ADR-008 — Apply-first architecture

> **Status**: Accepted, 2026-04-20.
> **Supersedes**: [ADR-001 architecture overview](./001-architecture-overview.md).

## Context

flaker began life under the product name "metrici". ADR-001 was written during that phase and
describes a 0.5-era CLI surface of eleven heterogeneous sub-commands (init, collect,
collect-local, import, flaky, sample, run, query, quarantine, bisect, eval) plus an orchestrator
that required operators to call them in the right order. It also reflects the pre-rebrand module
naming (`metrici CLI`, `MetriciCore`) and the pre-DuckDB storage assumptions.

The product was renamed from "metrici" to "flaker" during the 0.5.x cycle. 0.6.0 introduced a
declarative plan/apply model: `flaker.toml` becomes the single desired-state document, and a
reconciler loop computes what is out of sync and executes the minimum set of corrective actions.
The approach was chosen because empirical testing across multiple evaluation rounds (subagent-driven
calibration) showed that imperative call-order memorization was the dominant failure mode for both
human operators and AI assistants.

0.7.0 reduced the CLI surface from 53 total commands and aliases to 11 primary commands by
collapsing the `collect*`, `analyze*`, `gate*`, and `policy*` families behind `apply`, `status`,
and `run`. Legacy aliases were hard-removed in 0.8.0. 0.8.0–0.10.0 completed terraform-parity
flag coverage (`--target`, `--refresh-only`, `--plan-file`, `--force`, `--emit`), added DuckDB
migrations, and further aligned the `flaker status` drift vocabulary with the reconciler.

ADR-001 predates all of the above. It is retained for historical context; this document is the
authoritative description of the current architecture as of 0.10.x.

## Decision

### Layered architecture

```
flaker.toml (DesiredState)   ──┐
                               ├── computeStateDiff() ──> StateDiff ──> planApply() ──> PlannedAction[]
DuckDB + RepoProbe             ┘                                                               │
(ObservedState)                                                                                ▼
                                                               executeDag(actions, deps)
                                                               per-node: ok | failed | skipped
```

**flaker.toml** is the single source of truth for desired state. The relevant sections are:

- `[promotion]` — `PromotionThresholds` (`matched_commits_min`, `false_negative_rate_max_percentage`,
  `pass_correlation_min_percentage`, `holdout_fnr_max_percentage`, `data_confidence_min`).
  Defaults live in `DEFAULT_PROMOTION` in `src/cli/config.ts`.
- `[quarantine]` — `auto`, `flaky_rate_threshold_percentage`, `min_runs`.
- `[sampling]` — strategy, holdout ratio, cluster mode, and calibration-written fields.
- `[profile.*]` — per-gate execution profiles (`local`, `ci`, `scheduled`, plus custom).

**DuckDB** (`src/cli/storage/duckdb.ts`, DDL in `src/cli/storage/schema.ts`) plus a runtime
`RepoProbe` hold observed state. `RepoProbe` captures environment signals (git remote presence,
`GITHUB_TOKEN`, local history existence) that cannot be stored in the database.

**`computeStateDiff(desired, observed)`** (`src/cli/commands/apply/state.ts`) computes a
`StateDiff` — an `{ ok: boolean; drifts: StateDiffField[] }` pair. Each `StateDiffField` is a
discriminated union entry describing one reconciler-addressable delta:

| kind | meaning |
|------|---------|
| `matched_commits` | fewer matched commits than the promotion threshold |
| `false_negative_rate` | FNR above threshold (or no data) |
| `pass_correlation` | correlation below threshold (or no data) |
| `holdout_fnr` | holdout FNR above threshold (or no data) |
| `data_confidence` | confidence rank below `data_confidence_min` |
| `quarantine_pending` | auto-quarantine enabled but pending tests > 0 |
| `local_history_missing` | no local sampling history recorded |
| `history_stale` | CI history not refreshed within the staleness window |

**`planApply(input)`** (`src/cli/commands/apply/planner.ts`) accepts `{ config, kpi, probe }`,
calls `computeStateDiff`, then derives `PlannedAction[]` from the diff. The four action kinds are:

| kind | trigger condition |
|------|-----------------|
| `collect_ci` | `GITHUB_TOKEN` present (always queued when token available) |
| `calibrate` | data confidence is `moderate` or `high` |
| `cold_start_run` | no local history present |
| `quarantine_apply` | `quarantine.auto=true` and data confidence is `moderate` or `high` |

Each action carries an optional `driftRef: StateDiffField[]` linking it to the specific diff
entries that motivated it.

**`executeDag(actions, deps)`** (`src/cli/commands/apply/dag.ts`) runs the action list respecting
a hard-coded dependency map:

```
collect_ci     → (no deps)
calibrate      → collect_ci
cold_start_run → (no deps)
quarantine_apply → calibrate
```

Peers whose dependencies are absent from the plan or already resolved run concurrently via
`Promise.all`. A node that fails causes its dependents to be marked `skipped`; independent branches
continue. The per-node status is `"ok" | "failed" | "skipped"`.

**`executePlan()`** (`src/cli/commands/apply/executor.ts`) is a deprecated thin wrapper kept for
legacy callers; it delegates to `executeDag` and maps `DagExecutedAction → ExecutedAction`
(binary ok/error). New code should call `executeDag` directly.

**Artifacts** (`src/cli/commands/apply/artifact.ts`) are serializable JSON snapshots:

- `PlanArtifact` — `{ generatedAt, diff, actions, probe }`. Written by `flaker plan --output` or
  `flaker apply --refresh-only --output`.
- `ApplyArtifact` — `PlanArtifact` fields plus `executed: DagExecutedAction[]` and an optional
  `emitted` cadence report. Written by `flaker apply --output`.

`flaker apply --plan-file <file>` deserializes a saved `PlanArtifact`, checks for new drift since
the plan was saved (warns if found; blocks execution unless `--force` is passed), then executes the
stored action list via `executeDag`.

### Primary CLI surface (0.10.x)

The 11 primary commands registered in `src/cli/main.ts`:

| command | description |
|---------|-------------|
| `init` | Bootstrap `flaker.toml` (alias for `flaker setup init`) |
| `plan` | Preview actions `apply` would take for the current repo state |
| `apply` | Reconcile repo to `flaker.toml` (idempotent; safe to re-run) |
| `status` | KPI dashboard + promotion drift |
| `run` | Execute the selected gate or profile |
| `doctor` | Check runtime requirements |
| `debug` | Incident investigation (`retry`, `confirm`, `bisect`, `diagnose`) |
| `query` | Read-only SQL escape hatch against the metrics database |
| `explain` | AI-assisted per-test or per-suite analysis |
| `import` | Ingest result reports (adapter auto-detected) |
| `report` | Local report shaping (`--summary`, `--diff`, `--aggregate`) |

`ops weekly` / `ops incident` are first-class cadence bundles registered under a separate category.
`ops daily` is deprecated in 0.9.0 and replaced by `flaker apply --emit daily`. `dev` commands are
maintainer-only tooling (train, tune, self-eval, etc.).

Key flags on `apply` (`src/cli/categories/apply.ts`):

| flag | semantics |
|------|-----------|
| `--output <file>` | Write `ApplyArtifact` JSON to a file |
| `--emit <daily\|weekly\|incident>` | Generate a cadence artifact alongside apply |
| `--target <kind>` | Run only actions of the specified kind |
| `--refresh-only` | Run probe + diff + plan but skip execution |
| `--plan-file <file>` | Load a saved `PlanArtifact` and execute its stored actions |
| `--force` | Execute even when repo state has drifted from the plan file |
| `--incident-*` | Incident context flags for `--emit incident` |

### Storage

DuckDB tables (source of truth: `src/cli/storage/schema.ts`):

**Primary tables** (owned by the reconciler and KPI layer):

| table | purpose |
|-------|---------|
| `workflow_runs` | CI run metadata (id, repo, branch, sha, event, status, duration) |
| `test_results` | Per-test outcomes, linked to `workflow_runs` |
| `sampling_runs` | Local sampling execution metadata |
| `quarantined_tests` | Legacy quarantine manifest keyed by `(suite, test_name)` |
| `quarantined_test_identities` | Current quarantine manifest keyed by stable `test_id` |

**Peripheral tables**:

| table | purpose |
|-------|---------|
| `sampling_run_tests` | Test list for each sampling run |
| `commit_changes` | File-level diff data for affected-test analysis |
| `test_coverage` | Test-to-edge coverage mapping (for coverage-aware sampling) |
| `collected_artifacts` | Artifact download tracking for CI collection |

Note: the ADR specification refers to "quarantine_manifest" and "coverage_edges" as table names.
The actual DDL uses `quarantined_test_identities` (stable-id quarantine) and `test_coverage`
(coverage edges). The schema also includes legacy `quarantined_tests` (suite+name keyed).

### Language boundary (TypeScript vs. MoonBit)

**MoonBit** (`src/graph/graph_core.mbt`) is compiled to a JavaScript bundle (JS target) and loaded
at runtime via `src/cli/core/loader.ts`. MoonBit owns:

- Flaky detection algorithm (`detect_flaky_json`)
- Sampling primitives: `sample_random`, `sample_weighted`, `sample_hybrid`
- Sampling meta construction (`build_sampling_meta`)
- Dependency graph algorithms: `find_affected_nodes`, `expand_transitive`, `build_reverse_deps`,
  `topological_sort`, `get_affected_test_patterns`
- Coverage-aware selection (`select_by_coverage`)
- GBDT training and inference (`train_gbdt`, `predict_gbdt`)
- KPI reducers and fixture generation

**TypeScript** owns:

- The reconciler loop (plan / apply / DAG executor)
- CLI registration and flag parsing (Commander)
- DuckDB access and all SQL
- GitHub API integration (Octokit / actrun)
- Test runner integration (playwright, vitest, jest, junit, custom, moontest, actrun)
- Report adapters and result parsers
- Resolver implementations for affected-test analysis

**The seam** is `src/cli/core/loader.ts`. The exported `MetriciCore` interface defines the
contract between TypeScript callers and the MoonBit core. The interface name `MetriciCore` is
a pre-rename artifact; it is scheduled to be renamed to `FlakerCore` in PR #68 (in-progress at
the time of this ADR). `loadCore()` attempts to load the compiled MoonBit JS bundle; on miss it
falls back to `createTypeScriptFallbackCore()`.

### Extensibility points

- **Adapters** (`src/cli/adapters/*.ts`): playwright, vitest, junit, actrun, moontest, custom,
  vrt-migration, vrt-bench, gotest, cargo, tap, istanbul-coverage, v8-coverage, playwright-coverage.
- **Runners** (`src/cli/runners/*.ts`): vitest, playwright, actrun, moontest, custom, direct,
  orchestrator.
- **Resolvers** (`src/cli/resolvers/*.ts`): simple, workspace, glob, graph, moon, bitflow-native,
  bitflow-workflow.

## Rationale

- **Declarative plan/apply** was chosen because empirical testing (subagent-driven evaluation
  across multiple iterations during the 0.6–0.10 development cycle) showed that imperative
  CLI call-order memorization was the dominant failure mode for both human operators and AI
  assistants. A single verb (`apply`) replaces the prior workflow of collect → calibrate →
  quarantine suggest → quarantine apply → run cold-start.

- **DAG executor** replaces an abort-on-first-failure linear executor because many planned
  actions are logically independent. `collect_ci` and `cold_start_run` have no shared
  dependencies and can run in parallel. `quarantine_apply` only cares about `calibrate`, not
  about `collect_ci` directly. The hard-coded dependency map captures these semantics without
  requiring a full resource-graph model.

- **StateDiff-first model** ensures that `flaker status` and `flaker plan` share the same drift
  vocabulary as the reconciler. The `Promotion drift` section in `flaker status` output is
  computed by the same `computeStateDiff` path that drives `planApply`.

- **Advisory-first rollout**: `flaker apply` is safe to run at any time without breaking
  production; it is idempotent and produces a readable plan before executing. `--refresh-only`
  and `--plan-file` support staged apply workflows (generate plan in CI, review, apply in a
  separate step) without requiring terraform's full resource-graph semantics.

## Consequences

- **Good**: Operators and AI assistants learn one primary verb (`apply`) rather than a sequence
  of sub-commands. `--target` and `--plan-file` provide terraform-style ergonomics (scoped
  partial reconciliation, stored plans) without the complexity of a full resource graph.
- **Good**: Breaking CLI surface changes in 0.7 → 0.8 → 0.10 cost fewer than one session each to
  execute (including tests, docs, and skill rewrites) because the surface is small and
  co-located.
- **Good**: `flaker status` and `flaker plan` share the `StateDiff` vocabulary, giving operators
  a consistent mental model across inspection and reconciliation workflows.
- **Trade-off**: The project has shipped three breaking minor versions in the 0.6–0.10 range
  (0.7.0, 0.8.0, 0.10.0). This is intentional — we remain on 0.x semantics until empirical
  stability across real-world repos justifies a 1.0 commitment.
- **Trade-off**: The MoonBit interface name `MetriciCore` is a visible pre-rename artifact.
  Until PR #68 lands, callers importing from `src/cli/core/loader.ts` must use the legacy name.

## Non-goals

- **kubectl-level resource diff**: `StateDiff` is field-level (promotion metrics, quarantine
  queue depth, history staleness), not resource-level. There is no plan to model arbitrary
  "resources" with create/update/delete lifecycle.
- **Cross-platform parity**: `apply` targets repositories using GitHub Actions with a
  DuckDB-compatible Node.js 24+ runtime. Windows and non-GitHub CI are out of scope for the
  reconciler.
- **Standalone MoonBit core product**: The MoonBit bundle is an internal implementation detail.
  The TypeScript fallback (`createTypeScriptFallbackCore`) ensures the tool remains usable
  without a MoonBit build present.

## References

- [ADR-002](./002-dependency-resolver-strategy.md) — dependency resolver strategy
- [ADR-003](./003-runner-adapter-and-orchestration.md) — runner, adapter, and orchestration
- [ADR-004](./004-moonbit-js-target-integration.md) — MoonBit JS target integration
- [ADR-005](./005-actrun-integration.md) — actrun integration
- [ADR-006](./006-graph-analysis-ownership.md) — graph analysis ownership
- [ADR-007](./007-build-cache-ownership.md) — build cache ownership
- `docs/migration-0.6-to-0.7.md` — user-facing migration path across breaking changes
- `docs/superpowers/plans/*.md` — per-release implementation plans
- `src/cli/storage/schema.ts` — DuckDB DDL source of truth
- `src/cli/core/loader.ts` — `MetriciCore` interface and `loadCore()` entry point
- `src/cli/commands/apply/` — planner, state, dag, executor, artifact modules
- `src/cli/categories/apply.ts` — CLI flag registration for `plan` and `apply`
