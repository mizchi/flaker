---
name: flaker-setup
description: Set up @mizchi/flaker on a new repository. Use when the user asks to introduce flaker, configure flaker.toml, integrate flaker into GitHub Actions, or "start using flaker on this project". Encodes the declarative apply-based onboarding flow for @mizchi/flaker 0.7.0+ (declarative apply model).
---

# flaker setup skill

`@mizchi/flaker` (0.7.0+) is a test-intelligence CLI with a declarative apply model: `flaker.toml` describes the desired state, and `flaker apply` reconciles the repo to that state by running `collect` / `calibrate` / `cold-start run` / `quarantine apply` in the right order based on current DB state and repo probe. Callers do not memorize the sequence.

**Always read the canonical checklist first.** It lives next to this skill in the plugin:

- Plugin-relative: `${CLAUDE_PLUGIN_ROOT}/docs/new-project-checklist.ja.md` or `${CLAUDE_PLUGIN_ROOT}/docs/new-project-checklist.md`
- GitHub: <https://github.com/mizchi/flaker/blob/main/docs/new-project-checklist.ja.md> or <https://github.com/mizchi/flaker/blob/main/docs/new-project-checklist.md>

If both are unreachable, fall back to the procedure below.

## When this skill applies

- "新しいプロジェクトに flaker を入れたい"
- "flaker.toml を作って"
- "GitHub Actions に flaker を組み込んで"
- "this project should use flaker"
- "flaker のセットアップ手順を教えて"

## Mental model: desired state + reconciler

1. User writes `flaker.toml` (gates, profiles, `[promotion]` thresholds, `[quarantine].auto`).
2. `flaker plan` shows what `apply` would do right now.
3. `flaker apply` executes the plan (idempotent; safe to re-run).
4. `flaker status` shows drift vs `[promotion]` thresholds.

The Day 1 flow is `flaker init → flaker doctor → flaker apply → flaker status`. The deprecated imperative chain (`init → collect → calibrate → run`) still works via compat shims but is a migration-only concern — do not use it in new projects.

### Minimal declarative `flaker.toml`

```toml
[repo]
owner = "your-org"
name = "your-repo"

[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
flaky_tag_pattern = "@flaky"

[affected]
resolver = "workspace"

[quarantine]
auto = false              # Day 1 recommended: keep false until history accumulates;
                          # flip to true in Week 1-2 once `flaker status` drift shows moderate+ confidence.
flaky_rate_threshold_percentage = 30
min_runs = 10

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
skip_flaky_tagged = true

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true
skip_flaky_tagged = true

[profile.scheduled]
strategy = "full"

# [promotion] is OPTIONAL — defaults (matched_commits_min=20, FNR<=5%, correlation>=95%,
# holdout_fnr<=10%, data_confidence_min="moderate") apply when omitted.
# Override only with explicit justification. Example:
# [promotion]
# matched_commits_min = 30
# data_confidence_min = "high"
```

`flaker init` generates a starter toml including `[profile.*]` defaults; expect to edit `[affected].resolver` before the first `flaker apply`.

## Decision points to confirm before touching files

Ask the user (or infer from `package.json` / `pnpm-workspace.yaml` / repo layout) — do NOT guess silently:

1. **Adapter** — `playwright | vitest | jest | junit`. Look at `package.json` `devDependencies` and existing test files. Default to vitest for TS libraries, playwright for e2e, junit for non-Node.
2. **Runner** — `vitest | playwright | jest | actrun`. Usually matches the adapter. `actrun` wraps a GitHub Actions workflow file when local execution should mirror CI exactly.
3. **Resolver** — `workspace | glob | bitflow | git`. Pick `workspace` if `pnpm-workspace.yaml` or `package.json` `workspaces` exists. Pick `glob` for legacy single-package repos (then create `flaker.affected.toml`). Pick `bitflow` only if the repo already uses bitflow.
4. **CI history availability** — does the repo already have GitHub Actions runs? Either way, `flaker apply` handles it: with no history it skips calibrate and runs a cold-start gate; with history it pulls + calibrates + applies quarantine.
5. **GITHUB_TOKEN scope** — `gh auth status` must show `actions:read`. If missing, the user runs `gh auth refresh -s actions:read` themselves.

## Phase order

```
Day 0   prerequisites           5 min   node>=24, pnpm>=10, gh auth, git remote
Day 1   install + init          10 min  pnpm add -D @mizchi/flaker → init → doctor
Day 1   first apply              5 min   flaker plan → flaker apply → flaker status
Day 3   package.json scripts     5 min   flaker:plan, flaker:apply, flaker:status, flaker:run:*
Day 5   Actions integration     15 min   cron `flaker apply` + PR advisory `flaker run --gate merge`
Week 1  daily observation        -      flaker status (drift → promotion-ready signal)
Week 2-4 promote to required     -      drift == ready, remove continue-on-error
```

Day 2 and Day 4 are intentionally empty — apply is idempotent, so there is no forced action between the Day 1 bootstrap and the Day 3 / Day 5 integration steps. Run `flaker apply` whenever you want (manually or in cron); skip days if nothing changed.

**Never skip the `continue-on-error: true` on the first PR job.** The CI job becomes a required check ONLY after `flaker status` drift reports `ready` (all 5 `[promotion]` thresholds met). Promoting too early causes false negatives that erode developer trust.

## Day 1 commands (copy-paste ready)

