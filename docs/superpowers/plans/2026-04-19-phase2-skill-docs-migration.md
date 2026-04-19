# 0.7.0 Phase 2 — Skill, Docs, Migration Guide + Minor E2E Fixes

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Bring the skills, docs, and release tooling in line with the 10-command primary surface shipped by Phase 1, and close the small E2E findings (`--version` duplicate, missing `[profile.*]` on init, silent `apply` on empty repos). This ships as 0.7.0 proper (not -next).

**Architecture:** Docs + skills are prose rewrites targeting the new canonical forms. Minor fixes are small TDD tasks. `ops daily` is **kept as Advanced** (no longer deprecated) because the Phase 1 deprecation was aspirational — apply does not emit the daily artifact today, and building that feature doesn't belong in Phase 2.

**Tech Stack:** Markdown, TypeScript, Commander, Vitest.

---

## Scope & non-goals

**In scope:**
- Rewrite `skills/flaker-setup/SKILL.md` — Day 1 flow uses only primary commands
- Rewrite `skills/flaker-management/SKILL.md` — daily loop is `apply` + `status`, no direct `analyze kpi` / `ops daily` references
- Update `docs/new-project-checklist.ja.md` / `docs/new-project-checklist.md` to reflect the 10-command surface
- Update `docs/operations-guide.ja.md` / `docs/operations-guide.md` to the new status/apply loop
- Update `docs/how-to-use.ja.md` / `docs/how-to-use.md` — remove deprecated-command-first examples; keep the reference table but mark deprecated rows
- Update `README.md` Quick Start / canonical-forms table to match the final 10 primary
- Write `docs/migration-0.6-to-0.7.md` — matrix of old→new commands, skill-to-version pinning, upgrade steps
- **Revert `ops daily` deprecation** — restore it as Advanced (no warning) since apply does not yet emit the daily artifact
- Fix `--version` duplicate output
- Make `flaker init` write `[profile.*]` default sections into `flaker.toml`
- Add a hint line when `flaker apply` finishes with 0 actions or an empty cold-start run
- Empirical re-evaluation with subagents on the rewritten skills and docs (A/B/C scenarios + the CLI surface invariant)

**Out of scope (separate plans):**
- `flaker apply --output daily|weekly|incident` artifact emission (0.8 feature)
- Full removal of deprecated commands (0.8.0)
- `storage.path` rename / schema migration (ecosystem coordination)
- `DeprecationWarning: url.parse()` suppression (dependency upgrade)
- VRT / Playwright-specific onboarding refresh

---

## File structure

**Create:**
- `docs/migration-0.6-to-0.7.md` — migration matrix + step-by-step upgrade

**Modify:**
- `skills/flaker-setup/SKILL.md`
- `skills/flaker-management/SKILL.md`
- `docs/new-project-checklist.ja.md`, `docs/new-project-checklist.md`
- `docs/operations-guide.ja.md`, `docs/operations-guide.md`
- `docs/how-to-use.ja.md`, `docs/how-to-use.md`
- `README.md`
- `src/cli/categories/ops.ts` (revert `ops daily` deprecation)
- `src/cli/main.ts` (fix `--version` duplicate)
- `src/cli/setup/init.ts` or equivalent (add `[profile.*]` defaults on init)
- `src/cli/categories/apply.ts` (add "no-op" / "empty cold start" hint)
- `CHANGELOG.md`, `package.json` (bump to `0.7.0`)

---

## Task breakdown

### Task 1: Revert `ops daily` deprecation

**Files:**
- Modify: `src/cli/categories/ops.ts`
- Test: `tests/cli/ops-daily-not-deprecated.test.ts` (create)

