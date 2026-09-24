# flaker changelog for coding agents

This file is for coding agents that have to make an existing repository work with the current flaker. Humans should read `CHANGELOG.md`. Every entry here gives the old form, the current form, and how to find the old form in a repository.

Current version: **0.14.0**. Every mapping below points directly at the current form, even when the command was renamed more than once (for example `collect calibrate` → `apply --target calibrate` → `calibrate`).

## How to use this file

1. Find the installed version: `pnpm flaker --version`, or `@mizchi/flaker` in `package.json`.
2. Search the repository with the one-shot scan below. Every hit is something to rewrite.
3. Rewrite each hit with the tables in "Rewrite map".
4. Verify with the checklist in "Verify". Do not stop at "the config loads": workflows and scripts fail only when CI runs them.

One-shot scan (run from the repository root):

```bash
grep -rnE -- '--profile|\[profile\.|FLAKER_PROFILE|flaker (ops|collect|analyze|policy|gate|quarantine|setup|exec|kpi)\b|apply --(target|emit|incident)|--cluster-mode|--model-path|cluster_mode|model_path|adaptive|\[coverage\]|strategy *= *"(random|gbdt|coverage-guided)"|dev train|debug doctor|import (report|parquet) ' \
  flaker.toml .github package.json Makefile justfile Taskfile.pkl scripts docs 2>/dev/null
```

## Errors you will see, and the fix

flaker refuses to start on an old `flaker.toml` and exits with code 2. The error names each offending key:

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  [profile.ci] was renamed to [gate.merge]
```

| Error line contains | Fix |
|---|---|
| `[profile.local] was renamed to [gate.iteration]` | Rename the section header. The keys inside stay the same (after the other fixes below). |
| `[profile.ci] was renamed to [gate.merge]` | Same. |
| `[profile.scheduled] was renamed to [gate.release]` | Same. |
| `[profile.<x>] has no gate equivalent` | A custom profile. Move its settings into one of `[gate.iteration]`, `[gate.merge]`, `[gate.release]`, or delete it. Update every `--profile <x>` caller to the chosen gate. |
| `[profile] is no longer supported` | Delete the `profile` key or table. |
| `[gate.<X>] is not a gate` | Gate section names are exact lowercase: `iteration`, `merge`, `release`. |
| `` `gate` must be a table `` / `` `gate.<name>` must be a table `` | Write `[gate.merge]` sections, not `gate = "merge"`. |
| `` `<key>` in [<section>] was removed in 0.13.0; delete this key `` | Delete the line. Applies to `cluster_mode`, `model_path`, `adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, `adaptive_step`, `adaptive_fnr_low`, `adaptive_fnr_high`. |
| `[coverage] was removed in 0.13.0; delete this section` | Delete the whole `[coverage]` table. |
| `strategy "<s>" in [<section>] was removed in 0.13.0` | `random` → `weighted`. `gbdt` → `hybrid` if `[affected].resolver` is set, else `weighted`. `coverage-guided` → `affected` or `hybrid`. |
| `fallback_strategy "<s>" in [<section>] was removed in 0.13.0` | Same mapping as `strategy`. |
| `deprecated key \`<old>\` in [<section>] → rename to \`<new>\`` | A pre-0.2.0 key name. Rename as the message says (full table in `docs/how-to-use.md#config-migration`). |
| `FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0 (<p> → <g>)` | Replace the env var in CI and scripts. It errors even when `--gate` is also passed, so delete it; do not leave both. |
| `Unknown gate '<x>'. Expected one of: iteration, merge, release.` | Wrong `--gate` or `FLAKER_GATE` value. `local`/`ci`/`scheduled` are the old profile names: use `iteration`/`merge`/`release`. |
| `Unknown sampling strategy: <s>` | `--strategy` on the command line; same mapping as the config `strategy` row. |
| `error: unknown option '--profile'` (exit 1) | `run --profile local|ci|scheduled` → `run --gate iteration|merge|release`. |
| `error: unknown option '--target'` / `'--emit'` / `'--incident-…'` | See "Commands" below: `apply` only reconciles now. |
| `error: unknown command 'ops'` (or `collect`, `analyze`, `policy`, `gate`, …) | See "Commands" below. |
| `error: --ci does not take a file` | `import --ci` collects from GitHub Actions; drop the file argument or drop `--ci`. |
| `error: --days and --branch-filter require --ci` | Add `--ci`, or remove the flags for a file import. |

Removed flags and commands do not name their replacement: commander prints its generic `unknown option` / `unknown command` message. Use the tables below.

## Rewrite map

### Config (`flaker.toml`)

