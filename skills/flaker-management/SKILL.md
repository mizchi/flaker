---
name: flaker-management
description: Operate @mizchi/flaker after setup. Use when the user asks how to run flaker day-to-day, review sampling and flaky metrics, design advisory vs required CI gates, promote or demote Playwright E2E or VRT checks, tune PR time budgets, run nightly review, or manage quarantine and `@flaky` tags in an OSS repository. Targets @mizchi/flaker 0.13.0+ (gate-based declarative apply model).
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

- `flaker.toml` is the **desired state** (`[gate.iteration|merge|release]`, `[promotion]` thresholds, `[quarantine].auto`).
- `flaker apply` is the **reconciler** — idempotent; safe to run hourly/daily/on-demand. It auto-runs `collect_ci` / `calibrate` / `cold_start_run` / `quarantine_apply` as needed based on current DB state. It is reconcile-only: there is no `--emit`, `--target`, or `--incident-*` flag anymore, so ad-hoc one-off actions go through `import`, `run`, `debug`, or `status` instead.
- `flaker status` is the **drift detector** — reports which `[promotion]` thresholds are unmet, so promotion readiness is a boolean (`ready` / `not ready`), not a judgement call.

The canonical daily loop is:

```bash
flaker apply && flaker status
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
- `flaker status --gate merge --detail --json` when you need exact promotion metrics
- `flaker status --markdown` plus `flaker explain insights` for quarantine / flaky trend review (the old `flaker ops weekly` bundle was removed; these two commands replace it)
- whether `@flaky` tagging or quarantine manifest is already in use
- current PR runtime budget
- whether the focus is generic CI health, or specifically Playwright E2E / VRT

## Required output shape

When applying this skill, return:

1. lane design: `learning` / `verdict` / `rebalance`
2. promotion criteria (align with `[promotion]` in `flaker.toml`; override only with justification)
3. demotion criteria
4. review cadence: per-PR / daily / weekly (daily is usually just `flaker apply && flaker status`)
5. exact `flaker` commands, config, and workflow snippets

## Guardrails

- Do not move new E2E / VRT checks straight into required CI.
- Do not treat retries as proof of stability.
- Do not let quarantine become a graveyard; attach an owner and an exit rule.
- Keep a full scheduled lane even after PR gating starts.
- For AI-generated code, require a short per-test contract so visual checks encode intent, not just pixels.
- Do not promote `--gate merge` to required until `flaker status` drift reports `ready`.
- Do not reach for pre-0.13.0 command forms in new scripts — `analyze kpi`, `analyze eval`, `collect ci`, `debug doctor`, `quarantine suggest/apply`, `gate review/history/explain`, and the whole `ops` group (`ops weekly`, `ops incident`, `ops daily`) no longer exist at all in 0.13.0, not even as deprecated aliases. Use the primary commands instead.

## flaker commands to prefer

```bash
# Daily
flaker apply
flaker status

# Weekly operator review (replaces the removed `flaker ops weekly` bundle)
flaker status --markdown > .artifacts/status-weekly.md
flaker explain insights > .artifacts/flaker-weekly-insights.md
flaker status --gate merge --detail --json > .artifacts/merge-gate.json

# Incident (replaces the removed `flaker ops incident` bundle)
flaker debug retry
flaker debug confirm "<suite>:<test>" --repeat 10
flaker debug bisect --test "<name>"
flaker debug diagnose --suite "<suite>" --test "<name>"
```

Note: the `ops` group (daily / weekly / incident) was removed entirely in 0.13.0. `flaker apply && flaker status` is the daily bundle, `flaker status --markdown` + `flaker explain insights` is the weekly bundle, and `flaker debug retry|confirm|diagnose` is the incident bundle — call these directly instead of looking for an `ops` wrapper.

## Promotion / demotion decision rule

Promote `--gate merge` advisory → required **iff** `flaker status` drift reports `ready` (all 5 `[promotion]` thresholds met). Primary signal is `flaker status` — the drift section shows `ready` or lists unmet thresholds:

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

- Calling `flaker import --ci` by hand in daily cron instead of `flaker apply` — `apply` already handles the ordering (`collect_ci` → `calibrate` → `cold_start_run` → `quarantine_apply`) and idempotency; only reach for `import --ci --days <n>` directly when you need a one-off backfill outside the reconcile loop.
- Looking for `flaker analyze kpi` or `flaker analyze eval` — both are gone; use `flaker status` and `flaker status --markdown` instead.
- Looking for `flaker ops weekly` / `flaker ops incident` — the `ops` group is gone; use `flaker status --markdown` + `flaker explain insights` for the weekly bundle, and `flaker debug retry|confirm|diagnose` for incidents.
- Basing promotion on `flaker status` numbers alone when they look close — `flaker status --gate merge --detail --json` is the authoritative source for exact values.
- Ignoring `flaker status` drift `holdout_fnr` when `holdout_ratio = 0`; if holdout isn't configured, the threshold cannot be evaluated and drift treats it as unmet. Either configure `[sampling].holdout_ratio` or accept that holdout FNR will gate promotion.
