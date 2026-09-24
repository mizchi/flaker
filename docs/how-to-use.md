# flaker — Flaky Test Detection & Test Sampling CLI

Too many tests to run them all. CI keeps failing on flaky tests. Can't tell what's really broken. flaker solves these problems.

[日本語版](how-to-use.ja.md)

This page is the **detailed command reference**.

- day-to-day usage entrypoint: [usage-guide.md](usage-guide.md)
- operations entrypoint: [operations-guide.md](operations-guide.md)
- onboarding checklist: [new-project-checklist.md](new-project-checklist.md)

## Installation

```bash
# Add to your npm/pnpm project
pnpm add -D @mizchi/flaker

# Or run directly
pnpm dlx @mizchi/flaker --help
```

### Dogfooding From a Sibling Checkout

```bash
# one-time setup in ../flaker
pnpm --dir ../flaker install

# from your project root
node ../flaker/scripts/dev-cli.mjs run --dry-run --gate iteration --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --gate iteration --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs status --markdown --output .artifacts/flaker-review.md

# optional: force rebuild after editing flaker itself
node ../flaker/scripts/dev-cli.mjs --rebuild run --gate iteration --changed src/foo.ts
```

`scripts/dev-cli.mjs` auto-builds `dist/cli/main.js` and `dist/moonbit/flaker.js` when they are missing, and also rebuilds when source files are newer than `dist`. If you prefer pnpm scripts, `pnpm --dir ../flaker run dev:cli -- ...` also preserves the caller repo through `INIT_CWD`.

If multiple local commands share the same `.flaker/data.duckdb`, run them sequentially. DuckDB is single-writer, so parallel dogfood runs can conflict on the DB lock.

## Quick Start

### 1. Initialize

```bash
flaker init --owner your-org --name your-repo
```

Generates `flaker.toml`.

### 2. Collect Data

Fetch test results from GitHub Actions:

```bash
export GITHUB_TOKEN=$(gh auth token)
flaker import --ci --days 30
```

Or import local test reports directly:

```bash
# Playwright JSON report
pnpm exec playwright test --reporter json > report.json
flaker import report.json --adapter playwright --commit $(git rev-parse HEAD)

# JUnit XML report
flaker import results.xml --adapter junit --commit $(git rev-parse HEAD)

# Built-in vrt-harness migration-report.json adapter
flaker import ../vrt-harness/test-results/migration/migration-report.json \
  --adapter vrt-migration \
  --commit $(git rev-parse HEAD)

# Built-in vrt-harness bench-report.json adapter
flaker import ../vrt-harness/test-results/css-bench/dashboard/bench-report.json \
  --adapter vrt-bench \
  --commit $(git rev-parse HEAD)

# Custom adapter for arbitrary formats
flaker import ../vrt-harness/test-results/migration/migration-report.json \
  --adapter custom \
  --custom-command "node --experimental-strip-types ../vrt-harness/src/flaker-vrt-report-adapter.ts --scenario-id migration/tailwind-to-vanilla --backend chromium" \
  --commit $(git rev-parse HEAD)
```

### 3. Analyze

```bash
# List flaky tests
flaker status --list flaky

# AI-powered analysis with recommended actions
flaker explain reason

# Test suite health score
flaker status --markdown
```

### 4. Select & Run Tests

```bash
# Weighted random sampling (flaky tests prioritized), 20 tests
flaker run --strategy weighted --count 20

# Only tests affected by your changes
flaker run --strategy affected

# Affected + previously failed + new + random (recommended)
flaker run --strategy hybrid --count 50
```

---

## Configuration (`flaker.toml`)

```toml
[repo]
owner = "your-org"
name = "your-repo"

[storage]
path = ".flaker/data.duckdb"

# Test result parsing format
[adapter]
type = "playwright"     # "playwright" | "junit" | "vrt-migration" | "vrt-bench" | "custom"
artifact_name = "playwright-report"
# command = "node ./adapter.js"  # required only for custom

# Test runner
[runner]
type = "vitest"         # "vitest" | "playwright" | "moontest" | "custom"
command = "pnpm exec vitest run"

# Dependency analysis for affected strategy
[affected]
resolver = "workspace"  # "simple" | "workspace" | "moon" | "bitflow"

# Auto-quarantine flaky tests
[quarantine]
auto = true
flaky_rate_threshold_percentage = 30   # Quarantine candidate above this %
min_runs = 10                           # Minimum runs before making judgments

# Flaky detection parameters
[flaky]
window_days = 14                       # Analysis window
detection_threshold_ratio = 0.02       # Mark as flaky above this ratio
```

---

## Command Reference

### `flaker plan` / `flaker apply` — Declarative convergence

```bash
flaker plan           # Show the diff against current state (dry-run)
flaker plan --json
flaker plan --output .artifacts/flaker-plan.json   # Persist PlanArtifact

flaker apply          # Auto-run import --ci / calibrate / cold-start run / quarantine apply to close the gap
flaker apply --json
flaker apply --output .artifacts/flaker-apply.json # Persist ApplyArtifact

flaker apply --refresh-only          # Probe + diff + plan, skip execution
flaker apply --plan-file plan.json   # Execute a previously-saved PlanArtifact
```

