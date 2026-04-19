# flaker Management Quick Start

[日本語版](flaker-management-quickstart.ja.md)

The shortest path to start operating `flaker` after setup.
This page assumes you already have `flaker.toml` and have started running `flaker run --gate merge` in advisory mode.

For the full operating model, start with [operations-guide.md](operations-guide.md).
For normal day-to-day usage only, use [usage-guide.md](usage-guide.md).

If you have not installed or initialized flaker yet, start with [new-project-checklist.md](new-project-checklist.md).

This quick start has three goals:

- fix what runs every day
- fix what gets reviewed every week for promotion or demotion
- give a safe path to gradually gate Playwright E2E / VRT

## 0. Prerequisites

At minimum, you should already have:

- `flaker.toml`
- `profile.scheduled`
- `profile.ci`
- `profile.local`
- GitHub Actions for `pull_request` and/or `push` / `schedule`

Minimal Playwright-oriented config:

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"
flaky_tag_pattern = "@flaky"

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 10

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
skip_flaky_tagged = true

[profile.local]
strategy = "affected"
max_duration_seconds = 90
fallback_strategy = "weighted"
skip_flaky_tagged = true
```

## 1. What to do in the first 10 minutes

Run this at the repo root:

```bash
mkdir -p .artifacts
pnpm flaker status
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

Look at:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- number of `flaky` / `quarantined` tests

If `matched commits` is still thin, do not make the check required yet. Keep it advisory and continue observing.

## 2. Daily loop

Run this nightly or once per day:

```bash
mkdir -p .artifacts
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 1
pnpm flaker ops daily --output .artifacts/flaker-daily.md
pnpm flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
```

Update quarantine too when needed:

```bash
pnpm flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
```

This loop does three things:

- grows history via full execution
- leaves a reviewed quarantine plan artifact
- leaves a daily release snapshot artifact

## 3. Weekly review

First refresh the weekly artifacts:

```bash
mkdir -p .artifacts
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

Then fill this once a week:

```md
## Week YYYY-MM-DD

- matched commits:
- false negative rate:
- pass correlation:
- sample ratio:
- saved test minutes:
- fallback rate:
- flaky tests:
- quarantined tests:
- promote:
- keep:
- demote:
```

For a fuller template, use [skills/flaker-management/assets/weekly-review-template.md](../skills/flaker-management/assets/weekly-review-template.md).

## 4. When to promote advisory to required

Do not promote until you have at least:

- `matched commits >= 20`
- `false negative rate <= 5%`
- `pass correlation >= 95%`
- `data confidence` at `moderate` or higher

For Playwright E2E / VRT, also require:

- a clear user-visible contract
- dynamic regions and non-goals documented
- the check fits inside the PR runtime budget

## 5. When to demote

Move a check back from required to advisory or `@flaky` / quarantine when any of these is true:

- unexplained false failures continue
- rolling-window false failure rate is high
- nobody owns the check
- the purpose of the check is unclear
- it puts too much pressure on the runtime budget

## 6. Additional rules for Playwright E2E / VRT

Do not gate new VRT immediately.
First let it burn in on a `Learning lane`.

- run it on `main` push or nightly with near-full coverage
- classify failures as `intent-debt`, `environment-noise`, `test-design`, and so on
- remove noise with `mask`, `stylePath`, and animation disable
- prefer local contracts over full-page snapshots

For per-test contracts, use [skills/flaker-management/assets/test-contract-template.md](../skills/flaker-management/assets/test-contract-template.md).

## 7. When something breaks

Re-check a CI failure:

```bash
pnpm flaker ops incident --run <workflow-run-id> --output .artifacts/flaker-incident.md
```

Confirm a specific test:

```bash
pnpm flaker ops incident --suite path/to/spec.ts --test "test name" --output .artifacts/flaker-incident.md
```

If you need finer control, drop to the raw debug primitives:

```bash
pnpm flaker debug retry --run <workflow-run-id>
pnpm flaker debug confirm "path/to/spec.ts:test name" --runner local
pnpm flaker debug diagnose --suite path/to/spec.ts --test "test name"
```

## 8. Which skill to use

- before setup: `flaker-setup`
- after setup, for operations: `flaker-management`

The skill entrypoint is [skills/flaker-management/SKILL.md](../skills/flaker-management/SKILL.md).
