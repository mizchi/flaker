# 0.7.0 CLI Surface Reduction Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute phases task-by-task.

**Goal:** Reduce user-facing CLI surface from 53 leaf commands to 10 primary commands by absorbing secondary commands into `apply` / `status` / `explain` / flag-based `import` and `report`, while keeping all deprecated forms functional until 0.8.0.

**Architecture:** Three-phase rollout. Phase 1 adds the consolidated verbs + flags and wires deprecation aliases. Phase 2 ships docs + skill migrations. Phase 3 (shipped as 0.8.0) removes the deprecated aliases. This plan covers Phase 1 only; Phase 2/3 are separate plans.

**Tech Stack:** Node.js 24+, TypeScript, Commander, Vitest, DuckDB.

---

## Target surface (0.7.0 primary, 10 commands)

| Command | Absorbs |
|---|---|
| `flaker init` | `setup init` |
| `flaker plan` / `flaker apply` | — (0.6.0) |
| `flaker status` | `analyze kpi`, `analyze eval`, `analyze flaky`, `gate review`, `gate history`, `gate explain` (via flags: `--detail`, `--markdown`, `--list flaky\|quarantined`, `--gate <name>`) |
| `flaker run --gate <name>` | `exec run`, `exec affected` |
| `flaker doctor` | `debug doctor` |
| `flaker debug <retry\|confirm\|bisect\|diagnose>` | `ops incident` |
| `flaker query <sql>` | `analyze query` |
| `flaker explain <topic>` | `analyze reason\|insights\|cluster\|bundle\|context` |
| `flaker import <file>` | `import report`, `import parquet` (adapter auto-detect) |
| `flaker report <file>` | `report summary\|diff\|aggregate` (via flags) |

Fully absorbed into `apply` (no direct replacement; use `apply` or keep as hidden alias):
- `collect ci / local / coverage / commit-changes / calibrate`
- `quarantine suggest / quarantine apply`
- `policy quarantine / policy check / policy report`
- `ops daily` (apply now emits the daily artifact via `--output`)

Remains hidden (developer-only, not in user help):
- `flaker dev *`

---

## Scope & non-goals

**In scope (Phase 1 = 0.7.0):**
- Extend `status` with `--detail`, `--markdown`, `--list <flaky|quarantined>`, `--gate <name>`
- Add top-level `flaker query <sql>` (alias `analyze query`)
- Add top-level `flaker explain <topic>` (new umbrella for 5 analyze subcommands)
- Make `flaker import <file>` auto-detect adapter from file extension, keep `--adapter` as override
- Make `flaker report <file>` accept `--summary / --diff <base> / --aggregate <dir>` instead of subcommands
- Generalize `warnDeprecated` to support a list of aliases
- Mark all absorbed commands as DEPRECATED with stderr warnings
- Reorganize `flaker --help` to show only the 10 primary commands; everything else under `Advanced:` footer or hidden
- Bump version to 0.7.0 in package.json + CHANGELOG entry

**Out of scope (separate plans):**
- Actual removal of deprecated commands (0.8.0)
- `docs/migration-0.6-to-0.7.md` (Phase 2)
- Rewriting `flaker-setup` / `flaker-management` skills (Phase 2)
- Hiding `dev` subtree from root `--help` (Phase 2; needs coordination with contributors)
- `apply --output` artifact emission to subsume `ops daily` (Phase 2)
- `apply --emit weekly` / `--emit incident` (Phase 2)

---

## File structure

**Create:**
- `src/cli/categories/explain.ts` — umbrella for AI analysis
- `src/cli/deprecation.ts` — generalized deprecation-warning infrastructure
- `tests/cli/surface-reduction.test.ts` — shape test asserting the 10 primary commands

**Modify (per task):**
- `src/cli/main.ts` — add `query` top-level, `explain` top-level, reorganize help, wire deprecations for `exec`, `setup`, `ops daily`, `collect *`, `quarantine`, `policy`, `analyze kpi|eval|flaky|flaky-tag|reason|insights|cluster|bundle|context|query`, `gate review|history|explain`, `import parquet`, `report summary|diff|aggregate`, `debug doctor`
- `src/cli/commands/status/summary.ts` — add `--detail`, `--markdown`, `--list`, `--gate` rendering
- `src/cli/categories/analyze.ts` — flag `analyze *` (except `query`) as deprecated
- `src/cli/categories/import.ts` — add file-extension auto-detect
- `src/cli/categories/report.ts` — add flag-based API
- `package.json` — bump to 0.7.0
- `CHANGELOG.md` — record breaking deprecations

---

## Task breakdown

### Task 1: Generalize `warnDeprecated` infrastructure

**Files:**
- Create: `src/cli/deprecation.ts`
- Modify: `src/cli/main.ts` (replace inline helper)
- Test: `tests/cli/deprecation-infra.test.ts`

