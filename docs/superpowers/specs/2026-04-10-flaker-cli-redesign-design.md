# flaker CLI Redesign — Design Spec

**Date:** 2026-04-10
**Version bump target:** `0.2.0` (breaking)
**Scope:** CLI command hierarchy, flag conventions, config unit naming, help layout, documentation refresh. No changes to MoonBit core logic, DuckDB schema, sampling algorithms, or profile auto-detection.

---

## 1. Goals

- Reshape the flat 33-command surface into a **two-level category hierarchy** plus four top-level aliases.
- Unify command naming, flag precedence, and config unit conventions so that `flaker.toml` and CLI flags stop mixing `percentage`, `ratio`, and dimensionless numbers.
- Ship as `0.2.0` with no backward-compatibility shims. Old command names, old flag names, and old config keys are removed outright. Old configs fail fast with a migration hint.
- Rewrite `README.md` and both language variants of `docs/how-to-use.md` so they match the new surface.

### Non-goals
- MoonBit core logic changes.
- DuckDB schema changes.
- Runner adapter internals.
- New sampling strategies.
- Profile auto-detection behavior.
- `flaker.affected.toml` schema (unrelated structure).
- GitHub Actions workflow behavior changes (string replacement only).

---

## 2. Command Hierarchy

### 2.1 Categories (nine)

```
flaker setup
  └── init

flaker exec
  ├── run               (旧 run, absorbs 旧 sample via --dry-run)
  └── affected

flaker collect
  ├── ci                (旧 collect)
  ├── local             (旧 collect-local)
  ├── coverage          (旧 collect-coverage)
  ├── commit-changes    (旧 collect-commit-changes)
  └── calibrate         (旧 calibrate)

flaker import
  ├── report            (旧 import <file>)
  └── parquet           (旧 import-parquet)

flaker report
  ├── summary           (旧 report summarize)
  ├── diff              (旧 report diff)
  └── aggregate         (旧 report aggregate)

flaker analyze
  ├── kpi               (旧 kpi)
  ├── flaky             (旧 flaky)
  ├── reason            (旧 reason)
  ├── insights          (旧 insights)
  ├── eval              (旧 eval)
  ├── context           (旧 context)
  └── query             (旧 query) — promoted to visible command

flaker debug
  ├── diagnose
  ├── bisect
  ├── confirm
  ├── retry
  └── doctor

flaker policy
  ├── quarantine
  └── check

flaker dev
  ├── train
  ├── tune
  ├── self-eval
  ├── eval-fixture
  ├── eval-co-failure   (旧 eval-co-failure-window)
  └── test-key
```

### 2.2 Top-level aliases

Four high-frequency commands remain callable from the top level:

| Alias | Delegates to |
|---|---|
| `flaker init` | `flaker setup init` |
| `flaker run` | `flaker exec run` |
| `flaker kpi` | `flaker analyze kpi` |
| `flaker collect` | `flaker collect ci` |

Implementation: both the category subcommand and the top-level alias are registered as concrete commands in `main.ts` that invoke the same underlying handler. Both appear in help.

### 2.3 Removed and renamed top-level commands

Nothing is deprecated-with-alias. Old names are gone outright in `0.2.0`.

- `flaker sample` — **deleted**, folded into `flaker run --dry-run`.
- All other commands keep their handlers and move under a category (see §2.1).
- Renames such as `eval-co-failure-window` → `dev eval-co-failure`, `collect` → `collect ci`, `import-parquet` → `import parquet` are covered by the hierarchy in §2.1 and produce no alias.

The full list of user-visible renames (for CHANGELOG and docs sweep) is derivable from §2.1.

---

## 3. `flaker run` (absorbs `sample`)

### 3.1 New flags

```
flaker run [options]

Options:
  --profile <name>          scheduled|ci|local (auto-detected if omitted)
  --strategy <s>            random|weighted|affected|hybrid|gbdt|full
  --count <n>               Absolute number of tests to select
  --percentage <n>          Percentage 0-100
  --changed <files>         Comma-separated changed files (auto-detected if omitted)
  --skip-quarantined        Exclude quarantined tests
  --co-failure-days <n>     Override co-failure window (days)
  --holdout-ratio <n>       Holdout fraction of skipped tests (0.0-1.0)
  --model-path <path>       Path to GBDT model JSON
  --runner <runner>         direct|actrun
  --retry                   Retry failed tests (actrun only)
  --dry-run                 Select but do not execute
  --explain                 Print selection reasons per test (tier and score)
  --json                    Machine-readable output
```

