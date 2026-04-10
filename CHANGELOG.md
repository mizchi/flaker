# Changelog

## 0.2.0 — 2026-04-10

### Breaking changes

This release restructures the CLI into a two-level category hierarchy, merges `sample` into `run --dry-run`, and renames config keys to follow a suffix-per-unit convention. There is no backward compatibility layer. Configs and scripts must be updated before upgrading.

See the [redesign spec](docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md) for the full rationale and the [config migration section](docs/how-to-use.md#config-migration) for the `flaker.toml` rename map.

#### Removed commands

- `flaker sample` — use `flaker run --dry-run` (add `--explain` for selection reasons).

#### Renamed commands

| Old | New |
|---|---|
| `flaker collect` | `flaker collect ci` (alias `flaker collect` preserved) |
| `flaker collect-local` | `flaker collect local` |
| `flaker collect-coverage` | `flaker collect coverage` |
| `flaker collect-commit-changes` | `flaker collect commit-changes` |
| `flaker calibrate` | `flaker collect calibrate` |
| `flaker import <file>` | `flaker import report <file>` |
| `flaker import-parquet <dir>` | `flaker import parquet <dir>` |
| `flaker affected` | `flaker exec affected` |
| `flaker report summarize` | `flaker report summary` |
| `flaker flaky` | `flaker analyze flaky` |
| `flaker reason` | `flaker analyze reason` |
| `flaker insights` | `flaker analyze insights` |
| `flaker eval` | `flaker analyze eval` |
| `flaker context` | `flaker analyze context` |
| `flaker query` | `flaker analyze query` |
| `flaker diagnose` | `flaker debug diagnose` |
| `flaker bisect` | `flaker debug bisect` |
| `flaker confirm` | `flaker debug confirm` |
| `flaker retry` | `flaker debug retry` |
| `flaker doctor` | `flaker debug doctor` |
| `flaker quarantine` | `flaker policy quarantine` |
| `flaker check` | `flaker policy check` |
| `flaker train` | `flaker dev train` |
| `flaker tune` | `flaker dev tune` |
| `flaker self-eval` | `flaker dev self-eval` |
| `flaker eval-fixture` | `flaker dev eval-fixture` |
| `flaker eval-co-failure-window` | `flaker dev eval-co-failure` |
| `flaker test-key` | `flaker dev test-key` |

Top-level aliases preserved: `flaker init`, `flaker run`, `flaker kpi`, `flaker collect`.

#### Renamed flags

- `flaker collect ci --last <days>` → `--days <n>`

#### Renamed config keys

| Section | Old | New | Unit |
|---|---|---|---|
| `[sampling]` | `percentage` | `sample_percentage` | 0–100 |
| `[sampling]` | `co_failure_days` | `co_failure_window_days` | days |
| `[sampling]` | `detected_flaky_rate` | `detected_flaky_rate_ratio` | 0.0–1.0 |
| `[sampling]` | `detected_co_failure_strength` | `detected_co_failure_strength_ratio` | 0.0–1.0 |
| `[flaky]` | `detection_threshold` | `detection_threshold_ratio` | 0.0–1.0 |
| `[quarantine]` | `flaky_rate_threshold` | `flaky_rate_threshold_percentage` | 0–100 |
| `[profile.*]` | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` | `co_failure_days` | `co_failure_window_days` | days |
| `[profile.*]` | `adaptive_fnr_low` | `adaptive_fnr_low_ratio` | 0.0–1.0 |
| `[profile.*]` | `adaptive_fnr_high` | `adaptive_fnr_high_ratio` | 0.0–1.0 |

The CLI refuses to start on legacy configs and prints migration hints pointing at [docs/how-to-use.md#config-migration](docs/how-to-use.md#config-migration).

`flaky_rate_threshold_percentage` is now taken literally as a percentage — previous silent auto-conversion from a 0–1 ratio is gone. If your old config had `flaky_rate_threshold = 0.3`, rename to `flaky_rate_threshold_percentage = 30`.

#### New `debug confirm` exit codes

| Code | Verdict | Meaning |
|---|---|---|
| 0 | TRANSIENT | Not reproducible |
| 1 | FLAKY | Intermittent |
| 2 | BROKEN | Regression reproduced |
| 3 | ERROR | Runner or config failure |

### New features

- `flaker run --dry-run` — preview selection without executing.
- `flaker run --explain` — print per-test selection tier, score, and reason.
- `flaker setup init --adapter <type> --runner <type>` — generate populated `[adapter]` and `[runner]` sections in the created `flaker.toml`. Valid adapters: `playwright`, `vitest`, `jest`, `junit`. Valid runners: `vitest`, `playwright`, `jest`, `actrun`.
- `flaker debug confirm --json` — machine-readable verdict output.
- `flaker analyze query` now has three example queries in `--help`.
- `flaker debug doctor` and `flaker policy check` validate config value ranges.
- Top-level `--help` is organized into Getting started, Daily workflow, and nine category sections.
- Vitest is configured with a 60s global timeout and a 4-worker fork cap to stabilize DuckDB + MoonBit core tests.

### Internal

- `src/cli/main.ts` shrunk from 2076 lines to ~200 lines. Category registration lives under `src/cli/categories/`.
- Every command handler lives under `src/cli/commands/<category>/<name>.ts`.
- The MoonBit parquet fixture test is now invoked automatically by the vitest global setup, removing a hidden cross-language test dependency.