- [ ] Write failing test: `flaker ops daily --help` does NOT emit a deprecation warning on stderr.
- [ ] Remove the `deprecate()` call attached to the `ops daily` registration (added in Phase 1 Task 10).
- [ ] Update `tests/cli/deprecation-blanket.test.ts` to remove the `ops daily` row.
- [ ] Update `src/cli/main.ts` help block: move `ops daily` out of Deprecated, into Advanced alongside `ops weekly` / `ops incident`.
- [ ] Commit: `fix(cli): restore ops daily as Advanced (apply does not emit daily artifact yet)`.

### Task 2: Fix `--version` duplicate output

**Files:**
- Modify: `src/cli/main.ts`
- Test: `tests/cli/version.test.ts` (extend)

- [ ] Write failing assertion: `flaker --version` stdout has exactly one line matching `/^\d+\.\d+\.\d+/`.
- [ ] Root cause: investigate `program.version()` vs a separate `flaker core CLI` banner printed before it. Locate the banner source (likely in the moonbit bridge or a build-time insertion) and suppress it from `--version` mode. Keep any banner out of `--version` but do not silently hide it elsewhere unless it is vestigial.
- [ ] Commit: `fix(cli): emit a single line from --version`.

### Task 3: `flaker init` generates `[profile.*]` defaults

**Files:**
- Modify: `src/cli/setup/init.ts` (or equivalent — find via `grep -rl "Initialized flaker.toml" src/cli`)
- Test: `tests/cli/init-profile-defaults.test.ts` (create)

- [ ] Failing test: after `flaker init --adapter playwright --runner playwright`, the generated `flaker.toml` contains `[profile.local]`, `[profile.ci]`, `[profile.scheduled]` with sensible defaults (local=affected, ci=hybrid 30%, scheduled=full).
- [ ] Implement: append the three profile blocks after the existing sections during init. Mirror the example from `skills/flaker-setup/SKILL.md` (the block was already documented as canonical).
- [ ] Commit: `feat(init): write [profile.*] default sections for local/ci/scheduled`.

### Task 4: `flaker apply` hints on empty cold-start / zero actions

**Files:**
- Modify: `src/cli/categories/apply.ts`
- Test: `tests/cli/apply-empty-hint.test.ts` (create)

