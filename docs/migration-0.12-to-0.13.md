# Migrating from flaker 0.12.x to 0.13.0

[日本語版](migration-0.12-to-0.13.ja.md)

`0.13.0` is a **breaking** release. It removes the profile-based execution surface, the `ops` command group, `apply --emit` / `apply --target`, adaptive sampling, and the `random` / `gbdt` / `coverage-guided` strategies. Removed config keys, sections and env vars are hard errors that name their replacement (or tell you to delete them) and point back to this page. Removed CLI flags and commands fail with commander's `unknown option` / `unknown command` error, which does not name a replacement — use the tables in this guide.

There is no compatibility shim. If your `flaker.toml`, scripts, or CI workflows use any of the old forms below, `flaker` will refuse to start until you update them.

## 1. `--profile` → `--gate`

`run --profile <name>`, `[profile.<name>]`, and `FLAKER_PROFILE` are gone. Use `--gate`, `[gate.<name>]`, and `FLAKER_GATE` instead.

| Old (0.12.x) | New (0.13.0) |
|---|---|
| `flaker run --profile local` | `flaker run --gate iteration` |
| `flaker run --profile ci` | `flaker run --gate merge` |
| `flaker run --profile scheduled` | `flaker run --gate release` |
| `[profile.local]` | `[gate.iteration]` |
| `[profile.ci]` | `[gate.merge]` |
| `[profile.scheduled]` | `[gate.release]` |
| `FLAKER_PROFILE=<p>` | `FLAKER_GATE=<gate>` |

Before/after:

```diff
-[profile.ci]
+[gate.merge]
 strategy = "hybrid"
 sample_percentage = 30
```

```diff
-flaker run --profile local --changed src/foo.ts
+flaker run --gate iteration --changed src/foo.ts
```

Notes:

- Custom profile names (e.g. `[profile.nightly]`) have **no gate equivalent**. Gates are a fixed set of three: `iteration`, `merge`, `release`. If you relied on a fourth profile, fold its settings into the closest gate or drive it entirely through CLI flags (`--strategy`, `--percentage`, `--count`, …) instead of a config section.
- `--gate` values are case-insensitive on the CLI (`--gate Merge` works), but `flaker.toml` section names must be exact lowercase — `[gate.Merge]` is a config error (see §7).
- A blank `FLAKER_GATE` (e.g. `FLAKER_GATE=`) is treated as unset and falls through to auto-detection (`merge` on CI, `iteration` otherwise). A non-blank `FLAKER_PROFILE` is a hard error **even when `--gate` is also passed** — it is not silently ignored, because a leftover `FLAKER_PROFILE` in a CI environment usually means the workflow was never updated.

## 2. Removed strategies and sampling knobs

The `random`, `gbdt`, and `coverage-guided` strategies were removed, along with `cluster_mode`, `model_path`, and the whole `[coverage]` section. `dev train` (which built the GBDT model) is gone with no replacement.

| Removed | Use instead |
|---|---|
| `strategy = "random"` | `weighted` (uniform-ish via a low weighting curve) or `full` |
| `strategy = "gbdt"`, `flaker dev train` | `weighted` or `hybrid` |
| `strategy = "coverage-guided"`, `flaker collect coverage`, `[coverage]` | `hybrid` (dependency-graph based) — see [coverage-guided-sampling.md](coverage-guided-sampling.md), kept for history |
| `[sampling].cluster_mode` / `[gate.*].cluster_mode`, `model_path` | none — delete the key |
| `fallback_strategy = "random"` / `"gbdt"` / `"coverage-guided"` | `fallback_strategy = "weighted"` |

Before/after:

```diff
-[sampling]
-strategy = "gbdt"
-cluster_mode = "spread"
-model_path = ".flaker/models/gbdt.json"
+[sampling]
+strategy = "hybrid"
```

```diff
-flaker run --dry-run --strategy random --count 20
+flaker run --dry-run --strategy weighted --count 20
```

`flaker explain cluster` (co-failure cluster **analysis**) is unaffected — it is a different feature from the removed `cluster_mode` sampling knob.

