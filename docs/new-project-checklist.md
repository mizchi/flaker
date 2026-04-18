# flaker New Project Onboarding Checklist

[日本語版](new-project-checklist.ja.md)

The checklist for introducing flaker to a new repository and getting value from it across the first day, first week, and first month. Assumes `0.3.0+`.

If you follow it in order, initial setup takes about 30 minutes, your measurement baseline is in place within a week, and the repository is ready to promote CI gating in 2-4 weeks.

---

## Day 0: Preconditions (5 minutes)

```bash
node --version    # >= 24
pnpm --version    # >= 10
git remote -v     # origin should point at GitHub
gh auth status    # logged in (needed for collect ci)
```

If the repository does not use GitHub Actions yet or has no history, skip `collect ci` on Day 1 and use a “local first -> collect later” flow.

You do not need `moon` (MoonBit). flaker ships a bundled `dist/moonbit/flaker.js`, and falls back to TypeScript (`src/cli/core/loader.ts`) when needed.

---

## Day 1: Install and initialize (15 minutes)

### 1. Install

```bash
pnpm add -D @mizchi/flaker
```

### 2. Generate `flaker.toml`

Choose the adapter and runner at init time:

```bash
# vitest project
pnpm flaker init --adapter vitest --runner vitest

# playwright e2e
pnpm flaker init --adapter playwright --runner playwright

# jest
pnpm flaker init --adapter jest --runner jest

# actrun wrapping a GitHub Actions workflow for playwright
pnpm flaker init --adapter playwright --runner actrun
```

`owner` and `name` are auto-detected from the git remote. Override with `--owner` / `--name` if needed.

### 3. Check the environment with doctor

```bash
pnpm flaker doctor
```

Expected output looks like:

```text
OK  config    flaker.toml is readable
OK  config rangesall values within expected ranges
OK  duckdb    DuckDB initialized successfully
OK  moonbit   MoonBit JS build detected (or fallback)

Doctor checks passed.
```

If DuckDB fails to initialize, the most likely cause is `node --version < 24`.

### 4. Configure the affected resolver

To make `flaker run --gate iteration` and the `hybrid` strategy useful, you need an affected resolver. Edit `[affected]` in `flaker.toml` based on the repository shape:

```toml
# pnpm workspaces / npm workspaces monorepo
[affected]
resolver = "workspace"
config = ""

# glob rules with a separate flaker.affected.toml
[affected]
resolver = "glob"
config = "flaker.affected.toml"

# bitflow repository
[affected]
resolver = "bitflow"
config = ""
```

If you do not configure a resolver, `hybrid` still works through `weighted` / `random` fallback, but you lose the best change-aware behavior. Start with `workspace` if possible.

### 5. Dry-run locally

```bash
git diff --name-only main | tr '\n' ',' > /tmp/changed.txt
pnpm flaker run --gate iteration --dry-run --explain --changed "$(cat /tmp/changed.txt)"
```

If `Selected tests:` shows a count, the pipeline is working. If the `Sampling Summary` is empty, that usually means either there are no matching tests yet or the resolver config does not match the project layout.

---

## Day 2-3: Build the first dataset (30 minutes)

### 1. Collect CI history if it exists

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 30
```

Expected output looks like:

```text
Exported to Parquet: 12 test results, 4 commit changes
...
Collected N runs, N*X test results, ...
```

It is fine if some failed runs are skipped. `pending artifact runs` usually just means retention timing; rerun later.

### 2. Calibrate

```bash
pnpm flaker collect calibrate
```

This writes the recommended strategy and sampling percentage into `[sampling]` in `flaker.toml`. Add `--dry-run` if you want to preview without writing.

If data is still thin (`commits < 20`), you may get `confidence: insufficient` or `low`. That is acceptable at this stage; recalibrate again after a week.

### 3. Check the KPI dashboard

```bash
pnpm flaker analyze kpi
```

At first, `Sampling Effectiveness` may be mostly empty (`matched commits = 0`). By the end of Week 1, local/CI correlation starts to become meaningful.

---

## Day 3: Add package.json scripts

```jsonc
{
  "scripts": {
    "flaker": "flaker",
    "flaker:run:iteration": "flaker run --gate iteration",
    "flaker:run:release": "flaker run --gate release",
    "flaker:collect:ci": "flaker collect ci --days 7",
    "flaker:collect:local": "flaker collect local --last 1",
    "flaker:eval:markdown": "flaker analyze eval --markdown --window 7",
    "flaker:doctor": "flaker doctor"
  }
}
```

`pnpm flaker:run:iteration` works well from a pre-push hook via lefthook or husky.

---

## Day 5: Integrate with GitHub Actions (advisory mode)

### 1. PR advisory job

Add this to `.github/workflows/ci.yml`:

```yaml
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: 24