- `--dry-run` and `--explain` are independent and can be combined.
- `--json` on `--dry-run` emits the selection plan; on a real run it emits the run result. When combined with `--explain`, every selected test in the JSON output carries the `tier`, `score`, and `reason` fields described below.
- `--explain` (human output) prints a table with columns: `test`, `tier` (`affected|co_failure|previously_failed|new|weighted`), `score`, `reason`.

### 3.2 Flag precedence (documented in three places)

Printed verbatim in `flaker run --help`, `README.md` "Sampling and execution" section, and `docs/how-to-use.md` sampling section:

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

### 3.3 `exec affected` kept as low-level counterpart

| Command | Purpose |
|---|---|
| `flaker exec affected src/foo.ts` | Walk the dependency graph and list affected tests. No scoring, no DB access. |
| `flaker run --dry-run --explain --changed src/foo.ts` | Full sampling with selection reasons. |

---

## 4. Config unit conventions

### 4.1 Suffix rules

| Suffix | Unit | Range |
|---|---|---|
| `*_ratio` | fractional | `0.0` – `1.0` |
| `*_percentage` | percent (integer or real) | `0` – `100` |
| `*_days` | day count | positive integer |
| `*_seconds` | seconds | positive integer |
| `*_count` | item count | non-negative integer |

Rules:
- Every value that expresses a proportion must end in `*_ratio` or `*_percentage` — never bare.
- Do not define the same value twice in different units.
- Durations pick one of `*_days` or `*_seconds`, not both.

### 4.2 Rename map for `flaker.toml`

```toml
# --- [sampling] ---
# before
percentage = 30
holdout_ratio = 0.1
co_failure_days = 90
detected_flaky_rate = 0.005
detected_co_failure_strength = 0.5
detected_test_count = 437
# after
sample_percentage = 30
holdout_ratio = 0.1
co_failure_window_days = 90
detected_flaky_rate_ratio = 0.005
detected_co_failure_strength_ratio = 0.5
detected_test_count = 437

# --- [flaky] ---
# before
window_days = 14
detection_threshold = 2.0
# after
window_days = 14
detection_threshold_ratio = 0.02

# --- [quarantine] ---
# before
flaky_rate_threshold = 30.0
min_runs = 10
# after
flaky_rate_threshold_percentage = 30
min_runs = 10

# --- [profile.ci] ---
# before
percentage = 30
adaptive_fnr_low = 0.02
adaptive_fnr_high = 0.05
adaptive_min_percentage = 15
# after
sample_percentage = 30
adaptive_fnr_low_ratio = 0.02
adaptive_fnr_high_ratio = 0.05
adaptive_min_percentage = 15

# [profile.local] — no changes
```

### 4.3 Loader behavior

- `src/cli/config.ts` type definitions (`SamplingConfig`, `FlakerConfig`) are rewritten to match new keys.
- Old keys are **not** silently accepted. Encountering a legacy key produces a fatal error:

  ```
  Error: flaker.toml uses deprecated key `percentage` in [sampling].
    → rename to `sample_percentage` (value range 0-100)
    → see docs/how-to-use.md#config-migration for the full mapping
  ```

- The legacy→new mapping table lives as a constant in `src/cli/config.ts` and is rendered as a table in `docs/how-to-use.md#config-migration` (single source of truth: when adding a rename, update both).
- Unknown keys that are neither legacy nor new are tolerated by the loader itself (pass-through) and surfaced as warnings by `debug doctor` / `policy check` (see §4.4). Rationale: the loader stays narrow and predictable; lint-style checks live in dedicated commands.

### 4.4 Range validation in `debug doctor` and `policy check`

- `*_ratio` outside `[0.0, 1.0]` → error
- `*_percentage` outside `[0, 100]` → error
- `*_days` / `*_seconds` / `*_count` negative → error
- Unknown keys under known sections → warning (typo detection via a declared schema)

---