| Old | Current |
|---|---|
| `[profile.local]` | `[gate.iteration]` |
| `[profile.ci]` | `[gate.merge]` |
| `[profile.scheduled]` | `[gate.release]` |
| `adaptive = true` and the other `adaptive*` keys | delete; schedule `flaker calibrate` instead |
| `cluster_mode = …`, `model_path = …` | delete |
| `[coverage]` | delete the section |
| `strategy = "random"` | `strategy = "weighted"` |
| `strategy = "gbdt"` | `strategy = "hybrid"` (needs `[affected].resolver`) or `"weighted"` |
| `strategy = "coverage-guided"` | `strategy = "affected"` or `"hybrid"` |
| `percentage` (pre-0.2.0, in `[sampling]` and in `[profile.*]`/`[gate.*]`) | `sample_percentage`, same value |
| `co_failure_days` (pre-0.2.0, same sections) | `co_failure_window_days`, same value |
| `[sampling] detected_flaky_rate`, `detected_co_failure_strength` (pre-0.2.0) | `detected_flaky_rate_ratio`, `detected_co_failure_strength_ratio`, same value |
| `[flaky] detection_threshold` (pre-0.2.0) | `detection_threshold_ratio`, same value |
| `[quarantine] flaky_rate_threshold` (pre-0.2.0) | `flaky_rate_threshold_percentage`, **and convert the value**: the old key treated `0.3` as 30%, the new key is a literal percentage, so `0.3` → `30` (a value already above 1, such as `30`, stays `30`) |

Only `flaky_rate_threshold` changes its value; every other rename keeps the number as it is. `co_failure_window_days` is valid in a `[gate.*]` section, but a pure `affected` gate does not use it (it only ranks `weighted`/`hybrid` selections), so keeping it after a rename is harmless.

Keys inside a renamed section follow the same renames: `[profile.ci]` with `percentage = 30` becomes `[gate.merge]` with `sample_percentage = 30`. The loader reports a section rename before the keys inside it, so after renaming sections run `flaker doctor` again until it is clean.

Unchanged: `[sampling]`, `holdout_ratio`, `fallback_strategy` (with a valid strategy), `max_duration_seconds`, `skip_quarantined`, `skip_flaky_tagged`, `[promotion]`, `[quarantine]`, `[affected]`, `[runner]`, `[adapter]`.

### Environment

| Old | Current |
|---|---|
| `FLAKER_PROFILE=local` / `ci` / `scheduled` | `FLAKER_GATE=iteration` / `merge` / `release` |

With neither `--gate` nor `FLAKER_GATE`, `run` picks `merge` when `CI=true` or `GITHUB_ACTIONS=true`, otherwise `iteration`. A blank `FLAKER_GATE` counts as unset.

### Commands

| Old | Current |
|---|---|
| `flaker run --profile local` / `ci` / `scheduled` | `flaker run --gate iteration` / `merge` / `release` |
| `flaker run --strategy random` / `gbdt` / `coverage-guided` | `--strategy weighted` / `hybrid` / `affected` |
| `flaker run --cluster-mode …`, `--model-path …` | delete the flag |
| `flaker apply --target collect_ci`, `flaker collect`, `collect ci`, `collect --days N` | `flaker import --ci --days N` (needs `GITHUB_TOKEN`; default 30 days) |
| `flaker apply --target calibrate`, `collect calibrate` | `flaker calibrate` (`--dry-run`, `--json`, `--window-days <n>`) |
| `flaker apply --target cold_start_run` / `quarantine_apply` | `flaker apply` (the planner decides; there is no partial run) |
| `flaker apply --emit daily`, `flaker ops daily` | `flaker apply && flaker status` |
| `flaker apply --emit weekly`, `flaker ops weekly [--output X]` | `flaker status --markdown > X` and `flaker explain insights` |
| `flaker apply --emit incident --incident-*`, `flaker ops incident …` | `flaker debug retry [--run <id>]`, `flaker debug confirm "<suite>:<test>" --repeat <n>`, `flaker debug diagnose --suite <s> --test <t>` |
| `flaker gate review/history/explain <name>` | `flaker status --gate <name> [--detail] [--json]` |
| `flaker analyze kpi`, `flaker kpi` | `flaker status` |
| `flaker analyze eval` | `flaker status --markdown` |
| `flaker analyze flaky` | `flaker status --list flaky` |
| `flaker analyze flaky-tag` | no replacement; review `flaker status --list flaky` by hand |
| `flaker analyze reason/insights/cluster/bundle/context` | `flaker explain <same topic>` |
| `flaker analyze query <sql>` | `flaker query <sql>` |
| `flaker quarantine suggest/apply`, `flaker policy quarantine/check/report` | `[quarantine] auto = true` + `flaker apply`; list with `flaker status --list quarantined` |
| `flaker import report <file>`, `flaker import parquet <dir>` | `flaker import <file>` / `flaker import <dir> --adapter parquet` |
| `flaker report summary/diff/aggregate` | `flaker report <file> --summary` / `--diff <base>` / `--aggregate <dir>` |
| `flaker setup init` | `flaker init` |
| `flaker exec run` | `flaker run` |
| `flaker exec affected` | `flaker run --gate iteration --changed <paths>` |
| `flaker debug doctor` | `flaker doctor` |
| `flaker dev train` | removed; the `gbdt` strategy is gone |