- name: Setup pnpm
  uses: pnpm/action-setup@v4

- name: Install
  run: pnpm install --frozen-lockfile

- name: Run tests via flaker (advisory)
  run: pnpm flaker run --gate merge
  continue-on-error: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Post sampling KPI as PR comment
  if: github.event_name == 'pull_request'
  run: |
    pnpm flaker analyze kpi > .artifacts/kpi.md
    pnpm flaker report summary --adapter vitest --input report.json --pr-comment \
      | gh pr comment ${{ github.event.pull_request.number }} --body-file -
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The key point is `continue-on-error: true`. For the first 2-4 weeks, do not make this a required check.

### 2. Nightly history job

Create `.github/workflows/nightly-flaker.yml`:

```yaml
name: nightly flaker
on:
  schedule: [{ cron: "0 18 * * *" }]
  workflow_dispatch:
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm flaker collect ci --days 1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: pnpm flaker run --gate release
      - run: pnpm flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
      - uses: actions/upload-artifact@v6
        with:
          name: flaker-nightly
          path: .artifacts/
```

This collects one day of CI history, runs the release gate, and writes weekly review material.

---

## Week 1: Observe and tune

Spend five minutes each morning on:

```bash
pnpm flaker analyze kpi
pnpm flaker analyze flaky
pnpm flaker analyze insights
```

When something looks suspicious:

```bash
# classify a single test as broken / flaky / transient
pnpm flaker debug confirm "tests/api.test.ts:handles timeout" --runner local --repeat 10

# retry a failed CI run locally
pnpm flaker debug retry --run <run-id>

# find the commit range where a test became flaky
pnpm flaker debug bisect --test "tests/api.test.ts:handles timeout"
```

---

## Week 2-4: When to promote to required

Switch the merge gate from advisory to required only after `pnpm flaker analyze kpi` shows at least:

| Metric | Target |
|---|---|
| Matched commits | ≥ 20 |
| Recall (CI failures caught) | ≥ 90% |
| False negative rate | ≤ 5% |
| Pass correlation | ≥ 95% |
| Holdout FNR (if enabled) | ≤ 10% |
| Co-failure data | `ready` |
| Data confidence | `moderate` or `high` |

At that point, remove `continue-on-error: true` from the CI job.

### Re-run calibration as data grows

```bash
pnpm flaker collect calibrate
git diff flaker.toml
```

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `flaker.toml uses deprecated keys` | Config from 0.1.x or earlier. Use the rename table in `docs/how-to-use.md#config-migration`. |
| `Config file not found` | You are not at the project root. `cd` there and start with `pnpm flaker init`. |
| `actrun runner requires [runner.actrun] workflow` | Add `[runner.actrun]` to `flaker.toml`. |
| `hybrid` selects 0 tests | Resolver not configured. Fill in `[affected].resolver`. |
| `collect ci` returns 0 runs | Missing or under-scoped `GITHUB_TOKEN`, often without `actions:read`. |
| `analyze kpi` shows `insufficient data` | Fewer than 5 commits. Keep collecting for about a week. |
| Parallel tests time out | DuckDB is single-writer. Serialize processes using the same `.flaker/data.duckdb`. |
| `dist/moonbit/flaker.js` is missing | It should already be bundled by the npm package. If not, inspect the package build. |

---

## The ideal shape after one month

- `flaker run --gate merge` is a required PR check
- nightly keeps history fresh every day
- weekly reports (`analyze eval --markdown`) are posted to Slack or issues
- developers use `pnpm flaker:run:iteration` locally
- flaky tests are quarantined and tracked with `policy quarantine --auto --create-issues`

At that point, many repositories can cut CI time by 30-70% while keeping missed failures under 5%.

---

## References

- [README.md](../README.md) — project overview
- [usage-guide.md](usage-guide.md) — user-facing entrypoint
- [operations-guide.md](operations-guide.md) — operator-facing entrypoint
- [how-to-use.md](how-to-use.md) — detailed commands and configuration
- [contributing.md](contributing.md) — development and dogfood workflow
- [CHANGELOG.md](../CHANGELOG.md) — release history and breaking changes
