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
node ../flaker/scripts/dev-cli.mjs affected --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --dry-run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs analyze eval --markdown --window 7 --output .artifacts/flaker-review.md

# optional: force rebuild after editing flaker itself
node ../flaker/scripts/dev-cli.mjs --rebuild run --profile local --changed src/foo.ts
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
flaker collect --days 30
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
flaker analyze flaky

# AI-powered analysis with recommended actions
flaker analyze reason

# Test suite health score
flaker analyze eval
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

flaker apply          # Auto-run collect / calibrate / run / quarantine apply to close the gap
flaker apply --json
flaker apply --output .artifacts/flaker-apply.json # Persist ApplyArtifact

# 0.9.0 subsumed ops daily. weekly still works, incident is a stub until 1.0.0:
flaker apply --emit daily   --output .artifacts/flaker-daily.md
flaker apply --emit weekly  --output .artifacts/flaker-weekly.md
flaker apply --emit incident  # Currently a stub that redirects to flaker ops incident
```

`flaker.toml` is treated as the **desired state**, and the planner inspects the current DB state to decide what to do. A brand-new repo with no history gets `collect_ci` + `cold_start_run`; a repo with enough history gets `collect_ci` + `calibrate` + `quarantine_apply`. The user does not have to memorize the ordering.

`flaker status` compares the `[promotion]` thresholds against the current KPIs and reports drift.

#### `--json` output shape in 0.9.0

`flaker apply --json`:

- `executed[*].status`: `"ok" | "failed" | "skipped"` (the old `.ok: boolean` + top-level `aborted` are removed)
- `executed[*].skippedReason?: string`: reason why a step was skipped due to a dependency failure
- Exit code is 1 only when `status === "failed"`; skipped is 0

`flaker status --json`'s `drift.unmet[*]` similarly moved from `{ field, threshold }` to `{ kind, desired }`.

#### How `--emit` and `ops` divide up

- `apply --emit daily`: emits the same cadence artifact as the old `flaker ops daily` (merged in 0.9.0; `ops daily` is deprecated).
- `apply --emit weekly`: emits the weekly rollup. `flaker ops weekly` stays first-class because it also carries operator-oriented narrative (quarantine proposals, flaky-tag triage, etc.).
- `apply --emit incident`: currently a stub. For incident investigation use `flaker ops incident --run <id>` or `flaker debug retry / confirm / diagnose`. In 1.0.0 the `--incident-*` flags will be absorbed here.

### `flaker collect` — Collect from CI

```bash
flaker collect                                           # Last 30 days
flaker collect --days 90                                 # Last 90 days
flaker collect --branch main                             # main branch only
flaker collect --json --output .artifacts/collect.json   # Machine-readable summary
flaker collect --json --output .artifacts/collect.json --fail-on-errors
```

Auto-extracts test reports from GitHub Actions artifacts. The default artifact name is `playwright-report` for `playwright`, `junit-report` for `junit`, `migration-report` for `vrt-migration`, and `bench-report` for `vrt-bench`. Override it with `[adapter].artifact_name` when your workflow uses a different artifact name. Requires `GITHUB_TOKEN` environment variable.

Use `--json` when you want a machine-readable summary, `--output <file>` when you want to persist that summary as a workflow artifact, and `--fail-on-errors` when partial collection failures should fail CI. The JSON summary separates successfully imported runs (`runsCollected`) from runs that finished without a matching artifact yet (`pendingArtifactRuns`) and runs that errored during collection (`failedRuns`).

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

### `flaker collect local` — Import actrun History

```bash
flaker collect local              # Import all actrun run history
flaker collect local --last 10    # Last 10 runs only
```

Imports results from [actrun](https://github.com/mizchi/actrun) (GitHub Actions-compatible local runner). Automatically detects and parses Playwright/JUnit reports in artifact directories.

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

Co-failure cluster detection. See the [co-failure clustering](#co-failure-clustering-samplingcluster_mode) section below for the full configuration reference.

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
flaker run --dry-run --strategy random --count 20        # Uniform random
flaker run --dry-run --strategy weighted --count 20      # Flaky-weighted
flaker run --dry-run --strategy affected                 # Change-affected only
flaker run --dry-run --strategy hybrid --count 50        # Hybrid (recommended)
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --dry-run --percentage 30                     # 30% of all tests
flaker run --dry-run --skip-quarantined                  # Exclude quarantined
```

#### Sampling Strategies

| Strategy | Description |
|----------|------------|
| `random` | Uniform random selection |
| `weighted` | Weighted by flaky rate (flakier tests more likely selected) |
| `affected` | Tests affected by `git diff` changes |
| `hybrid` | affected + previously failed + new tests + weighted random (Microsoft TIA method) |

### `flaker run` — Sample & Execute

```bash
flaker run --strategy hybrid --count 50
flaker run --strategy affected
flaker run --profile local --changed src/foo.ts
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

### Execution Profiles

`flaker run` can inherit settings from execution profiles (use `--dry-run` for sampling without execution):

```toml
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

The practical local loop is:

```bash
flaker exec affected --changed src/foo.ts
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --profile local --changed src/foo.ts
```

`profile.local` is where `affected` selection, fallback to `weighted`, and time-budget control come together for dogfooding and day-to-day development.