```bash
# 0. prerequisites
node --version && pnpm --version && git remote -v && gh auth status

# 1. install
pnpm add -D @mizchi/flaker

# 2. init (init now writes [profile.*] defaults)
pnpm flaker init --adapter <adapter> --runner <runner>

# 3. doctor
pnpm flaker doctor

# 4. edit [affected].resolver in flaker.toml (workspace | glob | bitflow)

# 5. preview + converge
export GITHUB_TOKEN=$(gh auth token)   # optional if no CI history yet
pnpm flaker plan
pnpm flaker apply
pnpm flaker status
```

## What `flaker apply` does

The planner produces a `PlannedAction[]` based on current state:

| Action | Condition |
|---|---|
| `collect_ci --days 30` | `GITHUB_TOKEN` present. Pulls new CI runs. |
| `calibrate` | `data.confidence` is `moderate` or `high`. Tunes `[sampling]`. |
| `cold_start_run` (iteration gate) | No local history yet. Seeds the first local sample. |
| `quarantine_apply` | `[quarantine].auto = true` AND history is usable. Applies the current quarantine plan. |

When actions don't apply (e.g. no `GITHUB_TOKEN` on a brand-new repo), apply silently skips them. It is safe to run anywhere in the lifecycle.

## package.json scripts to add

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

## GitHub Actions snippets

PR advisory (MUST be `continue-on-error: true` for the first 2-4 weeks):

```yaml
- name: Run tests via flaker (advisory)
  run: pnpm flaker run --gate merge
  continue-on-error: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Nightly apply (single scheduled cron replaces the old collect + run pair):

```yaml
- run: pnpm flaker apply
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
- run: pnpm flaker status --markdown > .artifacts/flaker-status.md
```

## Promotion criteria for required check

Only promote `flaker run --gate merge` from advisory to required when `flaker status` drift shows `ready` (all 5 `[promotion]` thresholds met), or equivalently when `flaker status --gate merge --detail --json` reports:

- `Matched commits ≥ 20`
- `False negative rate ≤ 5%`
- `Pass correlation ≥ 95%`
- `Holdout FNR ≤ 10%`
- `Data confidence: moderate` or `high`

The thresholds live in `[promotion]` of `flaker.toml`; defaults match the above. Override in config if the project needs stricter or looser gating.

The simplest readout is `flaker status` — the drift section shows `ready` or lists unmet thresholds.

If the user wants to gate sooner, push back: empirically less than 20 matched commits gives unstable readings.

## Pitfalls (encountered in real dogfood)

| Symptom | Cause | Fix |
|---|---|---|
| `flaker.toml uses deprecated keys` | Config from 0.1.x or earlier | Apply rename table from `docs/how-to-use.md#config-migration` |
| `Config file not found` | Wrong cwd | `cd` to repo root containing `flaker.toml` |
| `flaker apply` aborts with `GITHUB_TOKEN` missing | Planner included `collect_ci` but env var absent | `export GITHUB_TOKEN=$(gh auth token)` and re-run |
| `actrun runner requires [runner.actrun] workflow` | Missing actrun config | Add `[runner.actrun] workflow = ".github/workflows/<file>.yml"` |
| `hybrid` selects 0 tests | Resolver not configured | Set `[affected].resolver` |
| `flaker apply` stops after `collect_ci` | Calibrate or cold-start failed | Inspect the `ok/fail` lines; fix and re-run apply (idempotent) |
| `flaker status` drift: `data_confidence` unmet | < ~10 matched commits | Wait, or run more `flaker apply` after CI accumulates |
| Tests timeout in parallel | DuckDB single-writer | Serialize commands sharing the same `data.duckdb` |
| `dist/moonbit/flaker.js` missing | Custom build environment | Should not happen with npm install — investigate package.json `files:` |

## Anti-patterns

- **Do not** edit config keys to old names ("looks cleaner") — the loader hard-fails on legacy keys.
- **Do not** enable `[profile.ci] adaptive = true` until at least 30 commits of history exist. Adaptive sampling needs FNR data to converge.
- **Do not** set `holdout_ratio > 0.2` — wastes runner time.
- **Do not** skip `flaker apply` and hand-tune `[sampling]` — the calibrated values outperform manual settings in 90% of cases.
- **Do not** make the PR job required before `flaker status` drift reports `ready`.
- **Do not** use deprecated aliases in new scripts — `setup init`, `exec run`, `collect ci`, `collect calibrate`, `analyze kpi`, `analyze eval`, `debug doctor`, `quarantine suggest/apply`, `policy quarantine/check/report`, `gate review/history/explain` all print deprecation warnings in 0.7.0 and will be removed in 0.8.0. Use the primary commands: `flaker init`, `flaker run`, `flaker apply`, `flaker status`, `flaker doctor`, `flaker explain`, `flaker query`, etc.

## Reference docs (in this plugin)

All paths relative to `${CLAUDE_PLUGIN_ROOT}` of the installed plugin, or in the [flaker repo on GitHub](https://github.com/mizchi/flaker).

- `README.md` — feature overview, install, Quick Start (Path 1 / Path 2), canonical command forms table
- `docs/new-project-checklist.ja.md` / `docs/new-project-checklist.md` — the canonical full checklist (this skill is its action-oriented summary)
- `docs/usage-guide.ja.md` / `docs/usage-guide.md` — user-facing entrypoint after setup
- `docs/operations-guide.ja.md` / `docs/operations-guide.md` — maintainer / CI owner entrypoint
- `docs/how-to-use.md` / `docs/how-to-use.ja.md` — full command reference including the `flaker plan` / `flaker apply` chapter and `#config-migration` table
- `docs/contributing.md` — sibling dogfood, MoonBit/TS fallback, build internals
- `CHANGELOG.md` — version history, breaking changes per release