## 3. Removed adaptive sampling keys

`adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, and `adaptive_step` are all removed with no replacement key. There is no automatic percentage tuning anymore.

```diff
 [gate.merge]
 strategy = "hybrid"
 sample_percentage = 30
-adaptive = true
-adaptive_fnr_low_ratio = 0.02
-adaptive_fnr_high_ratio = 0.08
```

Instead, run `flaker calibrate` periodically (weekly is a reasonable default, or wire it into your nightly workflow). It recomputes `[sampling]` from recent history:

```bash
flaker calibrate                  # recompute and write [sampling]
flaker calibrate --dry-run        # preview only
flaker calibrate --window-days 30 --json
```

`flaker calibrate` now recommends `hybrid` whenever `[affected].resolver` is configured, and `weighted` otherwise. It no longer recommends `random` for small suites or `gbdt` for large ones — those strategies don't exist anymore.

## 4. `apply --target` → dedicated commands

`apply --target calibrate` and `apply --target collect_ci` are gone. `flaker apply` still runs the same steps internally when it detects drift, but if you called a specific target directly, use the standalone command:

| Old (0.12.x) | New (0.13.0) |
|---|---|
| `apply --target calibrate` | `flaker calibrate` |
| `apply --target collect_ci` | `flaker import --ci --days 30` |

`flaker import --ci` accepts `[--days <n>] [--branch-filter <branch>]` and needs `GITHUB_TOKEN`. (`--branch` on `flaker import <file>` keeps its unrelated, pre-existing meaning of tagging a local-file import with a branch name — it is not the same flag.)

## 5. `apply --emit`, `apply --incident-*`, and the `ops` group

The entire `ops` command group (`ops daily`, `ops weekly`, `ops incident`) and the `apply --emit` / `apply --incident-*` flags are removed. Use the replacements from the table below:

| Old (0.12.x) | New (0.13.0) |
|---|---|
| `apply --target collect_ci` | `import --ci --days 30` |
| `apply --target calibrate` | `flaker calibrate` |
| `run --profile ci` / `scheduled` / `local` | `run --gate merge` / `release` / `iteration` |
| `[profile.local]` / `[profile.ci]` / `[profile.scheduled]` | `[gate.iteration]` / `[gate.merge]` / `[gate.release]` |
| `FLAKER_PROFILE=<p>` | `FLAKER_GATE=<gate>` |
| `flaker ops weekly --output X` | `flaker status --markdown > X` plus `flaker explain insights` |
| `flaker ops incident …` | `flaker debug retry` / `debug confirm` / `debug diagnose` |
| `apply --emit daily` | `flaker apply && flaker status` |
| `adaptive = true` (and other adaptive keys) | delete; run `flaker calibrate` periodically |

Note that `ops weekly` used to also carry flaky-tag add/remove triage narrative; that sub-feature was deleted outright (not folded into `apply`), since it depended on the removed `ops` orchestration. Use `flaker status --list flaky` to find candidates and tag them by hand.

`flaker apply --json` and `flaker apply --output <file>` are unchanged in shape, except that the top-level `emitted` field is gone from `ApplyArtifact` JSON (it only ever reflected the now-removed `--emit` flag). A `--plan-file` apply now reports `executed` in plan order, same as a normal apply — this was already true before 0.13.0 and is unrelated to the `ops`/`--emit` removal, but is called out here because it affects the same JSON shape.

## 6. `dev` is hidden

`flaker dev <subcommand>` no longer appears in `flaker --help` or `flaker dev --help`'s parent listing context, but every subcommand still runs when invoked directly (e.g. `flaker dev tune`, `flaker dev eval-co-failure`). The only subcommand actually **removed** is `dev train` (see §2) — it depended on the deleted GBDT strategy.

## 7. Removed config keys and env vars are hard errors that name their replacement

`flaker.toml` is validated before anything else runs. A config using a removed or renamed key fails immediately, in the terminal, with the offending key and (when there is one) its replacement. For example, running `flaker run` against a `flaker.toml` containing:

```toml
[repo]
owner = "example"
name = "demo"