### Flag precedence

```
Resolution order (highest to lowest):
  1. Explicit CLI flag          (--strategy, --percentage, --count)
  2. [profile.<name>] in flaker.toml   (via --profile or auto-detection)
  3. [sampling] in flaker.toml         (project default)
  4. Built-in defaults

Notes:
  --count overrides --percentage when both are given
  --changed overrides git auto-detection
  --dry-run suppresses execution, still records selection telemetry
  --explain can be combined with --dry-run or a real run
```

### Co-failure clustering (`[sampling].cluster_mode`)

Treats tests that fail together in the same run as a cluster and picks **one representative** from each cluster during sampling, so a small budget still covers diverse failure patterns. Useful when sampling tens of thousands of VRT scenarios.

#### Configuration

```toml
[sampling]
cluster_mode = "spread"   # "off" (default) | "spread" | "pack"
co_failure_window_days = 90
```

| mode | Behavior |
|---|---|
| `off` | Ignore clusters. Plain `weighted` / `hybrid` sampling. |
| `spread` | Pick **only one** test from each cluster and fill the remaining budget with normal weighted sampling. Prioritizes diversity. |
| `pack` | Pick tests from the same cluster **together**. Use when you want to drill down into a common root cause. |

`cluster_mode` only applies to the `weighted` / `hybrid` strategies. It is ignored for `affected` / `full`.

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

#### Difference from existing `co_failure_boost`

| | `co_failure_boost` | cluster_mode |
|---|---|---|
| Correlation | file change ↔ test failure | test failure ↔ test failure |
| Purpose | Prioritize "tests related to a change" in affected sampling | Add diversity to the sample budget / drill deeper |
| Data | `commit_changes` + `test_results` | `test_results` only |

The two settings do not conflict. `cluster_mode` is applied as the final step of `weighted` / `hybrid` (after boost-driven reordering, the cluster representative is picked).

### `flaker collect coverage` — Import Coverage Edges

```bash
flaker collect coverage --format istanbul --input coverage/coverage-final.json
flaker collect coverage --format playwright --input .artifacts/coverage
```

Imports per-test coverage edges into DuckDB for `coverage-guided` sampling. Directory input is supported and duplicate edges are deduped before insertion.

(Maintainer-only commands are consolidated in the Advanced / Maintainer tools section below.)

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

The `@flaky` add/remove proposals emitted by `flaker ops weekly` / `flaker analyze flaky-tag` assume Playwright. For Vitest / Jest you have to parse the proposal JSON and apply it yourself (no automatic apply in 0.7.x).

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

# Bulk import past actrun history
flaker collect local
```

Set `[runner.actrun].workflow` to a repo-relative workflow path such as `.github/workflows/ci.yml`. Use `local = true` when the repository is not available as a git worktree to `actrun`.

---

## Typical Workflows

### Daily Development

```bash
# Morning: sync CI data
flaker collect

# After code changes: inspect, sample, then run with the local profile
flaker exec affected --changed src/foo.ts
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --profile local --changed src/foo.ts

# Check overall status
flaker analyze eval
```

### Flaky Test Triage

```bash
# Identify problematic tests
flaker analyze reason

# Quarantine severe cases
flaker policy quarantine --auto

# Find culprit commit
flaker debug bisect --test "problematic test name"

# After fixing, remove quarantine
flaker policy quarantine --remove "suite>testName"
```

### CI Integration

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker collect --days 7
    flaker analyze eval --json --output flaker-report.json
    flaker analyze reason --json > flaker-reason.json

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

### Coverage-Guided Sampling

```bash
# Collect coverage data
flaker collect coverage --format istanbul --input coverage/coverage-final.json

# Sample using coverage data
flaker run --dry-run --strategy coverage-guided --changed src/auth.ts --percentage 20
```

詳細は [Coverage-Guided Test Sampling](coverage-guided-sampling.md) を参照。

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
| `[profile.*]` | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` | `co_failure_days` | `co_failure_window_days` | days (int) |
| `[profile.*]` | `adaptive_fnr_low` | `adaptive_fnr_low_ratio` | 0.0–1.0 |
| `[profile.*]` | `adaptive_fnr_high` | `adaptive_fnr_high_ratio` | 0.0–1.0 |

The unit interpretation of `flaky_rate_threshold` also changed. Previously a bare `30.0` was treated as 30% and a bare `0.3` was silently auto-normalized. Now the value is taken literally as a percentage. If your old config had `flaky_rate_threshold = 0.3`, rename to `flaky_rate_threshold_percentage = 30`.

Range validation is enforced by `flaker debug doctor` and `flaker policy check`: `*_ratio` must be in [0.0, 1.0]; `*_percentage` must be in [0, 100]; `*_days` / `*_seconds` / `*_count` must be non-negative integers.

---

## Advanced / Maintainer tools

These commands are intended for flaker maintainers or advanced users tuning the ML model. Normal day-to-day usage does not require them.

### `flaker dev train` — Train the GBDT Model

```bash
flaker dev train
flaker dev train --window-days 30 --num-trees 10 --learning-rate 0.3
```

Builds `.flaker/models/gbdt.json` from accumulated CI and local history. The local rows are included with reduced weight, and the saved model includes the feature names used by `gbdt` sampling.