- [ ] Write failing test: `deprecate(cmd, { since, remove, canonical })` attaches both an action-wrap warning (stderr) and an `outputHelp` override warning, and updates the command description.
- [ ] Implement `deprecate()` in `src/cli/deprecation.ts`. Signature:
   ```ts
   export function deprecate(
     cmd: Command,
     opts: { since: string; remove: string; canonical: string }
   ): Command;
   ```
   It wraps `cmd._action`, overrides `outputHelp`, and rewrites the description to prepend `DEPRECATED (removed in <remove>) — use \`<canonical>\` instead.`
- [ ] Replace the inline `warnDeprecated` / `attachDeprecationWarning` in main.ts with calls to `deprecate()`.
- [ ] Run existing deprecation-warning test; it should still pass (message text unchanged).
- [ ] Commit `refactor(cli): generalize deprecation helper`.

### Task 2: `flaker status` gains `--markdown`

**Files:**
- Modify: `src/cli/commands/status/summary.ts`
- Modify: `src/cli/main.ts` (register new option)
- Test: `tests/cli/status-markdown.test.ts`

- [ ] Failing test: `runStatusSummary` + `formatStatusSummary` accept a `format: "text" | "markdown" | "json"` argument, and `"markdown"` output contains `# flaker Status` plus section headings matching the existing text mode but with proper Markdown tables.
- [ ] Implement a `formatStatusMarkdown(summary)` function beside `formatStatusSummary` that renders the same fields as a Markdown document.
- [ ] Add `--markdown` flag to `flaker status` in `main.ts` mutually exclusive with `--json`.
- [ ] Commit `feat(status): add --markdown output for weekly review artifacts`.

### Task 3: `flaker status --list <flaky|quarantined>`

**Files:**
- Modify: `src/cli/commands/status/summary.ts` and/or add `src/cli/commands/status/list.ts`
- Test: `tests/cli/status-list.test.ts`

- [ ] Failing test: `flaker status --list flaky` prints a table of top N flaky tests (reuse `analyze flaky` logic).
- [ ] Failing test: `flaker status --list quarantined` prints the current quarantine manifest.
- [ ] Implement a `listFlaky()` and `listQuarantined()` function that reuses existing analyze/quarantine primitives, and branch in `statusAction`.
- [ ] Commit `feat(status): add --list flaky and --list quarantined`.

### Task 4: `flaker status --gate <name>` and `--detail`

**Files:**
- Modify: `src/cli/commands/status/summary.ts`
- Test: `tests/cli/status-detail.test.ts`

- [ ] Failing test: `--detail` renders promotion-threshold actuals next to each `unmet` drift row (matched_commits: 18/20 style), plus `sampleRatio`, `recall`, `falsePositiveRate`, `skippedMinutes`.
- [ ] Failing test: `--gate merge --detail --json` returns a narrowed view focusing on the merge gate only.
- [ ] Implement.
- [ ] Commit `feat(status): add --detail and --gate for operator-grade reporting`.

### Task 5: Deprecate `analyze kpi`, `analyze eval`, `analyze flaky`, `analyze flaky-tag`

**Files:**
- Modify: `src/cli/categories/analyze.ts` (wrap registrations with `deprecate()`)
- Test: extend `tests/cli/deprecation-warning.test.ts`

- [ ] Failing test: each of the 4 commands emits the deprecation warning with a canonical pointer (`status` for kpi/eval/flaky, `apply` for flaky-tag).
- [ ] Apply `deprecate(cmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker status" })` (etc.) to each registration.
- [ ] Commit `feat(cli): deprecate analyze kpi/eval/flaky/flaky-tag in favor of status/apply`.

### Task 6: Top-level `flaker query <sql>`

**Files:**
- Modify: `src/cli/main.ts` (register top-level `query`)
- Modify: `src/cli/categories/analyze.ts` (mark `analyze query` deprecated, canonical: `flaker query`)
- Test: `tests/cli/query-top-level.test.ts`

- [ ] Failing test: `flaker query --help` works; `flaker analyze query --help` emits the deprecation warning.
- [ ] Move action to top-level `query` and deprecate the analyze form.
- [ ] Commit `feat(cli): promote analyze query to top-level flaker query`.

### Task 7: New `flaker explain <topic>` umbrella

**Files:**
- Create: `src/cli/categories/explain.ts`
- Modify: `src/cli/main.ts` (register category)
- Modify: `src/cli/categories/analyze.ts` (deprecate `reason`, `insights`, `cluster`, `bundle`, `context`)
- Test: `tests/cli/explain.test.ts`

- [ ] Failing test: `flaker explain reason --help` (and the 4 others) show the expected help.
- [ ] `flaker explain <topic>` routes to existing actions for `reason | insights | cluster | bundle | context`. Implementation: import the existing action functions and dispatch by topic.
- [ ] Deprecate the 5 `analyze *` commands pointing at the new `explain <topic>` canonical form.
- [ ] Commit `feat(cli): add flaker explain umbrella and deprecate analyze reason/insights/cluster/bundle/context`.

### Task 8: `flaker import` adapter auto-detect

**Files:**
- Modify: `src/cli/categories/import.ts`
- Test: `tests/cli/import-autodetect.test.ts`

