---
name: flaker-management
description: Operate @mizchi/flaker after setup. Use when the user asks how to run flaker day-to-day, review sampling and flaky metrics, design advisory vs required CI gates, promote or demote Playwright E2E or VRT checks, tune PR time budgets, run nightly triage, or manage quarantine and `@flaky` tags in an OSS repository.
---

# flaker management skill

`flaker-management` is the operational companion to `flaker-setup`.

- `flaker-setup`
  Install, initialize, and wire the first advisory lane.
- `flaker-management`
  Run the lane over time, review health, promote or demote checks, and keep flaky tests from eroding trust.

If the repository does not have `flaker.toml` and no CI lane yet, use `flaker-setup` first.

## When this skill applies

- "flaker の運用方法を決めたい"
- "advisory から required にいつ上げるべき?"
- "E2E VRT を段階的に gate に入れたい"
- "nightly で flaky を triage したい"
- "quarantine をどう回す?"
- "週次レビューの playbook を作りたい"

## Read order

1. Read `../../docs/operations-guide.ja.md` or `../../docs/operations-guide.md` first, depending on the user's language.
2. Read `../../docs/flaker-management-quickstart.ja.md` or `../../docs/flaker-management-quickstart.md` for the first 10 minutes.
3. Read `references/management-guide.ja.md` for the full operating model.
4. If the user wants theory or justification, read `references/theory.ja.md`.
5. If the user wants copy-paste defaults, read `references/presets.ja.md`.
6. Reuse templates from `assets/` instead of rewriting them.

## What to inspect first

- `flaker.toml`
- current GitHub Actions topology: `pull_request`, `push`, `schedule`
- latest `flaker analyze kpi`
- latest `flaker analyze eval --markdown --window 7`
- whether `@flaky` tagging or quarantine manifest is already in use
- current PR runtime budget
- whether the focus is generic CI health, or specifically Playwright E2E / VRT

## Required output shape

When applying this skill, return:

1. lane design: `learning` / `verdict` / `rebalance`
2. promotion criteria
3. demotion criteria
4. review cadence: per-PR / daily / weekly
5. exact `flaker` commands, config, and workflow snippets

## Guardrails

- Do not move new E2E / VRT checks straight into required CI.
- Do not treat retries as proof of stability.
- Do not let quarantine become a graveyard; attach an owner and an exit rule.
- Keep a full scheduled lane even after PR gating starts.
- For AI-generated code, require a short per-test contract so visual checks encode intent, not just pixels.

## flaker commands to prefer

```bash
flaker run --profile scheduled
flaker run --profile ci
flaker run --profile local
flaker analyze kpi
flaker analyze eval --markdown --window 7
flaker analyze flaky-tag --json
flaker policy quarantine --auto --create-issues
```