`flaker.toml` is treated as the **desired state**, and the planner inspects the current DB state to decide what to do. A brand-new repo with no history gets `collect_ci` + `cold_start_run`; a repo with enough history gets `collect_ci` + `calibrate` + `quarantine_apply`. The user does not have to memorize the ordering.

`flaker status` compares the `[promotion]` thresholds against the current KPIs and reports drift.

#### `--json` output shape

`flaker apply --json`:

- `executed[*].status`: `"ok" | "failed" | "skipped"`
- `executed[*].skippedReason?: string`: reason why a step was skipped due to a dependency failure
- Exit code is 1 only when `status === "failed"`; skipped is 0
- 0.13.0 removed the top-level `emitted` field from `ApplyArtifact` JSON

`flaker status --json`'s `drift.unmet[*]` uses `{ kind, desired }`.

#### Weekly / incident cadence (0.13.0)

The old cadence-artifact subcommands are gone as of 0.13.0 (see [docs/migration-0.12-to-0.13.md](docs/migration-0.12-to-0.13.md) for the full mapping). Use instead:

- Daily/weekly review: `flaker apply && flaker status --markdown > .artifacts/flaker-review.md`, plus `flaker explain insights` for threshold-drift narrative
- Incident investigation: `flaker debug retry` / `flaker debug confirm` / `flaker debug diagnose`

### `flaker import --ci` — Collect from CI

```bash
flaker import --ci                                           # Last 30 days
flaker import --ci --days 90                                 # Last 90 days
flaker import --ci --branch-filter main                      # main branch only
```

Auto-extracts test reports from GitHub Actions artifacts. The default artifact name is `playwright-report` for `playwright`, `junit-report` for `junit`, `migration-report` for `vrt-migration`, and `bench-report` for `vrt-bench`. Override it with `[adapter].artifact_name` when your workflow uses a different artifact name. Requires `GITHUB_TOKEN` environment variable.

A complete GitHub Actions example is available at [examples/github-actions/collect-summary.yml](../examples/github-actions/collect-summary.yml).

### `flaker import` — Import Local Reports

```bash
flaker import report.json --adapter playwright
flaker import results.xml --adapter junit
flaker import migration-report.json --adapter vrt-migration
flaker import bench-report.json --adapter vrt-bench
flaker import migration-report.json --adapter custom --custom-command "node ./adapter.js"
flaker import report.json --commit abc123 --branch feature-x
```

Import locally-generated test reports directly into the database.

With `--adapter custom`, you provide an arbitrary command that receives the file contents on stdin and returns `TestCaseResult[]` JSON on stdout. This is the bridge for importing non-Playwright / non-JUnit report formats.

#### `vrt-migration` adapter — versioned schema (recommended)

The `vrt-migration` adapter accepts two formats:

1. **Legacy**: `{ dir, variants[], viewports[], results[] }` (0.3.x compatible)
2. **Versioned** (recommended): `{ schema: "studio-vrt-flaker", schemaVersion: 1, dir, results[] }`

The versioned format can express interaction scenarios (click / hover / input / scroll) with a stable identity. In the legacy format the only way to represent interaction scenarios was to cram `#interaction-*` into the variant name, which caused scenarios within the same domain to be split across separate suites.

Versioned shape:

```json
{
  "schema": "studio-vrt-flaker",
  "schemaVersion": 1,
  "dir": "regression/preview-vs-hrc",
  "results": [
    {
      "domain": "papplica.app",
      "scenario": "interaction-hero-hover",
      "viewport": "desktop",
      "width": 1440,
      "height": 900,
      "diffPixels": 466,
      "approved": true
    }
  ]
}
```

Identity mapping on the flaker side:

| Input field | → flaker identity |
|---|---|
| `dir` + `domain` | `suite = "regression/preview-vs-hrc/papplica.app"` |
| `viewport` + `scenario` | `test_name = "viewport:desktop / scenario:interaction-hero-hover"` |
| (scenario is `"initial"` or omitted) | `test_name = "viewport:desktop"` (no suffix) |
| `backend`, `viewport`, `width`, `height`, `scenario` | `variant = { ... }` |

Because both the initial image and interaction scenarios for the same domain live under the same suite, suite-based aggregation and affected-suites handling stay natural. Both producer and consumer can declare `schemaVersion`, so historical data stays consistent.

### `flaker import --adapter selector-record|jev` — selector decisions

A test selector decides, for one change, which tests to run. flaker stores those decisions so they can be compared with what really failed (`selector_verdicts`, `misses`). The format it ingests is `selector-record` v1: one JSON object per change with the selector's name, `head_sha`, the gate values it decided under, and one entry per test with `file`, `title_path`, `score`, `confidence`, `reason` and `selected`. The type, the JSON Schema and the parser are exported from `@mizchi/flaker/contracts/selector-record-v1` ([`src/cli/contracts/selector-record-v1.ts`](../src/cli/contracts/selector-record-v1.ts)).