- [ ] Failing test: `flaker import report.xml` auto-picks `junit`; `flaker import report.json` needs disambiguation (default to `playwright`, override via `--adapter vitest` etc.); `flaker import report.parquet` uses the parquet branch.
- [ ] Implement extension inference: `.xml` → junit, `.parquet` → parquet, `.json` → playwright (default) with CLI flag override. Keep existing `import report <file>` subcommand working but deprecate it.
- [ ] Commit `feat(import): auto-detect adapter from file extension`.

### Task 9: `flaker report` flag-based API

**Files:**
- Modify: `src/cli/categories/report.ts`
- Test: `tests/cli/report-flags.test.ts`

- [ ] Failing test: `flaker report path --summary`, `--diff <base>`, `--aggregate <dir>` all dispatch to the existing logic; old `flaker report summary|diff|aggregate` subcommands still work but emit deprecation warning.
- [ ] Implement a top-level action that dispatches based on which flag is set (mutually exclusive). Deprecate the subcommands.
- [ ] Commit `feat(report): unify summary/diff/aggregate under flag-based API`.

### Task 10: Deprecate `setup`, `exec`, `ops daily`, `collect *`, `quarantine`, `policy`, `gate review/history/explain`, `debug doctor`, `import parquet`, `import report`

**Files:**
- Modify: every `categories/*.ts` touched
- Test: extend `tests/cli/deprecation-warning.test.ts`

- [ ] Apply `deprecate(cmd, { ... })` to each command per the mapping table at the top of this plan. Canonical pointers:
   - `setup init` → `flaker init`
   - `setup` (category) → `flaker init` (hidden; category becomes empty)
   - `exec run` → `flaker run`
   - `exec affected` → `flaker run --gate iteration --changed <paths>`
   - `ops daily` → `flaker apply` (artifact path via `--output` once Phase 2 lands; keep warning pointing to `apply`)
   - `collect ci / local / coverage / commit-changes / calibrate` → `flaker apply`
   - `quarantine suggest / apply` → `flaker apply`
   - `policy quarantine / check / report` → `flaker apply`
   - `gate review / history / explain` → `flaker status --gate <name> --detail`
   - `debug doctor` → `flaker doctor`
   - `import parquet` → `flaker import <file>` (auto-detect)
   - `import report` → `flaker import <file>` (auto-detect)
- [ ] Commit `feat(cli): deprecate 14 commands now absorbed into apply/status/import/run`.

### Task 11: Reorganize `flaker --help`

**Files:**
- Modify: `src/cli/main.ts` (`helpInformation` override)
- Test: `tests/cli/help-shape.test.ts`

- [ ] Failing test: top-level help lists only the 10 primary commands under "Primary commands" and groups the rest under "Advanced" and "Deprecated (removed in 0.8.0)" sections.
- [ ] Update the `helpInformation` override to match. Keep category help (`flaker <category> --help`) intact.
- [ ] Commit `docs(cli): reorganize help around the 10 primary commands`.

### Task 12: Surface-reduction shape test

**Files:**
- Create: `tests/cli/surface-reduction.test.ts`

- [ ] Write a test that runs `node dist/cli/main.js --help`, extracts the "Primary commands" block, and asserts exactly the 10 expected entries. Regression net against accidental re-expansion.
- [ ] Commit `test(cli): lock primary command surface to 10 entries`.

### Task 13: Version + changelog

**Files:**
- Modify: `package.json`, `CHANGELOG.md`
- Commit last.

- [ ] Bump `version` in `package.json` to `0.7.0-next.0` (so 0.7.0 proper ships after skill/docs migration in Phase 2).
- [ ] Add a CHANGELOG section listing the deprecations and the migration target for each.
- [ ] Commit `chore(release): 0.7.0-next.0 — surface reduction phase 1`.

---

## Self-review

### Spec coverage
Every command in the current 53-leaf surface has an entry in the mapping table at the top of this plan and at least one task that handles its migration. Tasks 2–4 absorb behavior into `status`; Tasks 6–7 introduce new umbrellas; Tasks 8–9 consolidate IO verbs via flags; Task 10 blanket-deprecates the rest; Task 11 reorganizes help; Task 12 locks the invariant.

### Placeholders
None — each task has concrete file paths, code shape, test names, and commit messages. The only intentional deferral is the actual removal of deprecated commands (0.8.0, separate plan) and the artifact-emission side of `apply --output` (Phase 2).

### Type consistency
- `status` flag names: `--detail` / `--markdown` / `--json` / `--list` / `--gate` are documented consistently across Tasks 2–4 and Task 11.
- Deprecation canonical pointers in Task 5 / Task 10 all point to commands that exist after Tasks 2–9 land. Task ordering matters: execute Tasks 1–9 in order, then Task 10 can safely refer to the new commands.

### Risk notes
- `status --list flaky` duplicates `analyze flaky` output shape. Resist rewriting the flaky detection logic; call it from status.
- `explain <topic>` is an umbrella; keeping the underlying actions unchanged and only dispatching from the new entry minimizes regression surface.
- `import` auto-detect is a behavior change: `.json` currently requires `--adapter`. Default to `playwright` when extension-only inference is ambiguous, and log the chosen adapter on stderr so users can see what was inferred.
