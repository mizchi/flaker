# flaker as a test database that feeds selectors and other consumers

- Date: 2026-09-24
- Status: design approved / not yet implemented
- 日本語: [2026-09-24-flaker-test-db-design.ja.md](2026-09-24-flaker-test-db-design.ja.md)
- Related: [mizchi/jev-test-filter](https://github.com/mizchi/jev-test-filter)

## Background

flaker's user-facing surface has grown too large.

- `run --gate` and `run --profile` are two names for the same concept (`src/cli/gate.ts`, `src/cli/profile-compat.ts`).
- `apply --emit weekly|incident` duplicates `ops weekly|incident`, down to a copied set of `--incident-*` flags.
- There are two KPI engines: `computeKpi` in `src/cli/commands/analyze/kpi.ts`, and `runSamplingKpi` via the MoonBit `build_sampling_kpi`.
- Calibration is only reachable through `apply --target calibrate`.
- There are seven selection strategies (`random` `weighted` `affected` `hybrid` `gbdt` `coverage-guided` `full`), multiplied by adaptive, holdout, cluster and silent fallback modes.
- The resolver factory (`src/cli/resolvers/index.ts`) is a closed switch; an external selector cannot be plugged in.
- Dead modules that no command registers remain (`commands/gate/`, `commands/policy/`, `commands/collect/{local,coverage}.ts`, `commands/exec/affected.ts`, `commands/setup/`).
- There is no defined shape for data leaving flaker. `query` exposes internal tables as they are, and `explain bundle`, `explain context` and `status --json` each emit their own shape.

jev-test-filter, meanwhile, scores every test against a git diff with the Jev model and emits the filter arguments the runner understands. As a selector it is better than flaker's own strategies. It can still miss a test that reaches the changed code only through a runtime indirection (a plugin registry, dependency injection, a fixture loaded by name), because it judges what the source shows. It has no mechanism of its own to discover those misses and learn from them.

Measured on flaker itself (`HEAD~3..HEAD`, 7 files changed): 47 of 824 tests selected, 5 requests, 5.2 s, $0.008. The selection reasons were `unsure` 37 / `dynamic` 6 / `scored` 3 / `touched` 1, so most of the selection is decided by the unsure rescue rather than by `cutoff`.

## Direction

**flaker is a test database.** It ingests test results, groups them under a stable identity, computes derived facts (flaky verdicts, co-failures, selector misses), and publishes them in a fixed shape. Test selection is left to selectors such as jev-test-filter; flaker never invokes a selector.

```
        ingest (adapters)                public datasets (flaker_v1)       consumers
  CI results (junit/playwright/…) ─┐    ┌─ tests            ┌→ jev-test-filter (context)
  jev record                       ├──→ ├─ runs / results   ├→ AI agents (explain bundle)
  local run / mutation trial      ─┘    ├─ flaky            ├→ dashboards / BI (Parquet)
                                        ├─ quarantine       ├→ other selectors
                                        ├─ co_failures      └→ issues / PR comments
                                        ├─ selector_verdicts / misses
                                        └─ gate_calibration
```

- The gate (score → selected) exists only in the selector. flaker supplies gate parameters and does not duplicate the decision logic.
- flaker keeps only `affected`, `weighted`, `hybrid` and `full` as its own selection, for users without an API key. `hybrid` is what `init` generates for the merge gate. Holdout stays because it is measurement (the basis of the promotion decision), not selection.

## Three layers

1. **Storage (internal).** The existing DuckDB tables. Their schema may change freely. Reading them directly from outside is not supported.
2. **Public datasets (the contract).** A set of views in the DuckDB schema `flaker_v1`. Each dataset has a JSON Schema in `src/contracts`. Within v1, only column additions are allowed; removing, renaming or changing the meaning of a column requires a new `flaker_v2`. `flaker query` targets this layer by default. External tools may open the DuckDB file directly, but may only read `flaker_v1.*`.
3. **Projections (per consumer).** A dataset reshaped for one consumer. The first built-in projection is `jev-context`, for jev-test-filter. A projection is registered in code as a triple: a JSON Schema, a pure function (dataset rows → output), and fixture tests. Projections defined by arbitrary external SQL are out of scope.

So that no fact is computed separately by several outputs, `status`, `explain` and `calibrate` move onto the dataset layer over time (phase 3).

## Public datasets (flaker_v1)

Every dataset shares the key `test_key`, the stable ID from MoonBit `create_stable_test_id`.

| Dataset | Main columns | Content |
|---|---|---|
| `tests` | `test_key`, `suite`, `test_name`, `task_id`, `variant`, `file`, `title_path` (JSON array), `first_seen_at`, `last_seen_at` | Test identity. `file` + `title_path` is what selectors are matched on |
| `runs` | `run_id`, `source` (`ci` / `local` / `mutation`), `workflow_name`, `lane`, `commit_sha`, `branch`, `event`, `is_full`, `created_at` | One execution. `is_full` says whether the whole suite ran |
| `results` | `run_id`, `test_key`, `status`, `retry_count`, `duration_ms`, `created_at` | Per-test results |
| `flaky` | `test_key`, `window_days`, `runs`, `failures`, `flaky_rate`, `is_flaky`, `computed_at` | Flaky verdicts |
| `quarantine` | `test_key`, `reason`, `since`, `source` (`auto` / `manual`) | Quarantined tests |
| `co_failures` | `changed_file`, `test_key`, `co_failures`, `changes`, `strength`, `window_days` | "This test failed when this file changed", aggregated |
| `selector_verdicts` | `selector_run_id`, `selector`, `selector_version`, `head_sha`, `base_sha`, `context_digest`, `source` (`real` / `mutation`), `test_key`, `score`, `confidence`, `reason`, `selected` | A selector's per-test decisions |
| `misses` | `selector_run_id`, `test_key`, `head_sha`, `ci_run_id`, `reason`, `changed_files` (JSON array) | Tests the selector did not select that really failed in a full run on the same commit. Only the latest real selector run per `head_sha` counts, and a verdict the record quarantined is not a miss |
| `gate_calibration` | `selector`, `calibrated_at`, `cutoff`, `unsure_below`, `unsure_margin`, `records`, `real_failures`, `recall_lb95`, `decision` (`tighten` / `loosen` / `keep`), `rationale` | History of calibration results. The latest row is the current value |

`runs.is_full` comes from `full = true` on a lane in `[workflow_lanes]`. For a lane without it, a run counts as full when its result count is at least 95% of the recent `tests` count.

## CLI: output

- `flaker export <dataset> [--format json|jsonl|csv|parquet] [--since <date>] [--where <expr>] [-o <file>]` is the generic output path.
- `flaker export --projection <name> [-o <file>]` emits a projection. `jev-context` is emitted this way (`flaker export --projection jev-context -o .flaker/context.json`). There is no separate `context` command.
- `flaker query <sql>` uses `flaker_v1` as its default search path. Reading internal tables requires `--internal`.

## CLI: ingest

- flaker owns the ingest contract too. A selector's decisions arrive as flaker's `selector-record` v1: per-test `score` / `confidence` / `reason` / `selected`, plus `head_sha` / `base_sha` / `context_digest` and the gate values used.
- `flaker import --adapter selector-record <file|dir>` ingests that format as it is. `flaker import --adapter jev <file|dir>` converts jev's record v2 into `selector-record` v1 first. Any other selector that emits the same format can be calibrated the same way.

## Projection: `jev-context` (flaker → jev-test-filter)

```json
{
  "version": 1,
  "digest": "sha256:…",
  "generated_at": "2026-09-24T00:00:00.000Z",
  "gate": {
    "cutoff": 2.0,
    "unsure_below": 0.5,
    "unsure_margin": 1.0,
    "basis": { "records": 42, "real_failures": 17, "recall_lb95": 0.83 }
  },
  "skip": [
    { "file": "tests/a.test.ts", "title_path": ["A", "b"], "reason": "quarantined" }
  ],
  "tests": [
    {
      "file": "tests/cli/init.test.ts",
      "title_path": ["init", "writes toml"],
      "failed_with": ["src/cli/config.ts"],
      "missed": 2
    }
  ]
}
```

- Sources: `gate` is the latest `gate_calibration` row, `skip` comes from `quarantine`, and `tests` is built from `misses` and `co_failures`.
- A test is keyed by `file` + `title_path` (+ Playwright `project`). jev's `testId` includes the line number, which changes across commits, so it is not used as the key.
- `digest` is the sha256 of the normalized JSON of `skip` and `tests`, excluding `gate`. Hints change the questions, so the record keeps this digest and it becomes the unit of comparison.
- Hint limits: at most the top 5 files per test in `failed_with`, and at most 200 tests with hints by default, to bound token growth.
- What jev does with it:
  - `tests[].failed_with` is injected only into that test's `question.instructions.history`, as a fact with no threshold (e.g. `This test previously failed when src/cli/config.ts changed.`). jev's rule that no threshold appears in a question still holds.
  - Tests in `skip` are removed from the candidates and reported with `reason: "quarantined"`.
  - `gate` supplies the defaults. An explicit `--cutoff` or similar on the command line wins.

## Changes in jev-test-filter (upstream)

- `--context <file>` reads the projection above.
- Every successful run is saved to `.jev-test-filter/records/<head_sha>.json`. `last.json` is still written, so the default `--replay` keeps working.
- `RunRecord` moves to `version: 2` and gains `head_sha`, `base_sha`, `context_digest` (`null` without a context) and `gate` (the values actually used). Reading v1 stays supported. It also records `quarantined` (the `testId`s the context's `skip` removed), so a replay reproduces the quarantine.
- A run that fell back (`fallback !== null`) is still not saved.
- `unsure_below` and `unsure_margin` become settable from the command line.

## Calibration: `flaker calibrate`

1. **Join.** Join `selector_verdicts.head_sha` to a full run on the same commit (`runs.is_full`). The ground truth is "tests that failed in the full run − `flaky.is_flaky` − `quarantine`". Failures that cannot be matched by identity are reported as `unmatched`, with a count and a list, and are not counted as misses. The result lands in `misses`.
2. **Replay.** Using jev-test-filter's `./gate` export, re-gate every record offline over a grid of `cutoff × unsure_below × unsure_margin`. No API calls.
3. **Adoption rule: tighten at once, loosen with care.**
   - A candidate that misses even one observed real failure is rejected.
   - If the current settings have a miss, switch at once to the candidate with the fewest selected tests among those that catch every real failure (`decision = tighten`).
   - Loosening beyond the defaults (selecting fewer tests) is allowed only when there are at least `min_failures` real failures with `source = real` (default 20) and the Wilson 95% lower bound of recall is at least `recall_target` (default 0.90) (`decision = loosen`).
   - Otherwise keep the current values and record why in `rationale` (`decision = keep`).
   - On a tie, prefer the candidate closest to the defaults.
4. **Output.** Append one row to `gate_calibration`. No file is written. `--dry-run` does not append the row either. `--json` prints a machine-readable result. When a context file is needed, run `flaker export --projection jev-context` afterwards.

Limitation: a record's scores answer questions that already included the hints, and re-scoring with new hints needs the API. Hints only push the score of a hinted test up, so calibrating the gate over records with mixed digests errs on the conservative side. Reports are split by digest.

Configuration:

```toml
[selector]
type = "jev"
recall_target = 0.90
min_failures = 20
max_hinted_tests = 200
```

Gate values are not kept in `flaker.toml`. The source of truth is `gate_calibration` in the database.

## Synthetic evaluation with mutations (later phase)

`flaker calibrate --mutate <n>`:

1. Pick functions from the files changed in recent commits and apply simple mutations (flip a comparison operator, flip a boolean return, insert an early return).
2. Run the full suite in a temporary worktree and ingest the results with `runs.source = mutation`.
3. Run jev-test-filter against the same mutation diff and ingest its decisions with `selector_verdicts.source = mutation`.
4. Remove the temporary worktree. The user's working tree is never touched.

Reports show real and mutation results separately. Mutations are distributed differently from real changes, so only real failures count towards the loosening condition; mutations can only justify tightening.

## CLI shape after the cleanup

| Keep / new | Merge / remove |
|---|---|
| `init` `import` `status` `query` `doctor` | `run --profile` removed in favour of `--gate`. Config moves from `[profile.local\|ci\|scheduled]` to `[gate.iteration\|merge\|release]`, and the environment variable from `FLAKER_PROFILE` to `FLAKER_GATE`. The old forms are a hard error that points to the migration guide |
| **`export`** (datasets and projections) | `apply --emit` / `--target` / `--incident-*` removed, and the `ops` group with them |
| **`calibrate`** (promoted to top level) | strategies `random` `gbdt` `coverage-guided`; `cluster_mode`, `model_path`, the adaptive keys, `[coverage]`, `dev train` |
| **`import --ci [--days <n>]`** (collect CI artifacts; replaces `apply --target collect_ci`) | `dev` leaves the public surface as a hidden command |
| `run` (`affected` / `weighted` / `hybrid` / `full`; `fallback_strategy` and holdout stay) | `explain context` and `explain bundle` move to `export --projection` (after phase 2) |
| `quarantine` `debug` `explain` | dead modules removed (`commands/gate/`, `commands/policy/`, `commands/collect/{local,coverage}.ts`, `commands/exec/affected.ts`, `registerAnalyzeCommands`) |
| `plan` / `apply` (reconcile only) | KPI unified on MoonBit `build_sampling_kpi` (from phase 2 on, when it moves onto the dataset layer) |

`commands/setup/init.ts` implements `flaker init` and is not dead; only the help text's mention of `setup init` goes.

## Phases

1. **jev-test-filter upstream:** `--context`, per-SHA records (`RunRecord` v2), CLI flags for the unsure parameters. Minor release (0.2.0).
2. **flaker test-DB layer + jev integration (additive only):** the nine `flaker_v1` datasets with their JSON Schemas, `export`, `import --adapter selector-record|jev`, `calibrate`, and the `jev-context` projection. Minor release.
3. **flaker surface cleanup (breaking):** the merges and removals in the table above, and a migration guide (`docs/migration-*.md` / `.ja.md`). The parts that do not depend on the dataset layer (the single gate vocabulary, strategy removal, `calibrate` / `import --ci`, the `apply` / `ops` / `dev` cleanup, dead modules) may land before phase 2. Moving `explain`, rebuilding `status` and unifying the KPI engines wait for phase 2.
4. **Mutation evaluation:** `calibrate --mutate`.

Each phase is its own PR. Phase 2 depends on the phase 1 release; phases 3 and 4 are independent of each other.

## Testing

- Contracts: JSON Schemas for every `flaker_v1` dataset, `selector-record` v1, `jev-context` v1 and jev record v2, each validated against fixtures.
- Datasets: load fixtures into the storage layer, read the views, and check that they match their schemas, that `is_full` is decided correctly, and that `misses` is derived correctly (flaky, quarantined and unmatched failures excluded).
- The core of calibrate is a pure function (records + ground truth + current gate → adopted gate + rationale), covered by table tests for every adoption rule: a miss tightens at once, too few failures keeps, the condition met loosens, and mutations never justify loosening.
- Projection: a pure function from dataset rows to `jev-context`, tested for hint limits and ranking and for a stable digest.
- End to end: synthesize a CI run and a jev record with the `dev eval-fixture` tooling, and check that import → calibrate → export → jev replay completes a full loop.
- On the jev side: snapshots of questions after context injection, removal of `skip` tests, command-line flags winning over the context, and saving record v2 while still reading v1.

## Out of scope

- Selectors and projections other than jev (the contracts are open, so they can be added later).
- External projections defined by arbitrary SQL.
- flaker spawning a selector (building jev into flaker `run`).
- Tuning the natural-language template for hints (start with one fixed sentence).
