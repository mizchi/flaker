# flaker — Flaky Test Detection & Test Sampling CLI

Too many tests to run them all. CI keeps failing on flaky tests. Can't tell what's really broken. flaker solves these problems.

[日本語版](how-to-use.ja.md)

## Installation

```bash
# Add to your npm/pnpm project
pnpm add -D @mizchi/flaker

# Or run directly
pnpm dlx @mizchi/flaker --help
```

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
flaker collect --last 30
```

Or import local test reports directly:

```bash
# Playwright JSON report
pnpm exec playwright test --reporter json > report.json
flaker import report.json --adapter playwright --commit $(git rev-parse HEAD)

# JUnit XML report
flaker import results.xml --adapter junit --commit $(git rev-parse HEAD)
```

### 3. Analyze

```bash
# List flaky tests
flaker flaky

# AI-powered analysis with recommended actions
flaker reason

# Test suite health score
flaker eval
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
type = "playwright"     # "playwright" | "junit" | "custom"

# Test runner
[runner]
type = "vitest"         # "vitest" | "playwright" | "moontest" | "custom"
command = "pnpm vitest"

# Dependency analysis for affected strategy
[affected]
resolver = "workspace"  # "simple" | "workspace" | "moon" | "bitflow"

# Auto-quarantine flaky tests
[quarantine]
auto = true
flaky_rate_threshold = 30.0   # Quarantine candidate above this %
min_runs = 10                  # Minimum runs before making judgments

# Flaky detection parameters
[flaky]
window_days = 14              # Analysis window
detection_threshold = 2.0     # Mark as flaky above this %
```

---

## Command Reference

### `flaker collect` — Collect from CI

```bash
flaker collect                    # Last 30 days
flaker collect --last 90          # Last 90 days
flaker collect --branch main      # main branch only
```

Auto-extracts Playwright JSON / JUnit XML from GitHub Actions artifacts. Requires `GITHUB_TOKEN` environment variable.

### `flaker import` — Import Local Reports

```bash
flaker import report.json --adapter playwright
flaker import results.xml --adapter junit
flaker import report.json --commit abc123 --branch feature-x
```

Import locally-generated test reports directly into the database.

### `flaker collect-local` — Import actrun History

```bash
flaker collect-local              # Import all actrun run history
flaker collect-local --last 10    # Last 10 runs only
```

Imports results from [actrun](https://github.com/mizchi/actrun) (GitHub Actions-compatible local runner). Automatically detects and parses Playwright/JUnit reports in artifact directories.

### `flaker flaky` — Detect Flaky Tests

```bash
flaker flaky                      # Top flaky tests
flaker flaky --top 50             # Top 50
flaker flaky --test "login"       # Filter by name
flaker flaky --true-flaky         # DeFlaker mode: same commit, inconsistent results
flaker flaky --trend --test "should redirect"  # Weekly trend
flaker flaky --by-variant         # Per OS/browser breakdown
```

#### Detection Modes

| Mode | Flag | Method |
|------|------|--------|
| Threshold | (default) | Failure rate exceeds threshold in rolling window |
| True flaky | `--true-flaky` | Same commit_sha has both pass and fail (DeFlaker method) |
| By variant | `--by-variant` | Flaky rate per execution environment (OS, browser, etc.) |

### `flaker reason` — AI-Powered Analysis

```bash
flaker reason                     # Report with recommended actions
flaker reason --json              # Machine-readable JSON
flaker reason --window 7          # Analyze last 7 days
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

### `flaker sample` — Test Sampling

```bash
flaker sample --strategy random --count 20        # Uniform random
flaker sample --strategy weighted --count 20      # Flaky-weighted
flaker sample --strategy affected                 # Change-affected only
flaker sample --strategy hybrid --count 50        # Hybrid (recommended)
flaker sample --percentage 30                     # 30% of all tests
flaker sample --skip-quarantined                  # Exclude quarantined
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
flaker run --skip-quarantined
flaker run --runner actrun                        # Execute via actrun
flaker run --runner actrun --retry                # Retry failed tests only
```

Results are automatically stored in the database.

### `flaker quarantine` — Isolate Flaky Tests

```bash
flaker quarantine                                 # List quarantined
flaker quarantine --auto                          # Auto-quarantine above threshold
flaker quarantine --add "suite>testName"          # Manual add
flaker quarantine --remove "suite>testName"       # Remove
```

Quarantined tests can be excluded from runs with `--skip-quarantined`.

### `flaker bisect` — Find Culprit Commit

```bash
flaker bisect --test "should redirect"
flaker bisect --test "should redirect" --suite "tests/login.spec.ts"
```

Identifies the commit range where a test became flaky.

### `flaker eval` — Health Assessment

```bash
flaker eval
flaker eval --json
```

Rates overall test suite health on a 0-100 scale:
- **Data Sufficiency** — Is there enough data?
- **Detection** — Flaky test detection status
- **Resolution** — Resolution tracking (MTTD/MTTR)
- **Health Score** — Composite score

### `flaker query` — Direct SQL Analysis

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

### Vitest

```toml
[adapter]
type = "playwright"    # vitest --reporter json is Playwright-compatible

[runner]
type = "vitest"
command = "pnpm vitest"
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
flaker collect-local
```

---

## Typical Workflows

### Daily Development

```bash
# Morning: sync CI data
flaker collect

# After code changes: run only affected tests
flaker run --strategy affected

# Check overall status
flaker eval
```

### Flaky Test Triage

```bash
# Identify problematic tests
flaker reason

# Quarantine severe cases
flaker quarantine --auto

# Find culprit commit
flaker bisect --test "problematic test name"

# After fixing, remove quarantine
flaker quarantine --remove "suite>testName"
```

### CI Integration

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker collect --last 7
    flaker eval --json > flaker-report.json
    flaker reason --json > flaker-reason.json

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