```bash
# A selector that writes selector-record v1 directly
flaker import selector-record.json --adapter selector-record

# jev-test-filter's run records, converted with jev's own gate
flaker import .jev-test-filter --adapter jev
```

- The path may be a file or a directory. A directory imports its `*.json` and then `records/*.json`, which is jev-test-filter's layout. `last.json` is a copy of the latest record, so it counts as a duplicate.
- Records are keyed by their content: importing the same record again is a no-op and is reported as a duplicate.
- A jev record that fell back to running everything (`fallback` set) carries no decisions and is skipped.
- An invalid file, or one the database rejects, is reported on stderr and the rest are still imported; the command then exits with code 1. A directory with no records prints a warning and exits with code 0.
- Each test is matched to a known `test_key` by `file` + `title_path` (+ `project`). A test flaker has not seen yet stays in `selector_verdicts` with `test_key = null`, and is matched on the next selector import (or `flaker calibrate --selector`) once its results are in.

### `flaker export` — public datasets (flaker_v1)

The storage tables are internal and may change in any release. The public, versioned view of the data is the DuckDB schema `flaker_v1`: nine datasets, each with a JSON Schema exported from `@mizchi/flaker/contracts/flaker-v1-datasets`. Every dataset shares the key `test_key`, the stable test ID.

| Dataset | Content |
|---|---|
| `tests` | Test identity: `suite`, `test_name`, `task_id`, `variant`, `file`, `title_path` (JSON array), first and last seen. `file` + `title_path` is what selectors are matched on |
| `runs` | One execution: `source` (`ci` / `local` / `mutation`), `workflow_name`, `lane`, `commit_sha`, `branch`, `event`, `is_full` (whether the whole suite ran) |
| `results` | Per-test results: `run_id`, `test_key`, `status`, `retry_count`, `duration_ms` |
| `flaky` | Flaky verdicts: `window_days`, `runs`, `failures`, `flaky_rate`, `is_flaky`. `failures` counts every result that failed at least once; `flaky_rate` counts only flake evidence (a retried pass, a `flaky` status, or a failure on a commit where the test also passed), so a plain regression has `flaky_rate = 0` |
| `quarantine` | Quarantined tests: `reason`, `since`, `source` (`auto` / `manual`) |
| `co_failures` | "This test failed when this file changed", aggregated: `changed_file`, `co_failures`, `changes`, `strength`. `changes` counts the commits in the window that changed the file and have a result for the test; `co_failures` counts those where the test failed at least once. One failing result on a commit is enough, and every file that commit changed is credited |
| `selector_verdicts` | A selector's per-test decisions: `score`, `confidence`, `reason`, `selected` |
| `misses` | The selector's own misses: tests it did not select that really failed in a full run on the same commit, one row per verdict. Only `real` selector runs are scored, against real full runs, and only the latest selector run per `head_sha`, so re-running the selector on a commit does not repeat a miss. A verdict the record itself quarantined (`reason = quarantined`) is not a miss. Mutation scoring arrives with the mutation phase |
| `gate_calibration` | History of selector gate calibrations. The latest row is the current value |

Runs with `source = mutation` never feed `flaky`, `co_failures` or `misses`.

Stability rule: within `flaker_v1`, columns are only added. Removing, renaming or changing the meaning of a column means a new `flaker_v2`. External tools may open the `.duckdb` file directly, but they should read `flaker_v1.*` only, never the storage tables.

```bash
flaker export tests --format jsonl
flaker export runs --since 2026-09-01 --format csv -o runs.csv
flaker export results --format parquet -o .flaker/export/results.parquet
flaker query "SELECT * FROM flaker_v1.flaky WHERE is_flaky"
```

- `--format` is `json` (default, an array), `jsonl`, `csv` (header in schema order; arrays and objects are JSON-encoded; a null is an empty cell and an empty string is `""`) or `parquet` (requires `-o`).
- Timestamps are UTC. JSON and CSV write them as ISO strings ending in `Z`. Parquet keeps them as `TIMESTAMP` without a time zone (`isAdjustedToUTC = false`) holding the UTC wall-clock time, so read them as UTC. The JSON columns (`variant`, `title_path`, `changed_files`) are Parquet strings with the JSON logical type.
- `--since <date>` keeps rows at or after an ISO date. A date alone (`2026-09-01`) means midnight UTC. A date-time needs an offset (`2026-09-01T09:00:00Z` or `…+09:00`), and impossible dates such as `2026-02-30` are rejected. It applies to `tests` (`last_seen_at`), `runs` and `results` (`created_at`), `quarantine` (`since`), `selector_verdicts` (`created_at`) and `gate_calibration` (`calibrated_at`); the other datasets reject it.
- `--where <expr>` is an extra condition over the dataset's own columns, for example `--where "status = 'failed'"`. It must be a single row-level expression: subqueries, `;`, comments and filesystem functions are rejected. DuckDB parses the whole query first and it must stay one filter over the chosen dataset, and export runs with DuckDB's file access turned off except for the `-o` Parquet file.
- Invalid input (unknown dataset or format, `--since` on a dataset without a time column, an unsafe `--where`) exits with code 2.