[profile.ci]
strategy = "weighted"
```

produces:

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  [profile.ci] was renamed to [gate.merge]
```

A config with a removed key inside an otherwise-valid gate section:

```toml
[gate.merge]
strategy = "weighted"
cluster_mode = "spread"
```

produces:

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  `cluster_mode` in [gate.merge] was removed in 0.13.0; delete this key
```

And a gate section with the wrong case (config sections must be exact lowercase, unlike the `--gate` CLI flag):

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  [gate.Merge] is not a gate; use one of iteration, merge, release
```

And setting a non-blank `FLAKER_PROFILE` (even alongside a valid `--gate` flag):

```
Error: FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0 (ci → merge). See docs/migration-0.12-to-0.13.md.
```

Each of these prints the message once to stderr, with no stack trace, and exits with code 2.

Removed CLI flags and commands are different: they are rejected by the argument parser before flaker's own validation runs, so the error does not name a replacement. For example, `flaker run --profile ci` prints `error: unknown option '--profile'` and `flaker ops weekly` prints `error: unknown command 'ops'` (each followed by the command's help, exit code 1). Use the tables in §1–§5 to find the replacement.

`fallback_strategy` and `holdout_ratio` are both kept as-is; only the removed strategy *values* (`random` / `gbdt` / `coverage-guided`) are rejected when used as `fallback_strategy`.

## Other surface changes worth knowing about

- `flaker explain context --json` no longer lists the `random` / `coverage-guided` / `gbdt` strategies in its `strategies` map, and drops `environment.gbdtModelAvailable`.
- `[gate]`, `[gate.<name>]`, and `[profile]` must be TOML tables; a non-table value (e.g. `gate = "merge"`) is a config error.

## Upgrade recipe

```bash
pnpm up @mizchi/flaker@0.13

# 1. Rename profile sections to gates in flaker.toml
#    [profile.local] -> [gate.iteration]
#    [profile.ci]     -> [gate.merge]
#    [profile.scheduled] -> [gate.release]

# 2. Delete removed keys: adaptive*, cluster_mode, model_path, [coverage]
# 3. Change any removed strategy value (random/gbdt/coverage-guided) to weighted/affected/hybrid/full

# 4. Update scripts and CI workflows
#    run --profile <x>        -> run --gate <mapped-name>
#    FLAKER_PROFILE=<x>       -> FLAKER_GATE=<mapped-name>
#    apply --target calibrate -> flaker calibrate
#    apply --target collect_ci -> flaker import --ci --days 30
#    ops weekly --output X    -> flaker status --markdown > X (+ flaker explain insights)
#    ops incident ...         -> flaker debug retry / confirm / diagnose
#    apply --emit daily       -> flaker apply && flaker status

# 5. Verify
flaker doctor
flaker run --dry-run --gate iteration --explain
flaker status
```

## Grep checklist

Run this in your repository root before upgrading:

```bash
grep -rnE -- '--profile|\[profile\.|FLAKER_PROFILE|flaker (ops|collect|analyze|policy|gate|quarantine|setup|exec|kpi)\b|apply --(target|emit|incident)|--cluster-mode|--model-path|cluster_mode|model_path|adaptive|\[coverage\]|strategy *= *"(random|gbdt|coverage-guided)"|dev train|debug doctor|import (report|parquet) ' \
  flaker.toml .github package.json Makefile justfile Taskfile.pkl scripts docs 2>/dev/null
```

Every match is a script, workflow, or config that needs updating per the tables above. This also catches forms removed before 0.13.0 (`flaker collect`, `analyze`, `policy`, `gate`, …); their current replacements are in [docs/agent-changelog.md](agent-changelog.md).

## Related reading

- [docs/how-to-use.md#config-migration](how-to-use.md#config-migration) — full config key rename reference, including 0.13.0's renames
- [README.md](../README.md) — canonical command forms
- [CHANGELOG.md](../CHANGELOG.md) — full 0.13.0 release notes
