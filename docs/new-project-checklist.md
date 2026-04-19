# flaker New Project Onboarding Checklist

[日本語版](new-project-checklist.ja.md)

The checklist for introducing flaker to a new repository and getting value from it across the first day, first week, and first month. Assumes `0.7.0+`.

Day 1 converges in five steps: `init -> doctor -> plan -> apply -> status`. If you follow it in order, initial setup takes about 30 minutes, your measurement baseline is in place within a week, and the repository is ready to promote CI gating in 2-4 weeks.

---

## Day 0: Preconditions (5 minutes)

```bash
node --version    # >= 24
pnpm --version    # >= 10
git remote -v     # origin should point at GitHub
gh auth status    # logged in (needed for flaker apply when pulling CI history)
```

Repositories with no GitHub Actions history are still fine. `flaker apply` detects an empty history and picks the cold-start path (self-seed from a local run). Real CI history accumulates naturally after Day 1.

You do not need `moon` (MoonBit). flaker ships a bundled `dist/moonbit/flaker.js`, and falls back to TypeScript (`src/cli/core/loader.ts`) when needed.

---

## Day 1: Install through convergence (15 minutes)

Day 1 is a single five-step flow. `flaker apply` handles collect / calibrate / quarantine sequencing internally, so you do not have to memorize the order.

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

As of 0.7.0, `flaker init` also writes default `[profile.scheduled]` / `[profile.ci]` / `[profile.local]` blocks so that gates resolve immediately.

### 3. Check the environment with doctor

```bash
pnpm flaker doctor
```

Expected output looks like:

```text
OK  config    flaker.toml is readable
OK  config ranges all values within expected ranges
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

### 5. Preview with `flaker plan`

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker plan
```

`flaker plan` reads `flaker.toml` as desired state and reports what the DB is currently missing. An empty-history repository usually plans `collect_ci` + `cold_start_run`; if `[quarantine].auto = true`, a `quarantine_apply` action shows up too.

### 6. Converge with `flaker apply`

```bash
pnpm flaker apply
```

`flaker apply` is idempotent and runs `collect` / `calibrate` / `quarantine apply` on demand based on current state. It is safe to re-run from cron or nightly — repeated executions do not break anything.

### 7. Inspect with `flaker status`

```bash
pnpm flaker status
```

A one-screen summary dashboard. On Day 1 you usually see `data confidence: insufficient`, which is expected. After a week of `flaker apply`, it lifts to `moderate` naturally.

---

## Day 2-3: Keep applying

Because `flaker apply` is idempotent, "run it once a day" is the whole Day 2 story. You do not have to call `collect` or `calibrate` manually.

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker apply
pnpm flaker status                 # daily dashboard
pnpm flaker status --detail        # KPI view (formerly analyze kpi)
```

<details><summary>Drilling down into the individual steps</summary>

`flaker apply` internally invokes the commands below on demand. They remain callable directly if you want to inspect one stage in isolation, but in 0.7.0+ all of them are deprecated or hidden — `flaker apply` is canonical.

**Collect CI history:**

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 30
```

**Calibrate:**

```bash
pnpm flaker collect calibrate
```

This writes the recommended strategy and sampling percentage into `[sampling]` in `flaker.toml`. Add `--dry-run` if you want to preview without writing.

If data is still thin (`commits < 20`), you may get `confidence: insufficient` or `low`. That is acceptable at this stage; `flaker apply` will recalibrate itself as history grows over the next week.

</details>

---

## Day 3: Add package.json scripts

Apply-first script layout for 0.7.0+:

```jsonc
{
  "scripts": {
    "flaker": "flaker",
    "flaker:plan": "flaker plan",
    "flaker:apply": "flaker apply",
    "flaker:status": "flaker status",
    "flaker:run:iteration": "flaker run --gate iteration",
    "flaker:run:release": "flaker run --gate release",
    "flaker:eval": "flaker status --markdown",
    "flaker:doctor": "flaker doctor"
  }
}
```

`pnpm flaker:run:iteration` works well from a pre-push hook via lefthook or husky. `pnpm flaker:apply` is a good target for a daily cron / launchd job.

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

- name: Post status as PR comment
  if: github.event_name == 'pull_request'
  run: |
    pnpm flaker status --markdown > .artifacts/status.md
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
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm flaker apply
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: pnpm flaker status --markdown > .artifacts/flaker-status.md
      - uses: actions/upload-artifact@v6
        with:
          name: flaker-nightly
          path: .artifacts/
```

Every night, `flaker apply` converges state and `flaker status --markdown` emits a weekly review artifact.

---

## Week 1: Observe and tune

Spend five minutes each morning on:

```bash
pnpm flaker status                 # one-screen summary
pnpm flaker status --list flaky    # top flaky tests
pnpm flaker explain insights       # AI commentary on CI vs local drift
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

Switch the merge gate from advisory to required when `pnpm flaker status` shows `ready` in its drift section. If you want the detailed actual values, use `pnpm flaker status --gate merge --detail`. The rough targets:

| Metric | Target |
|---|---|
| Matched commits | >= 20 |
| Recall (CI failures caught) | >= 90% |
| False negative rate | <= 5% |
| Pass correlation | >= 95% |
| Holdout FNR (if enabled) | <= 10% |
| Co-failure data | `ready` |
| Data confidence | `moderate` or `high` |

At that point, remove `continue-on-error: true` from the CI job.

### Re-run calibration as data grows

As long as you run `flaker apply` regularly, calibration re-runs itself when the data warrants it. If you want to confirm explicitly:

```bash
pnpm flaker apply
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
| `flaker apply` returns 0 runs | Missing or under-scoped `GITHUB_TOKEN`, often without `actions:read`. |
| `flaker status` shows `data confidence: insufficient` | Fewer than 5 commits of history. Keep running `flaker apply`; usually resolves within a week. |
| Parallel tests time out | DuckDB is single-writer. Serialize processes using the same `.flaker/data.duckdb`. |
| `dist/moonbit/flaker.js` is missing | It should already be bundled by the npm package. If not, inspect the package build. |

---

## The ideal shape after one month

- `flaker run --gate merge` is a required PR check
- nightly `flaker apply` keeps history fresh every day
- weekly reports (`flaker status --markdown`) are posted to Slack or issues
- developers use `pnpm flaker:run:iteration` locally
- flaky tests are auto-quarantined via `[quarantine].auto = true` + `flaker apply`

At that point, many repositories can cut CI time by 30-70% while keeping missed failures under 5%.

---

## References

- [README.md](../README.md) — project overview
- [usage-guide.md](usage-guide.md) — user-facing entrypoint
- [operations-guide.md](operations-guide.md) — operator-facing entrypoint
- [how-to-use.md](how-to-use.md) — detailed commands and configuration
- [migration-0.6-to-0.7.md](migration-0.6-to-0.7.md) — upgrading from 0.6.x
- [contributing.md](contributing.md) — development and dogfood workflow
- [CHANGELOG.md](../CHANGELOG.md) — release history and breaking changes