- [ ] Failing test A: when `planApply()` returns `[]`, the CLI prints `"No actions needed. Current state matches flaker.toml."` (already exists) AND appends a follow-up hint pointing to `flaker status` for current health. Assert both lines.
- [ ] Failing test B: when `cold_start_run` executes with 0 selected tests, the text output includes `"hint: 0 tests discovered — check [runner].command and [affected].resolver"`.
- [ ] Implement: in `applyAction`, inspect `executed` for `cold_start_run` results and check the `sampledCount` field (from `executePreparedLocalRun`'s return). If zero, print the hint line on stderr. JSON mode remains unchanged.
- [ ] Commit: `feat(apply): add actionable hints for empty cold-start and no-op runs`.

### Task 5: Rewrite `skills/flaker-setup/SKILL.md`

**Files:**
- Modify: `skills/flaker-setup/SKILL.md`

- [ ] Replace every deprecated command reference with the 0.7.0 canonical form. Use this mapping:
  | Old | New |
  |---|---|
  | `flaker collect ci` / `flaker collect calibrate` | `flaker apply` (in Day 2-3 flow) |
  | `flaker quarantine suggest/apply` | `flaker apply` |
  | `flaker analyze kpi` | `flaker status` |
  | `flaker analyze eval --markdown` | `flaker status --markdown` |
  | `flaker analyze flaky` | `flaker status --list flaky` |
  | `flaker debug doctor` (in scripts) | `flaker doctor` |
  | `flaker exec run` / `flaker exec affected` | `flaker run --gate iteration --changed ...` |
- [ ] Update the `Phase order` table: Day 2-3 becomes just `flaker apply`. Day 5 uses `flaker apply` in cron, not `collect ci` + `run --gate release`.
- [ ] Update package.json scripts block: replace `flaker:collect:ci` / `flaker:collect:local` etc. with `flaker:plan`, `flaker:apply`, `flaker:status` (apply-first).
- [ ] Update the Minimal `flaker.toml` example to include `[promotion]` override commented out (matches Task 3's init output).
- [ ] Commit: `docs(skills): rewrite flaker-setup around the 10-command surface`.

### Task 6: Rewrite `skills/flaker-management/SKILL.md`

**Files:**
- Modify: `skills/flaker-management/SKILL.md`

- [ ] Replace `flaker commands to prefer` block with apply-first recipes:
  ```bash
  # Daily
  flaker apply
  flaker status
  # Weekly
  flaker status --markdown > .artifacts/status-weekly.md
  flaker ops weekly --output .artifacts/flaker-weekly.md
  # Promotion snapshot
  flaker status --gate merge --detail --json
  # Incident
  flaker debug retry
  flaker debug confirm "<suite>:<test>" --repeat 10
  ```
- [ ] Update the "What to inspect first" list: replace `flaker analyze kpi` with `flaker status` and `flaker analyze eval --markdown` with `flaker status --markdown`.
- [ ] Update the Promotion / demotion decision rule to show `flaker status --gate merge --detail` is the primary readout; `flaker gate review merge --json` stays as the authoritative metric dump (Advanced).
- [ ] Update the Guardrails bullet about deprecated aliases to reflect the 0.7.0 list, not the 0.6.0 list.
- [ ] Commit: `docs(skills): rewrite flaker-management around apply + status`.

### Task 7: Update `docs/new-project-checklist.*.md`

**Files:**
- Modify: `docs/new-project-checklist.ja.md`, `docs/new-project-checklist.md`

- [ ] Day 1: `install → init → doctor → plan → apply → status`. No `flaker run --dry-run --explain` unless necessary (keep as a diagnostic aside).
- [ ] Day 2-3: collapse the existing "manual individual commands" `<details>` block — the apply flow is now the only recommended path. Keep the old individual commands only in `docs/migration-0.6-to-0.7.md`, not in the onboarding checklist.
- [ ] Day 3 scripts block: use the 0.7.0 script names from Task 5.
- [ ] Day 5 Actions integration: `flaker apply` in PR advisory + nightly; no separate `collect ci` step.
- [ ] Week 2-4: reference `flaker status` drift `ok: true` as the promotion-ready signal.
- [ ] Commit: `docs(checklist): unify on apply+status flow, retire individual-command sidebar`.

### Task 8: Update `docs/operations-guide.*.md` + `docs/how-to-use.*.md` + `README.md`

**Files:**
- Modify: `docs/operations-guide.ja.md`, `docs/operations-guide.md`, `docs/how-to-use.ja.md`, `docs/how-to-use.md`, `README.md`

- [ ] operations-guide: daily cadence → `flaker apply` + `flaker status` (one pnpm line each). Weekly → `flaker status --markdown` + `flaker ops weekly` + `flaker status --gate merge --detail`. Incident → `flaker debug retry` / `confirm` / `diagnose`.
- [ ] how-to-use: keep the command reference table but tag deprecated rows with "DEPRECATED — see migration-0.6-to-0.7.md". The reference value is real; don't delete it.
- [ ] README: rewrite Quick Start to land on `flaker apply` / `flaker plan` / `flaker status` only. Remove Path 1 / Path 2 split — apply handles the branching internally. Update the canonical-forms table to match the Phase 1 plan's final list.
- [ ] Commit: `docs: unify operations-guide, how-to-use, and README around the 10-command surface`.

### Task 9: Write `docs/migration-0.6-to-0.7.md`

**Files:**
- Create: `docs/migration-0.6-to-0.7.md`

- [ ] Structure:
  1. Summary (why: surface reduction 53 → 10; aspirational target: AI + human callers collapse onto the same 10 verbs)
  2. New commands: `flaker plan`, `flaker apply`, `flaker status` flags, `flaker query`, `flaker explain <topic>`, `flaker import <file>`, `flaker report <file> --<mode>`
  3. Deprecation matrix (table with old command → canonical + when deprecated + when removed)
  4. Upgrade steps (for a user on 0.5.x / 0.6.x):
     - `pnpm up @mizchi/flaker@0.7`
     - Run `pnpm flaker status` once — expect drift summary
     - Replace `flaker collect ci && flaker collect calibrate` in scripts with `flaker apply`
     - Replace `flaker analyze kpi` in scripts with `flaker status`
     - Grep CI workflows for `flaker doctor`, `flaker kpi`, `flaker exec *`, `flaker setup init` and update
     - Regenerate package.json scripts from `skills/flaker-setup/SKILL.md`
  5. Breaking-change timeline: 0.7.0 deprecates, 0.8.0 removes
- [ ] Commit: `docs: add migration-0.6-to-0.7.md`.

### Task 10: Bump to 0.7.0 + CHANGELOG

**Files:**
- Modify: `package.json`, `src/cli/main.ts` (hardcoded version), `CHANGELOG.md`

- [ ] `version`: `0.7.0-next.0` → `0.7.0`
- [ ] CHANGELOG: move the `0.7.0-next.0 (prerelease)` section up and promote it to `## 0.7.0`, add Phase 2 fixes (ops daily un-deprecated, --version single line, init writes profiles, apply hints, skill+docs rewrites, migration guide).
- [ ] Commit: `chore(release): 0.7.0`.

### Task 11: Empirical re-evaluation with subagents

**Files:**
- (Evaluation only — no code changes)

- [ ] Dispatch 3 subagents in parallel with the canonical A/B/C scenarios (Day 1 Playwright setup, 2-week promotion decision, CI failure retry/confirm). Each reads only the updated docs + skills.
- [ ] Dispatch a 4th subagent for the CLI surface invariant: verify `flaker --help` still shows exactly the 11 primary entries (surface-reduction.test.ts will also catch this, but the subagent gets a human readability check).
- [ ] Aggregate results into an Iter 6 table vs the Iter 5 baseline. Target: no regression on A/B/C accuracy, no new unclear-points above 2.
- [ ] If regressions are found, fix them in a follow-up commit before merging the Phase 2 PR.

---

## Self-review

### Spec coverage

- Skill rewrites (Tasks 5, 6) cover both `flaker-setup` and `flaker-management`.
- Doc rewrites (Tasks 7, 8) cover all 4 canonical language-separated documents (new-project-checklist, operations-guide, how-to-use, README) in both en and ja.
- Migration guide (Task 9) consolidates the deprecation matrix for users.
- Minor E2E fixes (Tasks 1, 2, 3, 4) address every non-blocker item from the Iter 5 / 0.7 Phase 1 E2E reports.
- Release ritual (Task 10) ships as 0.7.0.
- Empirical eval (Task 11) closes the loop.

### Placeholders

None. All tasks have concrete file paths, TDD scaffolds where applicable, and explicit commit messages.

### Type consistency

- Canonical replacements referenced in Tasks 5-9 match the Phase 1 plan's canonical-forms table verbatim.
- Task 1 reverses one decision from Phase 1 (ops daily deprecation) — this is intentional and explained in the architecture note.
- Task 3 writes `[profile.*]` sections matching the structure already validated in `config-migration.test.ts`.

### Risk notes

- **Task 1 revert** creates an asymmetry: Phase 1 announced ops daily deprecated; Phase 2 reverts. Acceptable because 0.7.0 is not yet GA and the Phase 1 PR landed on main but the npm tag is still -next. Migration guide (Task 9) should NOT list ops daily as deprecated.
- **Task 3 init defaults** — if an existing repo has an `init`-generated flaker.toml without `[profile.*]`, a future `flaker apply` still works via config defaults. No migration needed.
- **Task 11 eval subagents** — if scenarios B/C regress because skill rewrites removed too much detail, the Phase 2 PR must be amended before merge.