`flaker dev …` still runs but is hidden from `--help`. It is maintainer tooling; do not put it in user CI.

## 0.14.0 → unreleased

Nothing breaks. New: `flaker calibrate --mutate <n>` (synthetic selector evaluation in a temporary worktree; mutation misses only tighten; needs `TYPESAFE_API_KEY` for jev and a `[runner]` that runs the full suite), and `flaker prune --older-than <days> [--dry-run] [--json]`, the supported retention step. Replace any hand-written cleanup (`DELETE FROM test_results …`, `VACUUM`, a DuckDB CLI step against `[storage].path`) with it; find them with `grep -rnE "VACUUM|DELETE FROM" .github package.json scripts Taskfile.pkl justfile Makefile 2>/dev/null`. It deletes runs with their results and collected artifacts, selector records with their verdicts, sampling runs, commit changes no kept run names, and gate calibrations other than each selector's latest, then checkpoints. It keeps quarantine and coverage. `<days>` below `max(90, [sampling].co_failure_window_days) + [flaky].window_days` (104 by default) exits 2. Run it where no other flaker command holds the database, for example in the scheduled job that already owns it.

## 0.13.x → 0.14.0

No config key or command was removed or renamed. Two changes can still break a script:

- `flaker query` opens the database read-only, accepts one statement (a trailing `;` is fine), and cannot read files. A script that runs `INSERT`/`UPDATE`/`DELETE`/`CREATE` through it, chains statements with `;`, or reads `FROM 'x.csv'` / `read_parquet(...)` now fails. Find them with `grep -rnE "flaker query" .github package.json scripts Taskfile.pkl justfile Makefile 2>/dev/null` and read each query. Reads of `flaker_v1.*` or the tables keep working. For data to hand to another tool, use `flaker export <dataset>`. A cleanup step such as `flaker query "DELETE … ; VACUUM"` becomes `flaker prune --older-than <days>` (added after 0.14.0, see the next section). On 0.14.0 itself, which has no retention command, such a step has to move to the DuckDB CLI, run against the file at `[storage].path` while no flaker command is using it; the storage tables it touches are internal and may change in any release.
- The per-run Parquet files that `flaker collect` and local runs write (`test_results_<run>.parquet`) gained a `title_path` column, and flaker 0.13 cannot import them. Upgrade every job that runs `flaker import --adapter parquet` together with the job that writes them.

New and optional: `[selector]`, `flaker import --adapter selector-record|jev`, `flaker calibrate --selector`, `flaker export`, and the `flaker_v1` datasets. `[selector]` must not contain `cutoff`, `unsure_below` or `unsure_margin`; the loader exits 2 with `flaker.toml sets values that belong in the database`. See `docs/jev-test-filter-integration.md`.

## Behaviour changes that do not raise an error

These pass silently, so check them explicitly when a repository depends on them.

- `flaker calibrate` now recommends `hybrid` when `[affected].resolver` is set and `weighted` otherwise. It never recommends `random` (small suites) or `gbdt` any more.
- `flaker apply --json` and `--output` list `executed` in plan order, also for `--plan-file`. The ApplyArtifact JSON no longer has an `emitted` field.
- `flaker explain context --json` no longer lists `random`, `coverage-guided` or `gbdt` strategies and no longer has `environment.gbdtModelAvailable`.
- Config migration errors exit with code **2** (usage error), not 1. A CI step that treated exit 1 specially needs updating.
- `--gate` on the command line is case-insensitive (`--gate Merge` works); config section names are not (`[gate.Merge]` is an error).
- The automatic `@flaky` tag triage that ran inside `ops weekly` is gone with no replacement.

## Verify

Run all of these after a migration. Report any that you could not run.

1. `pnpm flaker doctor`: config loads, ranges valid.
2. `pnpm flaker plan`: prints a plan without errors.
3. `pnpm flaker run --gate merge --dry-run`: the selection path works with the migrated `[gate.merge]`. With no changed files (a clean tree, or outside a git checkout) `hybrid` samples by weight and `affected` selects nothing and uses `fallback_strategy`; add `--changed <file>` to exercise the affected path itself.
4. The one-shot scan from the top returns only intentional hits (for example this file, or a CHANGELOG).
5. For each workflow step that runs flaker, run the same command locally with `--help` to confirm every flag exists (`pnpm flaker <cmd> --help`).

## Older releases (summary)

- **0.10.0**: removed `ops daily` (it became `apply --emit daily`, itself removed in 0.13.0).
- **0.8.0**: removed the 17 legacy commands deprecated in 0.7.0 (`setup`, `exec`, `collect`, `quarantine`, `policy`, `gate`, `analyze`, `kpi`, `import report|parquet`, `report summary|diff|aggregate`, `debug doctor`). Their current forms are in the Commands table above.
- **0.2.0**: config keys gained unit suffixes (`*_ratio`, `*_percentage`, `*_days`); the loader rejects the old names.
