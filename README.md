# flaker

`flaker` is a test-intelligence toolkit for:

- sampling a smaller local test run from history and changed files
- detecting flaky tests in noisy CI environments
- measuring how well local sampled runs predict CI
- embedding the same core logic in MoonBit as a library

It is designed for repositories where:

- the full test suite is too expensive to run on every change
- CI failures are noisy because flaky tests are mixed with real regressions
- developers need a smaller local test run that still correlates well with CI

`flaker` helps answer:

- Which tests should I run for this change?
- How much can I shrink local execution without losing too much confidence?
- Which tests are actually flaky?
- How well does local sampled execution predict CI outcomes?

## Install as a CLI

```bash
pnpm add -D @mizchi/flaker
```

Or run it without installing:

```bash
pnpm dlx @mizchi/flaker --help
```

Requirements:

- Node.js 24+
- pnpm 10+

## Use as a MoonBit Library

`flaker` also publishes a MoonBit library surface at `mizchi/flaker`.

The root package re-exports both:

- pure computation APIs
- the shared contract types they consume and return

If you prefer a stricter import boundary, the same types are still available
from `mizchi/flaker/contracts`.

```moonbit
import {
  "mizchi/flaker" @flaker,
}

test "sample from historical runs" {
  let meta = @flaker.build_sampling_meta(
    [
      @flaker.SamplingHistoryRowInput::{
        suite: "tests/login.spec.ts",
        test_name: "login works",
        task_id: Some("web-login"),
        filter: None,
        variant: None,
        test_id: None,
        status: "passed",
        retry_count: 0,
        duration_ms: 1200,
        created_at: "2026-04-03T00:00:00.000Z",
      },
    ],
    [
      @flaker.SamplingListedTestInput::{
        suite: "tests/login.spec.ts",
        test_name: "login works",
        task_id: Some("web-login"),
        filter: None,
        variant: None,
        test_id: None,
      },
    ],
  )

  let sampled = @flaker.sample_weighted(meta, count=1, seed=1UL)
  assert_eq(sampled.length(), 1)
}
```

The root library surface intentionally re-exports pure logic only:

- flaky detection: `detect_flaky`
- sampling: `build_sampling_meta`, `sample_random`, `sample_weighted`, `sample_hybrid`
- affected analysis: `resolve_affected`, `build_affected_report`, `build_affected_report_from_input`
- stable identity: `create_stable_test_id`, `resolve_test_identity`
- graph helpers: `find_affected_nodes`, `expand_transitive`, `topological_sort`
- report reducers: `summarize_report`, `classify_report_diff`, `aggregate_report`
- policy: `summarize_quarantine`, `compute_quarantine_exit_code`, `run_config_check`
- metrics: `build_sampling_kpi`

Contracts remain separate so the API boundary stays explicit and reusable from
other packages.

## Experimental Direct MoonBit CLI

The MoonBit command package at `mizchi/flaker/cmd/flaker` is now directly
executable on both JS and native targets:

```bash
moon run src/cmd/flaker --target js -- --help
moon run src/cmd/flaker --target native -- --version
```

This direct entrypoint is intentionally narrow for now:

- `--help`
- `--version`
- JS bridge exports used by the npm CLI

Host and integration features such as GitHub collection, DuckDB-backed storage,
artifact ingestion, and archive handling will be migrated incrementally through
target-specific `_js.mbt` / `_native.mbt` modules.

## Core Workflow

`flaker` is most useful when you repeat this loop:

1. Collect or import test results from CI and local runs.
2. Build history for flaky detection and sampling.
3. Ask `flaker` to choose a smaller local test set.
4. Run the sampled tests and compare local outcomes with CI.
5. Evaluate whether the sampling strategy is actually trustworthy.

## Quick Start

### 1. Initialize

```bash
flaker init --owner your-org --name your-repo
```

This creates `flaker.toml`.

### 2. Collect test history

From GitHub Actions:

```bash
export GITHUB_TOKEN=$(gh auth token)
flaker collect --last 30
```

From a local report file:

```bash
flaker import report.json --adapter playwright --commit "$(git rev-parse HEAD)"
```

From actrun local history:

```bash
flaker collect-local --last 20
```

### 3. Inspect flakiness

```bash
flaker flaky
flaker reason
flaker eval
```

Useful evaluation outputs:

```bash
flaker eval --json
flaker eval --markdown --window 7
```

The markdown mode is meant for weekly review notes. It summarizes:

- health score
- flaky counts
- local/CI sampling correlation
- average sample ratio
- average saved minutes
- fallback rate

### 4. Sample tests before pushing

```bash
flaker sample --strategy hybrid --count 25
flaker sample --strategy affected --changed src/foo.ts
```

### 5. Sample and execute

```bash
flaker run --strategy hybrid --count 25
flaker run --strategy affected --changed src/foo.ts
```

`flaker run` stores the local sampled run and records sampling telemetry so you can later measure:

- `P(CI pass | local pass)`
- `P(CI fail | local fail)`
- false negatives / false positives
- average saved minutes

## Execution Profiles

flaker automatically selects the right strategy for each execution context:

| Profile | Strategy | Auto-detected |
|---------|----------|--------------|
| `scheduled` | `full` (all tests) | `--profile scheduled` (explicit only) |
| `ci` | `hybrid` + adaptive percentage | `CI=true` |
| `local` | `affected` + time budget | default |

```bash
# Auto-detect (CI → ci, otherwise → local)
flaker run

# Explicit
flaker run --profile scheduled
flaker run --profile ci
flaker run --profile local
```

Configure in `flaker.toml`:

```toml
[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
percentage = 30
adaptive = true        # auto-adjust based on false negative rate

[profile.local]
strategy = "affected"
max_duration_seconds = 60
```

Data flows downstream: daily accumulates history → CI uses it for smarter sampling → local uses dependency graph for fast feedback. The `adaptive` flag automatically reduces CI percentage when data quality is high.

## CI Integration

### PR Comments

Post test results directly on pull requests:

```yaml
- name: Run flaker
  run: flaker run --profile ci

- name: Post PR comment
  if: github.event_name == 'pull_request'
  run: |
    flaker report summarize --adapter vitest --input report.json --pr-comment \
      | gh pr comment ${{ github.event.pull_request.number }} --body-file -
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Auto-create Issues for Quarantined Tests

When flaky tests are auto-quarantined, create tracking issues:

```bash
flaker quarantine --auto --create-issues
```

This creates a GitHub Issue per quarantined test via `gh` CLI, with flaky rate, run count, and fix instructions. Requires `gh` to be installed and authenticated.

## Recommended Usage Model

Start with advisory mode, not CI gating.

The most practical rollout looks like this:

1. `flaker run --profile scheduled` in a nightly scheduled workflow (full test + data accumulation)
2. `flaker run --profile ci` on PR push (selective execution, posts PR comment)
3. `flaker run --profile local` during development (fast feedback)
4. Review `flaker eval` weekly
5. Only tighten the workflow after local-to-CI correlation looks strong

This works best in repositories with:

- long CI times
- flaky tests
- structured reports such as Playwright JSON, JUnit XML, or Vitest JSON

## Main Commands

### Collection and import

```bash
flaker collect
flaker collect-local
flaker import report.json --adapter playwright
```

### Sampling and execution

```bash
flaker sample --strategy random --count 20
flaker sample --strategy weighted --count 20
flaker sample --strategy affected
flaker sample --strategy hybrid --count 50

flaker run --strategy hybrid --count 50
flaker run --strategy affected --changed src/foo.ts
```

### Analysis

```bash
flaker flaky
flaker reason
flaker eval
flaker query "SELECT * FROM test_results LIMIT 20"
```

### Confirm suspected failures

```bash
# Remote: triggers workflow_dispatch, waits for result
flaker confirm "tests/api.test.ts:handles timeout"
flaker confirm "tests/api.test.ts:handles timeout" --repeat 10

# Local: runs via test runner directly
flaker confirm "tests/api.test.ts:handles timeout" --runner local
```

Output: `BROKEN` (regression), `FLAKY` (intermittent), or `TRANSIENT` (not reproducible).

Requires `.github/workflows/flaker-confirm.yml` for remote mode — generated by `flaker init`.

### Retry CI failures locally

```bash
# Re-run failed tests from most recent CI failure
flaker retry

# From a specific workflow run
flaker retry --run 12345678
```

Fetches the test result artifact from the failed CI run, identifies failed tests, and re-runs them locally. Reports which failures reproduce (real regressions) vs which don't (CI-specific or flaky).

### Policy and ownership

```bash
flaker quarantine
flaker quarantine --auto --create-issues
flaker check
flaker affected --changed src/foo.ts
```

### Reporting

```bash
flaker report summarize --adapter vitest --input report.json --markdown
flaker report summarize --adapter vitest --input report.json --pr-comment
flaker report diff --base base.json --head head.json
```

## Minimal Configuration

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
command = "pnpm vitest"

[affected]
resolver = "workspace"

[flaky]
window_days = 14
detection_threshold = 2.0

[quarantine]
auto = true
flaky_rate_threshold = 30.0
min_runs = 10

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
percentage = 30
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
```

## Docs

- [Usage Guide](https://github.com/mizchi/flaker/blob/main/docs/how-to-use.md)
- [Why flaker](https://github.com/mizchi/flaker/blob/main/docs/why-flaker.md)
- [Design Partner Rollout](https://github.com/mizchi/flaker/blob/main/docs/design-partner-rollout.ja.md)

## Release

The published npm entry point is:

```bash
node_modules/@mizchi/flaker/dist/cli/main.js
```

The package is built with Rolldown and includes the bundled MoonBit core in `dist/moonbit/flaker.js`.
