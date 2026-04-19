# Migrating from flaker 0.6.x to 0.7.0

## 1. Summary

flaker 0.7.0 reduces the primary CLI surface from 53 user-facing commands to 11. This change was motivated by empirical testing that showed both AI-assisted and human callers converged on the same ten to eleven verbs when completing real tasks. The long tail of subcommands — collected organically over the 0.3.x–0.6.x development cycle — created discoverability overhead without adding expressiveness; the new surface covers every workflow the old one did, often with fewer keystrokes.

For existing users this means **nothing breaks in 0.7.x**. Every deprecated command still dispatches normally; flaker simply prints a one-line `stderr` warning noting the canonical replacement and the version in which the old form will be removed. CI pipelines, `package.json` scripts, and cron jobs that use the old forms will continue to work without modification throughout the 0.7.x series.

The removal window follows the same minor-version convention used for the 0.5.x → 0.6.x migration: one full minor cycle of deprecation warnings, then removal in the next minor bump. Deprecated commands will be **removed in 0.8.0**. If you want to stay ahead of that cutoff, follow the [upgrade recipe](#4-upgrade-recipe) and [grep checklist](#5-grep-checklist) below.

---

## 2. New in 0.7.0

- **`flaker plan`** — shipped experimentally in 0.6.0, promoted to the primary surface in 0.7.0. Previews what `apply` would do without writing state.
- **`flaker apply`** — shipped in 0.6.0, promoted to primary. Single entry point that absorbs `collect`, `quarantine`, `policy`, and `analyze flaky-tag` workflows.
- **`flaker status`** — new flags:
  - `--markdown` — renders the evaluation report (replaces `analyze eval --markdown`)
  - `--list flaky` / `--list quarantined` — filtered test lists
  - `--gate <name>` — per-gate snapshot (replaces `gate review` / `gate history`)
  - `--detail` — verbose breakdown (replaces `gate explain`)
  - `--json` — machine-readable output
- **`flaker query <sql>`** — top-level DuckDB query shortcut (replaces `analyze query`)
- **`flaker explain <topic>`** — umbrella command for `reason`, `insights`, `cluster`, `bundle`, and `context` analysis topics
- **`flaker import <file>`** — adapter auto-detected from file extension (replaces `import report` and `import parquet`)
- **`flaker report <file>`** with flags:
  - `--summary` — replaces `report summary`
  - `--diff <base>` — replaces `report diff`
  - `--aggregate <dir>` — replaces `report aggregate`
- **`[promotion]` config section** — documented in `flaker.toml` with stable defaults
- **`[promotion].data_confidence_min`** — validated against an enum at startup; invalid values produce a clear error rather than silently using the default

---

## 3. Deprecation matrix

All commands in the left column emit a `stderr` deprecation warning in 0.7.x and will be **removed in 0.8.0**.

| Deprecated (0.7.x — stderr warning) | Canonical (0.7.0) |
|---|---|
| `flaker setup init` | `flaker init` |
| `flaker exec run` | `flaker run` |
| `flaker exec affected` | `flaker run --gate iteration --changed <paths>` |
| `flaker collect` / `flaker collect ci` | `flaker apply` |
| `flaker collect local` | `flaker apply` |
| `flaker collect coverage` | `flaker apply` |
| `flaker collect commit-changes` | `flaker apply` |
| `flaker collect calibrate` | `flaker apply` |
| `flaker quarantine suggest` / `flaker quarantine apply` | `flaker apply` |
| `flaker policy quarantine` / `flaker policy check` / `flaker policy report` | `flaker apply` |
| `flaker gate review <name>` | `flaker status --gate <name> --detail --json` |
| `flaker gate history <name>` | `flaker status --gate <name>` |
| `flaker gate explain <name>` | `flaker status --gate <name> --detail` |
| `flaker analyze kpi` | `flaker status` |
| `flaker analyze eval` | `flaker status --markdown` |
| `flaker analyze flaky` | `flaker status --list flaky` |
| `flaker analyze flaky-tag` | `flaker apply` |
| `flaker analyze reason` / `insights` / `cluster` / `bundle` / `context` | `flaker explain <topic>` |
| `flaker analyze query` | `flaker query` |
| `flaker import report <file>` | `flaker import <file>` (adapter auto-detected) |
| `flaker import parquet <dir>` | `flaker import <file>` |
| `flaker report summary` / `diff` / `aggregate` | `flaker report <file> --summary` / `--diff <base>` / `--aggregate <dir>` |
| `flaker debug doctor` | `flaker doctor` |
| `flaker kpi` (top-level alias) | `flaker status` (via `flaker analyze kpi`) |

**Not deprecated — kept as first-class commands:**

- `flaker ops daily` / `flaker ops weekly` / `flaker ops incident` — `apply` does not yet emit cadence artifacts; these remain the authoritative interface for scheduled operations workflows.
- `flaker dev *` — hidden maintainer tools; not part of the public surface.

---

## 4. Upgrade recipe

```bash
# 1. Update the package
pnpm up @mizchi/flaker@0.7

# 2. Dry-run the new surface on your existing flaker.toml
pnpm flaker status        # read drift vs [promotion] thresholds
pnpm flaker plan          # see what apply would do (no writes)

# 3. Replace imperative scripts with apply-first
# (update package.json scripts, CI workflows, and cron jobs)

# old:
#   flaker collect ci --days 30 && flaker collect calibrate
# new:
#   flaker apply

# old:
#   flaker analyze kpi
# new:
#   flaker status

# old:
#   flaker analyze eval --markdown --window 7
# new:
#   flaker status --markdown

# old:
#   flaker gate review merge --json
# new:
#   flaker status --gate merge --detail --json

# old:
#   flaker analyze reason flaky-suite
# new:
#   flaker explain reason

# old:
#   flaker import report results.json
# new:
#   flaker import results.json

# old:
#   flaker report summary
# new:
#   flaker report results.json --summary
```

---

## 5. Grep checklist

Run the following command in your repository root before upgrading to 0.8.0. Every match is either a script or documentation reference that needs updating.

```bash
grep -rE 'flaker (collect (ci|local|coverage|commit-changes|calibrate)|quarantine (suggest|apply)|policy (quarantine|check|report)|gate (review|history|explain)|analyze (kpi|eval|flaky|flaky-tag|reason|insights|cluster|bundle|context|query)|setup init|exec (run|affected)|debug doctor|kpi\b)' \
  .github/ package.json docs/ scripts/
```

Typical locations to check:

- `.github/workflows/*.yml` — CI collect and gate-review steps
- `package.json` `scripts` block — local dev helpers
- `docs/` — any runbook or how-to that references old command forms
- `scripts/` — any shell scripts wrapping flaker commands

---

## 6. Breaking changes (none in 0.7.0)

0.7.0 is **not** a breaking release. The version bump reflects the scope of the surface rework, but every deprecated command still dispatches identically to its 0.6.x behavior and exits with the same exit codes. The only observable change is a single deprecation warning printed to `stderr`.

0.8.0 will be the first breaking release in this cycle. Deprecated commands will exit with a non-zero code and print an error instead of running.

---

## 7. Related reading

- [README — canonical command forms](../README.md#quick-start)
- `skills/flaker-setup/SKILL.md` — onboarding for new repos (0.7.0 flow)
- `skills/flaker-management/SKILL.md` — daily operations (0.7.0 flow)
- [`CHANGELOG.md`](../CHANGELOG.md) — full 0.7.0 release notes
- [`docs/superpowers/plans/2026-04-19-cli-surface-reduction.md`](superpowers/plans/2026-04-19-cli-surface-reduction.md) — Phase 1 plan
- [`docs/superpowers/plans/2026-04-19-phase2-skill-docs-migration.md`](superpowers/plans/2026-04-19-phase2-skill-docs-migration.md) — Phase 2 plan
