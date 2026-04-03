# flaker

`flaker` is a CLI for test sampling, flaky-test analysis, and metrics collection.

It is designed for repositories where:

- the full test suite is too expensive to run on every change
- CI failures are noisy because flaky tests are mixed with real regressions
- developers need a smaller local test run that still correlates well with CI

`flaker` helps answer:

- Which tests should I run for this change?
- How much can I shrink local execution without losing too much confidence?
- Which tests are actually flaky?
- How well does local sampled execution predict CI outcomes?

## Install

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

## Recommended Usage Model

Start with advisory mode, not CI gating.

The most practical rollout looks like this:

- use `flaker run --strategy hybrid --count N` locally
- keep full CI as the source of truth
- collect local and CI results into the same database
- review `flaker eval` weekly
- only tighten the workflow after local-to-CI correlation looks strong

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

### Policy and ownership

```bash
flaker quarantine
flaker check
flaker affected --changed src/foo.ts
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
```

## Docs

- [Usage Guide](./docs/how-to-use.md)
- [Why flaker](./docs/why-flaker.md)

## Release

The published npm entry point is:

```bash
node_modules/@mizchi/flaker/dist/cli/main.js
```

The package is built with Rolldown and includes the bundled MoonBit core in `dist/moonbit/flaker.js`.
