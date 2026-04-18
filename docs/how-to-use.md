# flaker — Flaky Test Detection & Test Sampling CLI

Too many tests to run them all. CI keeps failing on flaky tests. Can't tell what's really broken. flaker solves these problems.

[日本語版](how-to-use.ja.md)

This page is the **detailed command reference**.

- day-to-day usage entrypoint: [usage-guide.md](usage-guide.md)
- operations entrypoint: [operations-guide.md](operations-guide.md)
- onboarding checklist: [new-project-checklist.ja.md](new-project-checklist.ja.md)

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

### `flaker collect local` — Import actrun History

```bash
flaker collect local              # Import all actrun run history
flaker collect local --last 10    # Last 10 runs only
```

Imports results from [actrun](https://github.com/mizchi/actrun) (GitHub Actions-compatible local runner). Automatically detects and parses Playwright/JUnit reports in artifact directories.

### `flaker analyze flaky` — Detect Flaky Tests

```bash
flaker analyze flaky                      # Top flaky tests
flaker analyze flaky --top 50             # Top 50
flaker analyze flaky --test "login"       # Filter by name
flaker analyze flaky --true-flaky         # DeFlaker mode: same commit, inconsistent results
flaker analyze flaky --trend --test "should redirect"  # Weekly trend
flaker analyze flaky --by-variant         # Per OS/browser breakdown
```

#### Detection Modes

| Mode | Flag | Method |
|------|------|--------|
| Threshold | (default) | Failure rate exceeds threshold in rolling window |
| True flaky | `--true-flaky` | Same commit_sha has both pass and fail (DeFlaker method) |
| By variant | `--by-variant` | Flaky rate per execution environment (OS, browser, etc.) |

### `flaker analyze reason` — AI-Powered Analysis

```bash
flaker analyze reason                     # Report with recommended actions
flaker analyze reason --json              # Machine-readable JSON
flaker analyze reason --window 7          # Analyze last 7 days
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

### `flaker collect coverage` — Import Coverage Edges

```bash
flaker collect coverage --format istanbul --input coverage/coverage-final.json
flaker collect coverage --format playwright --input .artifacts/coverage
```

Imports per-test coverage edges into DuckDB for `coverage-guided` sampling. Directory input is supported and duplicate edges are deduped before insertion.

### `flaker dev train` — Train the GBDT Model

```bash
flaker dev train
flaker dev train --window-days 30 --num-trees 10 --learning-rate 0.3
```

Builds `.flaker/models/gbdt.json` from accumulated CI and local history. The local rows are included with reduced weight, and the saved model includes the feature names used by `gbdt` sampling.

### `flaker policy quarantine` — Isolate Flaky Tests

```bash
flaker policy quarantine                                 # List quarantined
flaker policy quarantine --auto                          # Auto-quarantine above threshold
flaker policy quarantine --add "suite>testName"          # Manual add
flaker policy quarantine --remove "suite>testName"       # Remove
```

Quarantined tests can be excluded from runs with `--skip-quarantined`.

### `flaker debug bisect` — Find Culprit Commit

```bash
flaker debug bisect --test "should redirect"
flaker debug bisect --test "should redirect" --suite "tests/login.spec.ts"
```

Identifies the commit range where a test became flaky.

### `flaker analyze eval` — Health Assessment

```bash
flaker analyze eval
flaker analyze eval --json
flaker analyze eval --markdown --window 7
flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

Rates overall test suite health on a 0-100 scale:
- **Data Sufficiency** — Is there enough data?
- **Detection** — Flaky test detection status
- **Resolution** — Resolution tracking (MTTD/MTTR)
- **Health Score** — Composite score

Use `--markdown --window 7` to generate a weekly KPI summary that can be pasted directly into review notes.

### `flaker analyze query` — Direct SQL Analysis

```bash
flaker analyze query "SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20"
```

Run SQL directly against DuckDB. Full access to window functions, FILTER clauses, and other DuckDB analytics features.

---

## Runner-Specific Setup

### Vitest

```toml
[adapter]
type = "playwright"    # vitest --reporter json is Playwright-compatible

[runner]
type = "vitest"
command = "pnpm exec vitest run"
```

### Playwright Test

```toml
[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
```

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
