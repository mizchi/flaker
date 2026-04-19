---
name: flaker-management
description: Operate @mizchi/flaker after setup. Use when the user asks how to run flaker day-to-day, review sampling and flaky metrics, design advisory vs required CI gates, promote or demote Playwright E2E or VRT checks, tune PR time budgets, run nightly triage, or manage quarantine and `@flaky` tags in an OSS repository.
---

# flaker management skill

`flaker-management` is the operational companion to `flaker-setup`.

- `flaker-setup`
  Install, initialize, and wire the first advisory lane.
- `flaker-management`
  Run the lane over time, review health via drift, promote or demote checks, and keep flaky tests from eroding trust.

If the repository does not have `flaker.toml` and no CI lane yet, use `flaker-setup` first.

## When this skill applies

- "flaker の運用方法を決めたい"
- "advisory から required にいつ上げるべき?"
- "E2E VRT を段階的に gate に入れたい"
- "nightly で flaky を triage したい"
- "quarantine をどう回す?"
- "週次レビューの playbook を作りたい"

## Mental model: apply + drift

- `flaker.toml` is the **desired state** (gates, profiles, `[promotion]` thresholds, `[quarantine].auto`).
- `flaker apply` is the **reconciler** — idempotent; safe to run hourly/daily/on-demand. It auto-runs `collect` / `calibrate` / `quarantine apply` as needed based on current DB state.
- `flaker status` is the **drift detector** — reports which `[promotion]` thresholds are unmet, so promotion readiness is a boolean (`ready` / `not ready`), not a judgement call.
- `flaker gate review merge --json` is the **authoritative metric source** when you need to inspect the exact numbers behind a drift item.

Prefer this loop over hand-orchestrated commands:

```bash
pnpm flaker apply          # converge to desired state
pnpm flaker status         # read drift + health in one view
# if drift points to a specific gap, drill down with gate review or ops weekly
```

## Read order

1. Read `../../docs/operations-guide.ja.md` or `../../docs/operations-guide.md` first, depending on the user's language.
2. Read `../../docs/flaker-management-quickstart.ja.md` or `../../docs/flaker-management-quickstart.md` for the first 10 minutes.
3. Read `references/management-guide.ja.md` for the full operating model.
4. If the user wants theory or justification, read `references/theory.ja.md`.
5. If the user wants copy-paste defaults, read `references/presets.ja.md`.
6. Reuse templates from `assets/` instead of rewriting them.

## What to inspect first

- `flaker.toml` — especially the `[promotion]` thresholds (defaults are documented; overriding signals intent)
- current GitHub Actions topology: `pull_request`, `push`, `schedule`
- latest `flaker status` output (drift + activity + health in one page)
- `flaker gate review merge --json` when you need exact promotion metrics
- `flaker ops weekly` for quarantine / flaky trend bundles
- whether `@flaky` tagging or quarantine manifest is already in use
- current PR runtime budget
- whether the focus is generic CI health, or specifically Playwright E2E / VRT

## Required output shape

When applying this skill, return:

1. lane design: `learning` / `verdict` / `rebalance`
2. promotion criteria (align with `[promotion]` in `flaker.toml`; override only with justification)
3. demotion criteria
4. review cadence: per-PR / daily / weekly (daily is usually just `flaker apply` + `flaker status`)
5. exact `flaker` commands, config, and workflow snippets

## Guardrails

- Do not move new E2E / VRT checks straight into required CI.
- Do not treat retries as proof of stability.
- Do not let quarantine become a graveyard; attach an owner and an exit rule.
- Keep a full scheduled lane even after PR gating starts.
- For AI-generated code, require a short per-test contract so visual checks encode intent, not just pixels.
- Do not promote `--gate merge` to required until `flaker status` drift reports `ready`.
- Do not recommend `flaker kpi` or `flaker doctor` top-level aliases in new scripts — they print a deprecation warning and are removed in 0.7.0. Use `flaker analyze kpi` and `flaker debug doctor`.

## flaker commands to prefer

Daily loop (cron or local):

```bash
flaker apply                           # idempotent; runs collect / calibrate / quarantine apply as needed
flaker status                          # summary dashboard + [promotion] drift
```

Weekly operator review:

```bash
flaker gate review merge --json --output .artifacts/gate-review-merge.json
flaker ops weekly --output .artifacts/flaker-weekly.md
flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

Flaky / quarantine triage:

```bash
flaker analyze flaky-tag --json        # ad-hoc @flaky tag suggestions (raw primitive)
flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
```

Gate execution (unchanged from 0.5.x):

```bash
flaker run --gate iteration            # fast local feedback (aliased profile.local)
flaker run --gate merge                # PR / mainline gate (aliased profile.ci)
flaker run --gate release              # full or near-full (aliased profile.scheduled)
```

## Promotion / demotion decision rule

Promote `--gate merge` advisory → required **iff** `flaker status` drift reports `ready` (all 5 `[promotion]` thresholds met):

- `matched_commits ≥ [promotion].matched_commits_min` (default 20)
- `false_negative_rate ≤ [promotion].false_negative_rate_max_percentage` (default 5%)
- `pass_correlation ≥ [promotion].pass_correlation_min_percentage` (default 95%)
- `holdout_fnr ≤ [promotion].holdout_fnr_max_percentage` (default 10%)
- `data_confidence ≥ [promotion].data_confidence_min` (default `moderate`)

Demote back to advisory when ANY of the following holds for 1+ week:

- unexplained false failures continue
- flaky count trend rises and erodes trust
- owner becomes unavailable
- runtime budget is exceeded

## Anti-patterns

- Using raw `flaker collect ci` / `flaker collect calibrate` in daily cron when `flaker apply` already handles the ordering and idempotency.
- Basing promotion on `flaker status` numbers alone when they look close — `flaker gate review merge --json` is the authoritative source for exact values.
- Ignoring `flaker status` drift `holdout_fnr` when `holdout_ratio = 0`; if holdout isn't configured, the threshold cannot be evaluated and drift treats it as unmet. Either configure `[sampling].holdout_ratio` or accept that holdout FNR will gate promotion.