## 5. Help layout

### 5.1 Top-level `flaker --help`

```
Usage: flaker [options] [command]

Intelligent test selection — run fewer tests, catch more failures

Options:
  -V, --version
  -h, --help

Getting started:
  flaker init                       Create flaker.toml (auto-detects repo)
  flaker collect calibrate          Analyze history, write optimal sampling config
  flaker debug doctor               Check runtime requirements
  flaker run                        Select and execute tests

Daily workflow:
  flaker run                        Execute with auto-selected profile
  flaker run --dry-run --explain    Preview selection with reasons
  flaker analyze kpi                KPI dashboard (sampling, flaky, data quality)

Commands (by category):
  setup      Project scaffolding            (init)
  exec       Test selection and execution   (run, affected)
  collect    Import history and calibration (ci, local, coverage, commit-changes, calibrate)
  import     Ingest external reports        (report, parquet)
  report     Normalize and diff reports     (summary, diff, aggregate)
  analyze    Read-only inspection           (kpi, flaky, reason, insights, eval, context, query)
  debug      Active investigation           (diagnose, bisect, confirm, retry, doctor)
  policy     Enforcement and ownership      (quarantine, check)
  dev        Model training and benchmarks  (train, tune, self-eval, eval-fixture, eval-co-failure, test-key)

Run `flaker <category> --help` for the full list under each category.
Run `flaker <category> <command> --help` for per-command options.
```

### 5.2 Category help template

Every category uses the same shape:

```
Usage: flaker <category> <command> [options]

<one-line description of the category>

Commands:
  <command>    <one-line description>
  ...

Examples:
  flaker <category> <command> ...
  ...
```

### 5.3 `analyze query` help

Includes three real examples:

1. Top 10 failing tests (GROUP BY count).
2. Per-commit fail rate over last 30 days.
3. Most recent N runs.

---

## 6. Other small changes

### 6.1 `collect ci --days <n>`

Rename `--last <days>` to `--days <n>`. `--branch`, `--json`, `--output`, `--fail-on-errors` are unchanged.

### 6.2 `init --adapter <type> --runner <type>`

New optional flags.

- `--adapter <type>`: one of `playwright`, `vitest`, `jest`, `junit`. Writes `[adapter] type = "<type>"`. Unknown values are rejected with a message listing valid options.
- `--runner <type>`: one of `vitest`, `playwright`, `jest`, `actrun`. Writes `[runner] type = "<type>"` plus a best-effort `command` placeholder based on the chosen runner (e.g. `pnpm exec vitest run`). Unknown values are rejected.
- When either flag is omitted, the corresponding section is left as a commented template in the generated `flaker.toml`, matching the current behavior.
- Owner/name are still auto-detected from the git remote unless `--owner` / `--name` are given.

### 6.3 `debug confirm` — exit codes and JSON

Help text gains the following block:

```
Exit codes:
  0  TRANSIENT  Not reproducible (no further action)
  1  FLAKY      Intermittent (pass and fail both observed)
  2  BROKEN     Regression reproduced (fix required)
  3  ERROR      Runner or config failure

With --json, prints:
  {"verdict": "BROKEN|FLAKY|TRANSIENT", "runs": [...]}
```

### 6.4 `analyze query` promotion

Already covered in §2.1 and §5.3. The point is help visibility: the command exists today but is buried in the flat list; in the new layout it sits in `analyze` with examples.

### 6.5 `debug doctor` in Getting started

Listed as step 3 of Getting started (§5.1).

### 6.6 Sibling dogfood docs moved out of README

The `scripts/dev-cli.mjs` instructions move from `README.md` to a new `docs/contributing.md`.

---

## 7. Source reorganization

### 7.1 `src/cli/commands/` layout

```
setup/
  init.ts
exec/
  run.ts                       # merged from old run.ts + sample.ts
  affected.ts
  sampling-options.ts          # internal shared helper
collect/
  ci.ts
  local.ts
  coverage.ts
  commit-changes.ts
  calibrate.ts
import/
  report.ts
  parquet.ts
report/
  index.ts                     # summary / diff / aggregate subcommands
analyze/
  kpi.ts
  flaky.ts
  reason.ts
  insights.ts
  eval.ts
  context.ts
  query.ts
debug/
  diagnose.ts
  bisect.ts
  confirm.ts
  confirm-local.ts             # internal, kept
  confirm-remote.ts            # internal, kept
  retry.ts
  doctor.ts
policy/
  quarantine.ts
  check.ts
dev/
  train.ts
  tune.ts
  self-eval.ts
  eval-fixture.ts
  eval-co-failure.ts
  test-key.ts
```

