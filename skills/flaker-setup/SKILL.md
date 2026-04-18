---
name: flaker-setup
description: Set up @mizchi/flaker on a new repository. Use when the user asks to introduce flaker, configure flaker.toml, integrate flaker into GitHub Actions, or "start using flaker on this project". Encodes the Day 0 → Week 4 onboarding flow with the right order, decision points, and pitfalls.
---

# flaker setup skill

`@mizchi/flaker` is a test-intelligence CLI: sampling, flaky detection, CI/local correlation. Version 0.3.0+ uses a two-level category hierarchy (`flaker setup init`, `flaker exec run`, `flaker analyze kpi`, etc.) and suffix-per-unit config keys (`sample_percentage`, `detection_threshold_ratio`, ...).

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

## Decision points to confirm before touching files

Ask the user (or infer from `package.json` / `pnpm-workspace.yaml` / repo layout) — do NOT guess silently:

1. **Adapter** — `playwright | vitest | jest | junit`. Look at `package.json` `devDependencies` and existing test files. Default to vitest for TS libraries, playwright for e2e, junit for non-Node.
2. **Runner** — `vitest | playwright | jest | actrun`. Usually matches the adapter. `actrun` wraps a GitHub Actions workflow file when local execution should mirror CI exactly.
3. **Resolver** — `workspace | glob | bitflow | git`. Pick `workspace` if `pnpm-workspace.yaml` or `package.json` `workspaces` exists. Pick `glob` for legacy single-package repos (then create `flaker.affected.toml`). Pick `bitflow` only if the repo already uses bitflow.
4. **CI history availability** — does the repo already have GitHub Actions runs? If no, skip `collect ci` on Day 1 and revisit after the first PR lands.
5. **GITHUB_TOKEN scope** — `gh auth status` must show `actions:read`. If missing, the user runs `gh auth refresh -s actions:read` themselves.

## Phase order (do NOT reorder)

The order matters because each step exposes errors that would cascade if deferred.

```
Day 0  prerequisites           5 min   node>=24, pnpm>=10, gh auth, git remote
Day 1  install + init          15 min  pnpm add -D @mizchi/flaker → init → doctor → resolver
Day 1  local dry-run smoke      5 min  flaker run --gate iteration --dry-run --explain
Day 2  collect ci + calibrate  30 min  collect ci --days 30 → collect calibrate → analyze kpi
Day 3  package.json scripts     5 min  flaker:run:local, flaker:eval:markdown, etc.
Day 5  Actions integration     15 min  PR advisory job (continue-on-error: true) + nightly history
Week 1 daily observation        5/day  analyze kpi / flaky / insights
Week 2-4 promote to required    -      gate on matched ≥20, FNR ≤5%, pass corr ≥95%
```

**Never skip the `continue-on-error: true` on the first PR job.** The CI job becomes a required check ONLY after the metrics in Week 2-4 are stable. Promoting too early causes false negatives that erode developer trust.

## Day 1 commands (copy-paste ready)

```bash
# 0. prerequisites
node --version && pnpm --version && git remote -v && gh auth status

# 1. install
pnpm add -D @mizchi/flaker

# 2. init (pick adapter/runner per the decision above)
pnpm flaker init --adapter <adapter> --runner <runner>

# 3. doctor
pnpm flaker doctor

# 4. set resolver in flaker.toml — edit [affected] section manually
#    workspace: resolver = "workspace"
#    glob:      resolver = "glob",  config = "flaker.affected.toml"
#    bitflow:   resolver = "bitflow"

# 5. dry-run smoke
pnpm flaker run --gate iteration --dry-run --explain --changed "$(git diff --name-only main | tr '\n' ',')"
```

## Day 2 commands

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 30
pnpm flaker collect calibrate
pnpm flaker analyze kpi
```

If `collect ci` reports 0 runs, the most likely cause is GITHUB_TOKEN missing the `actions:read` scope or the workflow has no completed runs in the last 30 days. Tell the user to refresh the token or extend the window.

## package.json scripts to add

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

Note: `flaker collect local --last 1` keeps the legacy `--last` flag — only `flaker collect ci` was renamed to `--days`.

## GitHub Actions snippets

PR advisory (advisory mode, MUST be `continue-on-error: true` for the first 2-4 weeks):

```yaml
- name: Run tests via flaker (advisory)
  run: pnpm flaker run --gate merge
  continue-on-error: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Nightly history (separate workflow, scheduled cron):

```yaml
- run: pnpm flaker collect ci --days 1
- run: pnpm flaker run --gate release
- run: pnpm flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

## Promotion criteria for required check

Only promote `flaker run --gate merge` from advisory to required when `analyze kpi` shows ALL of:

- `Matched commits ≥ 20`
- `Recall ≥ 90%` (CI failures caught by local sampling)
- `False negative rate ≤ 5%`
- `Pass correlation ≥ 95%`
- `Co-failure ready: yes`
- `Data confidence: moderate` or `high`

If the user wants to gate sooner, push back: empirically less than 20 matched commits gives unstable readings.

## Pitfalls (encountered in real dogfood)

| Symptom | Cause | Fix |
|---|---|---|
| `flaker.toml uses deprecated keys` | Config from 0.1.x or earlier | Apply rename table from `docs/how-to-use.md#config-migration` |
| `Config file not found` | Wrong cwd | `cd` to repo root containing `flaker.toml` |
| `actrun runner requires [runner.actrun] workflow` | Missing actrun config | Add `[runner.actrun] workflow = ".github/workflows/<file>.yml"` |
| `hybrid` selects 0 tests | Resolver not configured | Set `[affected].resolver` |
| `collect ci` returns 0 runs | Token / scope / window | Refresh token, widen `--days`, check workflow exists |
| `analyze kpi` shows `insufficient data` | < 5 commits | Wait, or run more `collect ci` |
| Tests timeout in parallel | DuckDB single-writer | Serialize commands sharing the same `data.duckdb` |
| `dist/moonbit/flaker.js` missing | Custom build environment | Should not happen with npm install — investigate package.json `files:` |

## Anti-patterns

- **Do not** edit config keys to old names ("looks cleaner") — the loader hard-fails on legacy keys.
- **Do not** enable `[profile.ci] adaptive = true` until at least 30 commits of history exist. Adaptive sampling needs FNR data to converge.
- **Do not** set `holdout_ratio > 0.2` — wastes runner time.
- **Do not** skip `collect calibrate` — manual `[sampling]` settings underperform calibrated ones in 90% of cases.
- **Do not** make the PR job required before Week 2-4 metrics are met.

## Reference docs (in this plugin)

All paths relative to `${CLAUDE_PLUGIN_ROOT}` of the installed plugin, or in the [flaker repo on GitHub](https://github.com/mizchi/flaker).

- `README.md` — feature overview, install
- `docs/new-project-checklist.ja.md` / `docs/new-project-checklist.md` — the canonical full checklist (this skill is its action-oriented summary)
- `docs/usage-guide.ja.md` / `docs/usage-guide.md` — user-facing entrypoint after setup
- `docs/operations-guide.ja.md` / `docs/operations-guide.md` — maintainer / CI owner entrypoint
- `docs/how-to-use.md` / `docs/how-to-use.ja.md` — full command reference and `#config-migration` table
- `docs/contributing.md` — sibling dogfood, MoonBit/TS fallback, build internals
- `CHANGELOG.md` — version history, breaking changes per release