#### `[workflow_lanes]` and `runs.is_full`

`[workflow_lanes]` maps a workflow name or path to a lane. An entry may also be a table that says whether the lane runs the whole suite:

```toml
[workflow_lanes]
"ci.yml" = "sampled"
"nightly.yml" = { lane = "full-batch", full = true }
```

Runs in a lane with `full = true` have `runs.is_full = true`, and `full = false` forces `false`. For a lane without `full`, a run counts as full when it has results for at least 95% as many tests as the largest run of the same workflow within the preceding `[flaky].window_days` (the run itself included). Renamed or deleted tests therefore do not make a later full run look partial.

### Selector calibration with jev-test-filter

For a step-by-step setup, see [Using flaker with jev-test-filter](jev-test-filter-integration.md). This section is the reference.

flaker compares a selector's decisions with what a full run on the same commit really proved, and tunes the selector's gate from that evidence. With [jev-test-filter](https://github.com/mizchi/jev-test-filter) the loop is:

```bash
jev-test-filter --context .flaker/context.json …        # writes .jev-test-filter/records/<sha>.json
flaker import .jev-test-filter --adapter jev
flaker import --ci                                       # full runs on the same commits
flaker calibrate --selector                              # appends to gate_calibration
flaker export --projection jev-context -o .flaker/context.json
```

`flaker calibrate --selector [name]` joins each real selector record to a full run on its `head_sha`. Only the latest record per `head_sha` counts, so re-running the selector on one commit does not count the same regression twice; mutation records are left out. The ground truth is the tests that failed there, minus flaky and quarantined tests; a failure of a test the record itself quarantined is not the selector's miss and is reported apart. It then replays every record offline through jev's own gate (bundled from `jev-test-filter/gate`, no API calls) over a grid of `cutoff × unsure_below × unsure_margin`. The adoption rule is "tighten at once, loosen with care". If the current gate missed a failure, calibrate switches at once (`tighten`) to a candidate that still selects every test the current gate selects, on every record. Among those it takes the one with the fewest misses, then the fewest selected tests. When no candidate catches every failure, the one with the fewest misses is still adopted if it misses fewer than the current gate. When none misses fewer, the gate is kept and the misses are reported, because selecting more tests would not catch them. Selecting fewer tests (`loosen`) needs zero misses, at least `min_failures` real failures, and a Wilson 95% lower bound of recall of at least `recall_target`. Otherwise the gate is kept, and the reason goes into `rationale` (`keep`). Ties go to the candidate nearest jev's defaults. Each run appends one row to `gate_calibration`; `--dry-run` appends nothing and `--json` prints the result. Failures that match no verdict are listed as `unmatched` and not counted as misses, and the report is split by context digest.

The bound is stricter than it looks. When every real failure is caught, the Wilson 95% lower bound over n failures is n / (n + 3.8415): 20 failures give 0.839, 35 give 0.901 and 50 give 0.929. Because a loosening must have zero misses, the default `recall_target = 0.90` needs at least 35 real failures, all caught, which is more than `min_failures = 20`; the rationale says so when a loosening is withheld. `recall_target = 0.98` would need 189 (0.9801 at 189; 188 gives 0.9800 and falls short).

`flaker export --projection jev-context` writes the context jev-test-filter reads with `--context`. It holds the latest gate from `gate_calibration` with its basis, `skip` (quarantined tests) and `tests` (hints: on how many commits the selector missed a test, and up to five files it failed with, taken from `co_failures` with at least 2 co-failures). Flaky and quarantined tests get no hints. `digest` is the sha256 of `skip` and `tests` only, so a new gate does not change it. The type and JSON Schema are exported from `@mizchi/flaker/contracts/jev-context-v1`. Reading the context needs jev-test-filter 0.1.3 or later. A projection is always JSON; `--format`, `--since`, `--where` and a dataset argument are rejected with exit code 2.

```toml
[selector]
type = "jev"             # the only selector
recall_target = 0.90     # Wilson 95% lower bound of recall needed to loosen
min_failures = 20        # real failures needed to loosen
max_hinted_tests = 200   # cap on tests[] in jev-context
```

Gate values (`cutoff`, `unsure_below`, `unsure_margin`) are never kept in `flaker.toml`, and a `[selector]` that sets one is rejected. The source of truth is `gate_calibration` in the database: its latest row is the current gate.

### Flaky test listing — `flaker status --list flaky`

`flaker analyze flaky` was removed in 0.8.0. Flaky test listing is now part of `flaker status`:

```bash
flaker status --list flaky                 # Top flaky tests
flaker status --list flaky --json          # Machine-readable
```

For advanced filtering (by variant, trend, true-flaky), use `flaker query "SELECT ..."` directly or delegate to `flaker explain insights` for AI-assisted analysis.

### `flaker explain <topic>` — AI-assisted analysis

The former `flaker analyze reason/insights/cluster/bundle/context` commands were unified under the `flaker explain <topic>` umbrella in 0.8.0.

#### `explain reason` — flaky classification and recommended actions

```bash
flaker explain reason                     # Classification + recommendations report
flaker explain reason --json              # Machine-readable JSON
flaker explain reason --window-days 7     # Analyze last 7 days
```

Classifies each flaky test and recommends actions:

| Classification | Meaning | Recommended Action |
|---------------|---------|-------------------|
| `true-flaky` | Non-deterministic (same code, different results) | quarantine or investigate |
| `regression` | Broke recently due to code change | **fix-urgent** |
| `intermittent` | Passes on retry | quarantine or monitor |
| `environment-dependent` | May depend on execution environment | investigate |

Pattern detection:
- **suite-instability** — 3+ flaky tests in the same suite → likely shared fixture issue
- **new-test-risk** — Recently added tests already failing

Risk prediction:
- Currently stable tests showing early warning signs (recent failures, high duration variance)

#### `explain insights` — adaptive insights from sampling KPIs

```bash
flaker explain insights
flaker explain insights --json
```

Surfaces threshold-adjustment candidates based on fluctuations in sampling effectiveness and false-negative rate.

#### `explain cluster` — co-failure clusters

Co-failure cluster detection. See the [co-failure clustering](#co-failure-clustering-flaker-explain-cluster) section below for the full configuration reference.

```bash
flaker explain cluster --min-co-rate 0.9
flaker explain cluster --window-days 30 --top 50
flaker explain cluster --json
```

#### `explain bundle` — bundle-level failure aggregation

Summarises tests that fail together within the same bundle (suite prefix, etc.) to identify shared fixture or environment problems.

```bash
flaker explain bundle
```

#### `explain context` — failure context extraction

Extracts error messages, stdout/stderr, and artifact paths from failing tests and clusters similar contexts.

```bash
flaker explain context
flaker explain context --test "handles timeout"
```

### `flaker run --dry-run` — Test Sampling (dry run)

```bash
flaker run --dry-run --strategy weighted --count 20      # Flaky-weighted
flaker run --dry-run --strategy affected                 # Change-affected only
flaker run --dry-run --strategy hybrid --count 50        # Hybrid (recommended)
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --dry-run --percentage 30                     # 30% of all tests
flaker run --dry-run --skip-quarantined                  # Exclude quarantined
```

#### Sampling Strategies

| Strategy | Description |
|----------|------------|
| `weighted` | Weighted by flaky rate (flakier tests more likely selected) |
| `affected` | Tests affected by `git diff` changes |
| `hybrid` | affected + previously failed + new tests + weighted random (Microsoft TIA method) |
| `full` | Run everything |

The `random`, `gbdt`, and `coverage-guided` strategies were removed in 0.13.0; see [docs/migration-0.12-to-0.13.md](docs/migration-0.12-to-0.13.md).

### `flaker run` — Sample & Execute

```bash
flaker run --strategy hybrid --count 50
flaker run --strategy affected
flaker run --gate iteration --changed src/foo.ts
flaker run --skip-quarantined
flaker run --runner actrun                        # Execute via actrun
flaker run --runner actrun --retry                # Retry failed tests only
```

`--runner actrun` reads the workflow file path from `[runner.actrun].workflow`, not from `[runner].command`.

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"

[runner.actrun]
workflow = ".github/workflows/ci.yml"
local = true
trust = true
# job = "e2e"
```

Results are automatically stored in the database.

### Execution Gates

`flaker run` inherits settings from `[gate.<name>]` (use `--dry-run` for sampling without execution). `[profile.*]`, `--profile`, and `FLAKER_PROFILE` were removed in 0.13.0 — see [docs/migration-0.12-to-0.13.md](docs/migration-0.12-to-0.13.md).

```toml
[gate.release]
strategy = "full"

[gate.merge]
strategy = "hybrid"
sample_percentage = 30

[gate.iteration]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
```

The practical local loop is:

```bash
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts
```

`gate.iteration` is where `affected` selection, fallback to `weighted`, and time-budget control come together for dogfooding and day-to-day development.

The `adaptive` auto-tuning flag (and the other `adaptive_*` keys) were removed in 0.13.0; run `flaker calibrate` periodically instead.

### Flag precedence

```
Resolution order (highest to lowest):
  1. Explicit CLI flag          (--strategy, --percentage, --count)
  2. [gate.<name>] in flaker.toml      (via --gate or auto-detection)
  3. [sampling] in flaker.toml         (project default)
  4. Built-in defaults

Notes:
  --count overrides --percentage when both are given
  --changed overrides git auto-detection
  --dry-run suppresses execution, still records selection telemetry
  --explain can be combined with --dry-run or a real run
```

### Co-failure clustering (`flaker explain cluster`)

> **0.13.0 change:** the `[sampling].cluster_mode` knob (`spread` / `pack` representative-picking during sampling) was removed, along with `model_path`. Co-failure cluster *analysis* below (`flaker explain cluster`) is unaffected — it is a read-only report, not a sampling-time behavior.

#### Cluster detection thresholds

`queryTestCoFailures` aggregates `test_results` to compute co-occurrence rates, then `buildFailureClusters` forms clusters. Defaults:

- `windowDays`: 90 days
- `minCoFailures`: 2 (minimum co-occurrences)
- `minCoRate`: 0.8 (at least 80% co-occurrence rate)

Each knob is tunable per invocation via `flaker explain cluster`:

```bash
flaker explain cluster                                   # Defaults (window=90, min-co=2, min-rate=0.8, top=20)
flaker explain cluster --min-co-rate 0.9                 # Only tight clusters with 90%+ co-occurrence
flaker explain cluster --window-days 30 --top 50         # Last 30 days, top 50 clusters
flaker explain cluster --json                            # Machine-readable output
```

### Coverage-guided sampling (removed in 0.13.0)

`[coverage]`, `flaker collect coverage`, and the `coverage-guided` strategy were removed in 0.13.0. See [docs/coverage-guided-sampling.md](coverage-guided-sampling.md) (kept for history) and [docs/migration-0.12-to-0.13.md](migration-0.12-to-0.13.md).

### Quarantine management — `flaker apply` + `[quarantine].auto`

`flaker policy quarantine` was removed in 0.8.0. Quarantine is now managed declaratively:

```toml
[quarantine]
auto = true                              # apply auto-isolates tests above threshold
flaky_rate_threshold_percentage = 30
min_runs = 10
```

`flaker apply` incorporates quarantine proposals and application (`QuarantineAction`).

- List: `flaker status --list quarantined`
- For manual overrides, edit `.flaker/quarantine-manifest.toml` directly and commit (apply respects an existing manifest)
- Exclude from runs as before: `flaker run --skip-quarantined`

### `flaker debug retry` — Reproduce CI failures locally

```bash
flaker debug retry                      # Take failing tests from the latest failed CI run, re-run them locally
flaker debug retry --run 12345678       # Pin to a specific workflow run id
```

Extracts the failing tests from the CI failure artifact and re-runs them locally in a single batch. Positioned as the **first command to try** — use it to do a coarse "reproduces / does not reproduce" triage of multiple CI failures at once. The output is binary (reproduced / not) and does not attempt the `BROKEN/FLAKY/TRANSIENT` classification. When you need the finer classification, feed the non-reproducing tests into `flaker debug confirm`.

### `flaker debug confirm` — Classify a failure into 3 buckets

```bash
# remote: trigger workflow_dispatch and repeat in CI
flaker debug confirm "tests/api.test.ts:handles timeout"
flaker debug confirm "tests/api.test.ts:handles timeout" --repeat 10

# local: repeat with the local runner
flaker debug confirm "tests/api.test.ts:handles timeout" --runner local
```

Runs one test `--repeat N` times and classifies the result into 3 buckets (`--repeat` defaults to `5`):

| Classification | Condition | Meaning / Recommended action |
|---|---|---|
| `BROKEN` | `failures == N` | Fails every time. Fix as a regression |
| `FLAKY` | `0 < failures < N` | Intermittent failures. Add `@flaky` tag or quarantine |
| `TRANSIENT` | `failures == 0` | Does not reproduce. Record only as CI-environment noise |

Use `--repeat 10` or higher when you suspect the default of `5` misses low-frequency flakies. More repeats stabilize the classification at the cost of wall time.

Remote mode requires `.github/workflows/flaker-confirm.yml`. For repos without it, regenerate with `flaker init --force` or copy `templates/flaker-confirm.yml`.

### `flaker debug bisect` — Find Culprit Commit

```bash
flaker debug bisect --test "should redirect"
flaker debug bisect --test "should redirect" --suite "tests/login.spec.ts"
```

Identifies the commit range where a test became flaky.

### Health evaluation — `flaker status --markdown`

`flaker analyze eval` was removed in 0.8.0. The equivalent output is now part of `flaker status`:

```bash
flaker status --markdown                                           # Markdown summary for weekly review
flaker status --markdown --output .artifacts/flaker-review.md     # Save to file
flaker status --detail --markdown                                  # Include drift detail section
flaker status --gate merge --detail --markdown                     # Merge-gate details only
```

The 0–100 Health Score, flaky count, matched commits, and correlation are all in `flaker status`. Use `--markdown` for weekly-review tables and `--json` for machine-readable output.

### `flaker query` — Direct SQL analysis

`flaker analyze query` was promoted to top-level `flaker query` in 0.7.0; the subcommand form was removed in 0.8.0.

```bash
flaker query "SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20"
```

Run SQL directly against DuckDB. Full access to window functions, FILTER clauses, and other DuckDB analytics features.

The query sees the flaker database only. DuckDB's external access is turned off before it runs, so `read_csv(…)`, `FROM 'file.parquet'` and similar cannot read files; to get data out, use `flaker export`. It also opens the database read-only and takes one statement (a trailing `;` is fine), so `SELECT 1; CREATE TABLE …` is rejected and no statement can change the database.

---

## Runner-Specific Setup

Defaults emitted by `flaker init --adapter <type> --runner <type>` are shown below. `[adapter].type` selects the report parser; `[runner].type` is the actual test runner.

### Vitest

```toml
[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm exec vitest run"
```

To feed Vitest JSON reports into `flaker import <file>`, generate them with `vitest run --reporter=json --outputFile=report.json`. `flaker report <file> --summary --adapter vitest` takes the same JSON input.

### Playwright Test

```toml
[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
```

### Jest

```toml
[adapter]
type = "jest"       # or "junit" (when using the jest-junit reporter)

[runner]
type = "jest"
command = "pnpm exec jest"
```

Generate the Jest JSON report with `jest --json --outputFile=report.json`. Switch to `--adapter junit` when you use the `jest-junit` reporter.

### JUnit XML (runner-agnostic)

```toml
[adapter]
type = "junit"

[runner]
type = "custom"
execute = "..."   # runner is up to you
```

Any runner that emits JUnit XML — Ant / Gradle / Maven / pytest, etc. — can be imported this way.

### MoonBit (moon test)

```toml
[adapter]
type = "custom"
command = "node ./parse-moon-output.js"

[runner]
type = "moontest"
command = "moon test"
```

### Custom Runner

Connect any test runner via JSON protocol:

```toml
[runner]
type = "custom"
execute = "node ./my-runner.js execute"   # stdin: TestId[], stdout: ExecuteResult
list = "node ./my-runner.js list"         # stdout: TestId[]
```

See [Runner Adapters](runner-adapters.md) for details.

### Per-runner `[runner.actrun]` examples

When using `flaker run --runner actrun`, add `[runner.actrun]` in addition to `[runner]` to point at the workflow file.

```toml
# Playwright E2E via actrun
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"
[runner.actrun]
workflow = ".github/workflows/e2e.yml"
local = true
trust = true

# Vitest via actrun (run unit / integration tests locally in the same environment as CI)
[runner]
type = "vitest"
command = "pnpm exec vitest run"
[runner.actrun]
workflow = ".github/workflows/ci.yml"
job = "test"
local = true
trust = true
```

### Per-runner behavior of `flaky_tag_pattern` / `skip_flaky_tagged`

| Runner | Tag syntax | Behavior of `skip_flaky_tagged = true` |
|---|---|---|
| `playwright` | Embed `@flaky` in the test name (e.g. `test("login @flaky", ...)` or in the `test.describe` hierarchy) | Automatically appends `--grep-invert @flaky` |
| `vitest` | Not currently supported | `skip_flaky_tagged` is a no-op. To exclude `@flaky` tests, hand-write `test.skipIf` or `--testNamePattern` |
| `jest` | Not currently supported | Same as above. Use `describe.skip` / `it.skip` for individual skips |
| `custom` | Up to the runner | Implement arbitrary filtering inside the `execute` command |

Flaky-tag add/remove triage (formerly emitted by the `ops` command group) was removed in 0.13.0 along with `ops`. Use `flaker status --list flaky` to find candidates and tag them by hand.

---

## Dependency Analysis Setup

Used by `--strategy affected` and `--strategy hybrid`:

### workspace (Node.js monorepo, zero config)

```toml
[affected]
resolver = "workspace"
```

Automatically builds dependency graph from `package.json` `dependencies` + `workspace:` protocol. Supports pnpm / npm / yarn workspaces.

### moon (MoonBit, zero config)

```toml
[affected]
resolver = "moon"
```

Automatically builds dependency graph from `moon.pkg` `import` fields.

### bitflow (Starlark manual definition)

```toml
[affected]
resolver = "bitflow"
config = "flaker.star"
```

```python
# flaker.star
task("tests/auth", srcs=["src/auth/**", "src/utils/**"])
task("tests/checkout", srcs=["src/checkout/**"], needs=["tests/auth"])
```

Supports file-level granularity.

### glob (manual rules)

```toml
[affected]
resolver = "glob"
config = "flaker.affected.toml"
```

```toml
# flaker.affected.toml
[[rules]]
tests = ["tests/auth/**"]
srcs = ["src/auth/**", "src/utils/**"]

[[rules]]
tests = ["tests/checkout/**"]
srcs = ["src/checkout/**"]
```

### simple (fallback)

```toml
[affected]
resolver = "simple"
```

Simple directory-name matching. No configuration needed.

---

## actrun Integration

[actrun](https://github.com/mizchi/actrun) is a GitHub Actions-compatible local runner. flaker integrates with it for local CI execution and result accumulation.

```bash
# Run tests via actrun → auto-import results
flaker run --runner actrun

# Retry only failed tests
flaker run --runner actrun --retry
```

Set `[runner.actrun].workflow` to a repo-relative workflow path such as `.github/workflows/ci.yml`. Use `local = true` when the repository is not available as a git worktree to `actrun`.

---

## Typical Workflows

### Daily Development

```bash
# Morning: sync CI data
flaker import --ci --days 7

# After code changes: inspect, sample, then run with the iteration gate
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts

# Check overall status
flaker status --markdown
```

### Flaky Test Triage

```bash
# Identify problematic tests
flaker explain reason

# Quarantine severe cases (apply respects [quarantine].auto)
flaker apply

# Find culprit commit
flaker debug bisect --test "problematic test name"

# After fixing, edit .flaker/quarantine-manifest.toml to remove the entry
```

### CI Integration

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker import --ci --days 7
    flaker status --json --output flaker-report.json
    flaker explain reason --json > flaker-reason.json

- name: Upload analysis
  uses: actions/upload-artifact@v6
  with:
    name: flaker-report
    path: flaker-*.json
```

### PR Test Selection

```yaml
- name: Run affected tests
  run: |
    flaker run --strategy hybrid --count 50 --skip-quarantined
```

### Coverage-Guided Sampling (removed in 0.13.0)

`flaker collect coverage`, `[coverage]`, and the `coverage-guided` strategy were removed in 0.13.0. See [Coverage-Guided Test Sampling](coverage-guided-sampling.md) (kept for history).

### Diagnose Flaky Tests

```bash
# Diagnose flaky test causes
flaker debug diagnose --suite "tests/auth.test.ts" --test "login flow" --runs 5
```

ミューテーションベースでフレーキー原因を特定する（順序依存、環境依存、非決定性）。
詳細は [Diagnose Flaky Tests](diagnose.md) を参照。

### Co-failure Window Analysis

```bash
# Analyze optimal co-failure time window
flaker dev eval-co-failure

# JSON output
flaker dev eval-co-failure --json
```

co-failure データの最適な時間窓（7/14/30/60/90/180 日）を探索する。
出力の ★ 付きの窓サイズを `--co-failure-days` に指定する。

## Config migration

`flaker 0.2.0` (and later) renames config keys to follow a suffix-per-unit convention: `*_ratio` (0.0–1.0), `*_percentage` (0–100), `*_days`, `*_seconds`, `*_count`. Values without a unit suffix are gone. The CLI refuses to start on a legacy `flaker.toml` and points here.

Rename the keys in your `flaker.toml` per the table below:

| Section | Old key | New key | Unit |
|---|---|---|---|
| `[sampling]` | `percentage` | `sample_percentage` | 0–100 |
| `[sampling]` | `co_failure_days` | `co_failure_window_days` | days (int) |
| `[sampling]` | `detected_flaky_rate` | `detected_flaky_rate_ratio` | 0.0–1.0 |
| `[sampling]` | `detected_co_failure_strength` | `detected_co_failure_strength_ratio` | 0.0–1.0 |
| `[flaky]` | `detection_threshold` | `detection_threshold_ratio` | 0.0–1.0 |
| `[quarantine]` | `flaky_rate_threshold` | `flaky_rate_threshold_percentage` | 0–100 |
| `[profile.*]` (pre-0.13.0) | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` (pre-0.13.0) | `co_failure_days` | `co_failure_window_days` | days (int) |

`co_failure_window_days` (in `[sampling]` or a `[gate.*]` section) sets how far back co-failure history is read. It only changes ranking for `weighted` and `hybrid`, and only when there are changed files; a pure `affected` gate ignores it, except when its `fallback_strategy` is `weighted` or `hybrid`.

The unit interpretation of `flaky_rate_threshold` also changed. Previously a bare `30.0` was treated as 30% and a bare `0.3` was silently auto-normalized. Now the value is taken literally as a percentage. If your old config had `flaky_rate_threshold = 0.3`, rename to `flaky_rate_threshold_percentage = 30`.

Range validation is enforced by `flaker doctor`: `*_ratio` must be in [0.0, 1.0]; `*_percentage` must be in [0, 100]; `*_days` / `*_seconds` / `*_count` must be non-negative integers.

### 0.13.0 renames and removals

`0.13.0` renamed the `[profile.*]` section to `[gate.*]` and removed adaptive sampling entirely. Custom profile names (anything other than `local` / `ci` / `scheduled`) have no gate equivalent.

| Old (0.12.x) | New (0.13.0) |
|---|---|
| `[profile.local]` | `[gate.iteration]` |
| `[profile.ci]` | `[gate.merge]` |
| `[profile.scheduled]` | `[gate.release]` |
| `run --profile <name>` | `run --gate <name>` |
| `FLAKER_PROFILE=<name>` | `FLAKER_GATE=<name>` |

Removed outright in `0.13.0` (no renamed replacement — delete the key):

- `adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, `adaptive_step` — run `flaker calibrate` periodically instead
- `cluster_mode`, `model_path`
- `[coverage]` (the whole section)
- `strategy = "random"`, `strategy = "gbdt"`, `strategy = "coverage-guided"` (and the matching `fallback_strategy` values) — use `weighted`, `affected`, `hybrid`, or `full`

`flaker.toml` files using any of these fail to load with an error naming the exact key and its replacement (or telling you to delete it). See [docs/migration-0.12-to-0.13.md](migration-0.12-to-0.13.md) for full details and example error text.

---

## Advanced / Maintainer tools

These commands are intended for flaker maintainers or advanced users. Normal day-to-day usage does not require them. `dev` is hidden from `--help` but still runs.

`flaker dev train` (GBDT model training) was removed in 0.13.0 along with the `gbdt` strategy — there is no replacement command. `flaker dev tune` (co-failure alpha auto-tuning) and `flaker dev eval-co-failure` are unaffected.