### 7.2 `main.ts` split

Current `src/cli/main.ts` is 2076 lines. Split into:

```
src/cli/main.ts               ~200 lines: createProgram() + top-level alias wiring
src/cli/categories/
  setup.ts
  exec.ts
  collect.ts
  import.ts
  report.ts
  analyze.ts
  debug.ts
  policy.ts
  dev.ts
```

Each category file exports `registerXCommands(program: Command): void` and is called in order from `main.ts`. The four top-level aliases are wired explicitly in `main.ts`.

---

## 8. Documentation updates

| File | Change |
|---|---|
| `README.md` | Rewrite all command examples. Getting started becomes 4 steps (init → collect calibrate → debug doctor → run). Remove sibling-checkout section, replace with link to `docs/contributing.md`. Add link to `docs/how-to-use.md#config-migration`. |
| `docs/how-to-use.md` | Rewrite all examples. New `#config-migration` section containing the legacy→new key table. Flag precedence block added verbatim. |
| `docs/how-to-use.ja.md` | Same as above, Japanese. |
| `docs/contributing.md` | **New.** Sibling dogfood via `scripts/dev-cli.mjs`, local build, MoonBit/TS fallback flow. |
| `docs/why-flaker.md`, `docs/why-flaker.ja.md`, `docs/introduce.ja.md`, other `docs/*.md` | Sweep for stale command names; wording-only edits. |
| `TODO.md` | Check off items this spec consumes; add any newly discovered follow-ups. |
| `flaker.toml` (repo dogfood config) | Migrate to new keys. |
| `CHANGELOG.md` | **New.** `0.2.0` entry listing every breaking change. |
| `.github/workflows/ci.yml`, `.github/workflows/nightly-self-host.yml` | String-replace old command names to new ones. Behavior unchanged. |
| `scripts/self-host-review.mjs`, `scripts/dev-cli.mjs`, `scripts/run-flaker.mjs`-equivalents | Sweep for stale command names. |

---

## 9. Tests

### 9.1 Existing tests
All command tests (vitest) follow the file moves. Paths update but assertions stay.

### 9.2 New tests

- **`tests/cli/config-migration.test.ts`** — Given a `flaker.toml` with legacy keys, the loader throws with the exact migration-pointing error message. One case per legacy key listed in §4.2.
- **`tests/cli/help-shape.test.ts`** — Runs `flaker --help`, `flaker analyze --help`, `flaker debug --help`, `flaker collect --help`, asserts each output string-contains the expected category header and command listing (not snapshot — robust to trailing whitespace).
- **`tests/cli/confirm-exit-code.test.ts`** — Drives `debug confirm` through a mocked runner returning (a) always-fail (b) sometimes-fail (c) never-fail (d) runner-error and asserts exit codes `2 / 1 / 0 / 3` respectively.

### 9.3 Smoke
After the rewrite, `pnpm build` plus `node dist/cli/main.js <category> --help` for every category must succeed.

---

## 10. Release

- `package.json` version → `0.2.0`.
- `moon.mod.json` version → `0.2.0`.
- `CHANGELOG.md` entry covers: removed commands, renamed commands, renamed flags, renamed config keys, exit code contract for `debug confirm`.
- npm publish is manual and out of scope for this spec.

---

## 11. Open questions

None at spec-write time. Decisions made:
- Command hierarchy: option A (full subcommand structure).
- `sample` vs `run`: option A (merge into `run --dry-run`).
- Analyze/debug split: option C (three groups: analyze / debug / dev).
- Config units: option A (suffix-per-unit).
- Top-level aliases: keep `init`, `run`, `kpi`, `collect`.
- Exit codes: `0=TRANSIENT, 1=FLAKY, 2=BROKEN, 3=ERROR`.
- Backward compatibility: none. `0.2.0` is a hard break.
