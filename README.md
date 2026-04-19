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

> **Upgrading from 0.0.x / 0.1.x?** See [docs/how-to-use.md#config-migration](docs/how-to-use.md#config-migration) for the full key rename map. Starting with `0.2.0`, the CLI refuses to start on legacy configs and points to the migration guide.
>
> **Upgrading from 0.4.x?** See [docs/migration-0.4-to-0.5.md](docs/migration-0.4-to-0.5.md) or [docs/migration-0.4-to-0.5.ja.md](docs/migration-0.4-to-0.5.ja.md). `0.5.x` keeps existing profiles working, but the recommended user-facing commands are now gate-oriented.

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

## Install as a Claude Code plugin

This repo also ships a Claude Code plugin with two skills:

- `flaker-setup`
  Introduce flaker on a fresh repository. Day 0 → Week 4 onboarding flow, decision points, copy-paste commands, and pitfalls.
- `flaker-management`
  Operate flaker after setup. Advisory vs required gating, nightly triage, quarantine, flaky tag management, and staged Playwright E2E / VRT rollout.

```bash
# In Claude Code
/plugin marketplace add mizchi/flaker
/plugin install flaker@flaker
```

Then ask the agent something like:

- "新しいプロジェクトに flaker をセットアップしたい"
- "flaker の advisory を required に上げる条件を決めたい"
- "E2E VRT の nightly triage を設計したい"

The setup reference checklist lives at [docs/new-project-checklist.ja.md](docs/new-project-checklist.ja.md) and [docs/new-project-checklist.md](docs/new-project-checklist.md).
The `0.4.x -> 0.5.x` migration guide lives at [docs/migration-0.4-to-0.5.ja.md](docs/migration-0.4-to-0.5.ja.md) and [docs/migration-0.4-to-0.5.md](docs/migration-0.4-to-0.5.md).
The user guide lives at [docs/usage-guide.ja.md](docs/usage-guide.ja.md) and [docs/usage-guide.md](docs/usage-guide.md).
The operations guide lives at [docs/operations-guide.ja.md](docs/operations-guide.ja.md) and [docs/operations-guide.md](docs/operations-guide.md).
The operations quick start lives at [docs/flaker-management-quickstart.ja.md](docs/flaker-management-quickstart.ja.md) and [docs/flaker-management-quickstart.md](docs/flaker-management-quickstart.md).

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

## Mental Model

`flaker` exposes sampling strategies and execution profiles, but operationally it
is easier to reason about it in four layers:

- **Gate**: a decision boundary such as "can the author keep iterating?", "can
  this PR merge?", or "can we release?"
- **Budget**: the constraints that a gate must stay within
- **Loop**: a background routine that keeps a gate trustworthy over time
- **Policy**: the rules for how the system reacts when trust drops

In this model, sampling is not the primary concept. Sampling is an internal
strategy used to keep a gate inside its budgets.

### 1. Gates

Most teams only need three gates:

- **Iteration Gate**: fast local feedback for the author
- **Merge Gate**: the PR or mainline gate
- **Release Gate**: a stricter full-suite or pre-release check

### 2. Budgets

A gate can have more than one budget:

- **Time budget**: how long humans are willing to wait
- **Signal budget**: how much false negative or flaky noise is acceptable
- **Execution budget**: CI minutes, parallelism, browser workers, compute cost
- **Product performance budget**: LCP, INP, bundle size, latency, or similar

This distinction matters because "performance budget" can mean either:

- execution performance of the test system itself
- performance of the product being tested

### 3. Loops

Loops are not usually gates. They exist to make gates reliable:

- **Observation loop**: scheduled full runs, history collection, holdout
  verification, KPI refresh
- **Triage loop**: quarantine review, `@flaky` tagging, promotion, demotion,
  owner assignment
- **Incident loop**: retry, confirm, diagnose, and fix after a real failure

### 4. Policies

Policies encode operational decisions:

- when to auto-quarantine
- when to exclude `@flaky` tests from normal execution
- when to promote an advisory check to required
- when to demote a required check back to advisory
- how retries are interpreted

Retries can help classify failures, but they are not proof of stability.

### Mapping to flaker today

The current CLI and config already fit this model:

| Mental model | Current flaker shape |
|-------------|----------------------|
| Iteration Gate | `profile.local` |
| Merge Gate | `profile.ci` |
| Release Gate | usually a full run, often backed by `profile.scheduled` or a dedicated release workflow |
| Observation loop | `flaker collect` + `flaker ops daily` |
| Triage loop | `flaker gate review merge` + `flaker ops weekly` + `flaker quarantine suggest/apply` |
| Incident loop | `flaker ops incident` |

If you describe flaker this way, the surface area becomes smaller:

- users choose gates and budgets
- operators run loops and maintain policies
- flaker chooses strategies such as `affected`, `hybrid`, or `full`

The older primitives such as `analyze eval`, `analyze flaky-tag`, and `policy quarantine` still exist, but they are now advanced/internal surfaces rather than the primary operator entrypoints.

## Quick Start

`flaker.toml` is the **desired state**. `flaker apply` reconciles the repo to it, idempotently. Works on fresh repos (no history) and mature repos alike — the reconciler handles the branching.

```bash
pnpm add -D @mizchi/flaker
pnpm flaker init --adapter <playwright|vitest|jest|junit> --runner <same or actrun>
# edit [affected].resolver in flaker.toml (workspace | glob | bitflow)
pnpm flaker doctor
pnpm flaker plan          # preview what apply will do
pnpm flaker apply         # converge (safe to re-run)
pnpm flaker status        # dashboard + promotion drift
```

`flaker init` generates `[profile.local]` / `[profile.ci]` / `[profile.scheduled]` defaults out of the box. `flaker apply` detects missing CI history, runs a cold-start iteration gate, collects CI runs when `GITHUB_TOKEN` is set, and tunes sampling via calibrate when there are enough matched commits — in that order, skipping whatever isn't applicable.

The full Day 0 → Week 4 onboarding checklist lives at [docs/new-project-checklist.ja.md](docs/new-project-checklist.ja.md) / [.md](docs/new-project-checklist.md).

> **Canonical command forms (0.7.0)**
>
> The primary surface is 11 commands: `init`, `plan`, `apply`, `status`, `run`, `doctor`, `debug`, `query`, `explain`, `import`, `report`. Everything else is either Advanced (`gate`, `ops`, `dev`) or Deprecated (removed in 0.8.0). The legacy aliases below still work and emit a stderr warning pointing at the canonical form.
>
> | Canonical (0.7.0) | Legacy form |
> |---|---|
> | `flaker apply` | `flaker collect ci / local / coverage / calibrate`, `flaker quarantine suggest / apply`, `flaker policy quarantine`, `flaker analyze flaky-tag` |
> | `flaker status` | `flaker analyze kpi`, `flaker kpi` |
> | `flaker status --markdown` | `flaker analyze eval --markdown` |
> | `flaker status --list flaky` | `flaker analyze flaky` |
> | `flaker status --gate <name> --detail --json` | `flaker gate review <name> --json`, `flaker gate history`, `flaker gate explain` |
> | `flaker run --gate <name>` | `flaker exec run`, `flaker exec affected` |
> | `flaker init` | `flaker setup init` |
> | `flaker doctor` | `flaker debug doctor` |
> | `flaker query <sql>` | `flaker analyze query` |
> | `flaker explain <topic>` | `flaker analyze reason / insights / cluster / bundle / context` |
> | `flaker import <file>` (adapter auto-detect) | `flaker import report / parquet` |
> | `flaker report <file> --summary \| --diff <base> \| --aggregate <dir>` | `flaker report summary / diff / aggregate` |

### Initialize

```bash
flaker init --owner your-org --name your-repo
```

This creates `flaker.toml`.

### Collect test history

From GitHub Actions:

```bash
export GITHUB_TOKEN=$(gh auth token)
flaker collect --days 30
```

From a local report file:

```bash
flaker import report <file> --adapter playwright --commit "$(git rev-parse HEAD)"
```

If the imported artifact came from CI rather than a local run, mark it explicitly:

```bash
flaker import report <file> --adapter playwright --source ci --commit <sha>
```

From actrun local history:

```bash
flaker collect local --last 20
```

To execute through `actrun`, configure the workflow path explicitly:

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

### Inspect health and operator state

```bash
flaker status
flaker gate review merge
flaker gate history merge --json
flaker quarantine suggest --json
flaker ops weekly --json
```

Advanced/internal analysis primitives still exist when you need lower-level detail:

```bash
flaker analyze flaky
flaker analyze reason
flaker analyze eval --json
flaker analyze eval --markdown --window 7
flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

The markdown mode is meant for weekly review notes. It summarizes:

- health score
- flaky counts
- local/CI sampling correlation
- average sample ratio
- average saved minutes
- fallback rate

### Sample tests before pushing

```bash
flaker run --dry-run --strategy hybrid --count 25
flaker run --dry-run --strategy affected --changed src/foo.ts
flaker run --dry-run --gate iteration --changed src/foo.ts
```

### Sample and execute

```bash
flaker run --strategy hybrid --count 25
flaker run --strategy affected --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts
flaker run --runner actrun
```

`flaker run` stores the local sampled run and records sampling telemetry so you can later measure:

- `P(CI pass | local pass)`
- `P(CI fail | local fail)`
- false negatives / false positives
- average saved minutes

When flaker has no local history yet, the sampling summary now explains the cold-start fallback and suggests the next steps to build usable history.
The first `flaker run` can still sample from the runner's listed tests, record that local run, and use the new history on the next run, so a fresh project can try the package immediately.

## Execution Gates

User-facing CLI usage should prefer gates. Profiles remain available as the
advanced internal mechanism.

| Gate | Backing profile | Purpose |
|------|-----------------|---------|
| `iteration` | `local` | Fast local feedback for the author |
| `merge` | `ci` | PR / mainline gate |
| `release` | `scheduled` | Full or near-full verification |

```bash
# Auto-detects the backing profile
flaker run

# Explicit gate selection
flaker run --gate iteration
flaker run --gate merge
flaker run --gate release

# Advanced: explicit profile names still work
flaker run --profile local
flaker run --profile ci
flaker run --profile scheduled
```

Configure in `flaker.toml`:

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"
flaky_tag_pattern = "@flaky"

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true        # auto-adjust based on false negative rate
skip_flaky_tagged = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
skip_flaky_tagged = true
```

This supports a simple Playwright workflow:

- `release` / `scheduled` runs all E2E tests and accumulates history
- `merge` / `iteration` exclude tests tagged with `@flaky`
- `flaker ops weekly --json` carries both quarantine and flaky-tag suggestions for operator review

Recommended `@flaky` loop:

1. Start with full E2E execution so flaker can accumulate baseline history.
2. When a Playwright test is known to be flaky, tag it with `@flaky`.
   `flaker` detects both Playwright tags and `@flaky` embedded in the test title.
3. Keep `release` / `scheduled` as full execution, and use `merge` / `iteration` with `skip_flaky_tagged = true`.
   For Playwright, flaker passes `--grep-invert @flaky` to normal runs.
4. Run weekly triage and let an AI agent update test sources based on the artifact:

```bash
flaker ops weekly --json > .artifacts/flaker-weekly.json
```

The weekly artifact contains flaky-tag suggestions:

- `suggestions.add`: untagged tests that are unstable enough to move into `@flaky`
- `suggestions.remove`: currently tagged tests that have enough consecutive clean passes to return to normal execution
- `suggestions.keep`: currently tagged tests that should remain excluded from normal execution

If you want the raw primitive instead of the bundled operator artifact:

```bash
flaker analyze flaky-tag --json > .artifacts/flaky-tag-triage.json
```

By default, add-thresholds come from `[quarantine]`:

- `quarantine.flaky_rate_threshold_percentage`
- `quarantine.min_runs`

Remove suggestions default to `5` consecutive clean passes, and can be tuned:

```bash
flaker analyze flaky-tag --json \
  --add-threshold 30 \
  --min-runs 10 \
  --remove-after-passes 5
```

Data flows downstream: release observation accumulates history → merge uses it for smarter sampling → iteration uses dependency graph for fast feedback. The `adaptive` flag automatically reduces CI percentage when data quality is high.

For local dogfooding, the practical loop is:

```bash
flaker exec affected --changed src/foo.ts
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts
```

## CI Integration

### PR Comments

Post test results directly on pull requests:

```yaml
- name: Run flaker
  run: flaker run --gate merge

- name: Post PR comment
  if: github.event_name == 'pull_request'
  run: |
    flaker report summary --adapter vitest --input report.json --pr-comment \
      | gh pr comment ${{ github.event.pull_request.number }} --body-file -
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Auto-create Issues for Quarantined Tests

When flaky tests are auto-quarantined, create tracking issues:

```bash
flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
```

This creates a reviewed plan first, then applies it and optionally opens GitHub Issues via `gh` CLI. Requires `gh` to be installed and authenticated.

### Self-Host Rollout

The repo now ships two GitHub-native self-host lanes:

- [ci.yml](https://github.com/mizchi/flaker/blob/main/.github/workflows/ci.yml): a `self-host-advisory` job runs on pull requests, executes `flaker run --gate merge`, snapshots `kpi` / `eval`, and updates a sticky PR comment.
- [nightly-self-host.yml](https://github.com/mizchi/flaker/blob/main/.github/workflows/nightly-self-host.yml): a scheduled job rebuilds recent CI history with `flaker collect`, runs `flaker run --gate release`, and updates a rolling issue labeled `flaker-self-host`.

Both lanes render the same promotion-readiness summary from `scripts/self-host-review.mjs`. The current default is still advisory: the PR job is non-blocking, and the nightly workflow carries the long-form trend.

Promote `flaker run --gate merge` to a required check only after the nightly issue shows **all five** of the following. The primary signal is `flaker status` (the `Promotion drift` section reports `ready` when all five thresholds are met). For the exact numeric values, use `flaker status --gate merge --detail --json` — this is the authoritative output. (`flaker gate review merge --json` is the legacy alias, DEPRECATED in 0.7.0, removed in 0.8.0.)

- `matched commits >= 20` — commits where both a gated local/CI run and a release/full run exist in the same window, so that local sampling outcomes can be compared against a ground-truth full run. Increases as the nightly `--gate release` accumulates history.
- `false negative rate <= 5%` — share of commits where the `merge` gate passed but the full run failed (sampling missed a real regression). Measured over the same matched-commit window.
- `pass correlation >= 95%` — `P(full run passes | merge gate passes)` on matched commits. Same metric referenced elsewhere in this README as `P(CI pass | local pass)`.
- `holdout FNR <= 10%` — FNR measured on the holdout slice defined by `[sampling] holdout_ratio`. Tests in the holdout slice are excluded from the sampled run so that their outcomes can be used to audit whether the sampler's verdict generalizes. Guards against sampler overfitting to the visible slice.
- `data confidence` reaches `moderate` or `high` — derived signal combining matched-commit count, history window coverage, and flaky-noise level. Rough rule of thumb: `low` until ~10 matched commits, `moderate` around 20–40 with FNR/correlation green, `high` beyond 40 with stable noise. Exact boundaries come from the `status --gate merge --detail --json` output, not from config.

## Recommended Usage Model

Start with advisory mode, not CI gating.

The most practical rollout looks like this:

1. `flaker run --gate release` in a nightly scheduled workflow (full test + data accumulation)
2. `flaker run --gate merge` on PR push (selective execution, posts PR comment)
3. `flaker run --gate iteration` during development (fast feedback)
4. Review `flaker status`, `flaker gate review merge`, and `flaker ops weekly` weekly
5. Only tighten the workflow after local-to-CI correlation looks strong

This works best in repositories with:

- long CI times
- flaky tests
- structured reports such as Playwright JSON, JUnit XML, or Vitest JSON

## Main Commands

### Collection and import

```bash
flaker collect
flaker collect local
flaker import report <file> --adapter playwright
flaker collect coverage --format istanbul --input coverage/coverage-final.json
```

### Sampling and execution

```bash
flaker run --dry-run --strategy random --count 20
flaker run --dry-run --strategy weighted --count 20
flaker run --dry-run --strategy affected
flaker run --dry-run --strategy hybrid --count 50

flaker run --strategy hybrid --count 50
flaker run --strategy affected --changed src/foo.ts
```

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

### Analysis

```bash
flaker analyze flaky
flaker analyze reason
flaker analyze eval
flaker dev train
flaker analyze query "SELECT * FROM test_results LIMIT 20"
```

### Confirm suspected failures

```bash
# Remote: triggers workflow_dispatch, waits for result
flaker debug confirm "tests/api.test.ts:handles timeout"
flaker debug confirm "tests/api.test.ts:handles timeout" --repeat 10

# Local: runs via test runner directly
flaker debug confirm "tests/api.test.ts:handles timeout" --runner local
```

Output classification (based on `--repeat N` runs, default `N=5`):

- `BROKEN` — fails on **every** repeat (`failures == N`). Treat as a real regression.
- `FLAKY` — fails on **some but not all** repeats (`0 < failures < N`). Candidate for `@flaky` tag or quarantine.
- `TRANSIENT` — passes on every repeat (`failures == 0`). The original CI failure did not reproduce here; either CI-environment specific or a one-shot noise event.

Use `--repeat 10` (or higher) when you suspect a low-rate flake that the default `N=5` might miss. Higher `N` trades wall time for classification confidence.

Requires `.github/workflows/flaker-confirm.yml` for remote mode — generated by `flaker init`. If your repo predates this file, re-run `flaker init --force` or copy the template from `templates/flaker-confirm.yml` in this repo.

### Retry CI failures locally

```bash
# Re-run failed tests from most recent CI failure
flaker debug retry

# From a specific workflow run
flaker debug retry --run 12345678
```

Fetches the test result artifact from the failed CI run, identifies failed tests, and re-runs them locally. Reports which failures reproduce (real regressions) vs which don't (CI-specific or flaky).

### Policy and ownership

```bash
flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
flaker policy check
flaker exec affected --changed src/foo.ts
```

### Reporting

```bash
flaker report summary --adapter vitest --input report.json --markdown
flaker report summary --adapter vitest --input report.json --pr-comment
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
type = "playwright"
command = "pnpm exec playwright test"
flaky_tag_pattern = "@flaky"

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
skip_flaky_tagged = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
skip_flaky_tagged = true
```

## Docs

- [新規プロジェクト導入チェックリスト (ja)](https://github.com/mizchi/flaker/blob/main/docs/new-project-checklist.ja.md)
- [New Project Onboarding Checklist](https://github.com/mizchi/flaker/blob/main/docs/new-project-checklist.md)
- [Usage Guide (ja)](https://github.com/mizchi/flaker/blob/main/docs/usage-guide.ja.md)
- [Usage Guide](https://github.com/mizchi/flaker/blob/main/docs/usage-guide.md)
- [Operations Guide (ja)](https://github.com/mizchi/flaker/blob/main/docs/operations-guide.ja.md)
- [Operations Guide](https://github.com/mizchi/flaker/blob/main/docs/operations-guide.md)
- [Detailed Command Reference](https://github.com/mizchi/flaker/blob/main/docs/how-to-use.md)
- [Why flaker](https://github.com/mizchi/flaker/blob/main/docs/why-flaker.md)
- [Design Partner Rollout](https://github.com/mizchi/flaker/blob/main/docs/design-partner-rollout.ja.md)

For contributing and dogfood workflows, see [docs/contributing.md](docs/contributing.md).

## Release

The published npm entry point is:

```bash
node_modules/@mizchi/flaker/dist/cli/main.js
```

The package is built with Rolldown and includes the bundled MoonBit core in `dist/moonbit/flaker.js`.
