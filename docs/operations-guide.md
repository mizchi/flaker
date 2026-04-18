# flaker Operations Guide

[日本語版](operations-guide.ja.md)

The entrypoint for **operating** `flaker`.
This page is aimed at maintainers, QA, and CI owners who need to design gates and keep them trustworthy over time.

It does not try to be:

- the day-to-day usage guide for normal developers
- the exhaustive per-command reference

For those, see [usage-guide.md](usage-guide.md) and [how-to-use.md](how-to-use.md).

If flaker is not installed or initialized yet, start with [new-project-checklist.md](new-project-checklist.md).

## Audience

- repository maintainers
- QA / test owners
- CI owners
- teams designing promotion from advisory to required

## How to think about operations

The model is easier to hold if you use four layers.

- `Gate`: what decision boundary does this stop?
- `Budget`: how much time, noise, or cost is acceptable?
- `Loop`: what background routine keeps the gate trustworthy?
- `Policy`: what rule applies when trust drops?

## The default gates

Most teams only need three.

| Gate | Backing profile | Role |
|---|---|---|
| `iteration` | `local` | fast author feedback |
| `merge` | `ci` | PR / mainline gate |
| `release` | `scheduled` | full or near-full verification |

## The operating loops

### Observation loop

- `flaker collect`
- `flaker run --gate release`
- `flaker analyze eval`
- `flaker status`

Purpose:

- grow history
- refresh holdout / KPI signals
- measure whether gates are still trustworthy

### Triage loop

- `flaker analyze flaky-tag`
- `flaker policy quarantine`
- weekly promote / keep / demote review

Purpose:

- keep flaky tests out of the gate path
- manage `@flaky` add / remove suggestions
- preserve trust in required checks

### Incident loop

- `flaker debug retry`
- `flaker debug confirm`
- `flaker debug diagnose`

Purpose:

- classify a failure as regression or flaky
- shorten the path from failure to action

## Recommended cadence

### Daily

```bash
pnpm flaker collect ci --days 1
pnpm flaker run --gate release
pnpm flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
pnpm flaker analyze flaky-tag --json > .artifacts/flaky-tag-triage.json
```

### Weekly

Review:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- count of `flaky` / `quarantined` tests

and decide `promote / keep / demote`.

### During an incident

```bash
pnpm flaker debug retry --run <workflow-run-id>
pnpm flaker debug confirm "path/to/spec.ts:test name" --runner local
```

## Promotion and demotion

Before making the `merge` gate required, at least aim for:

- `matched commits >= 20`
- `false negative rate <= 5%`
- `pass correlation >= 95%`
- `data confidence >= moderate`

Move it back to advisory or quarantine when:

- unexplained false failures continue
- flake grows and trust drops
- the owner is unclear
- the runtime budget gets squeezed too hard

## Playwright E2E / VRT

- do not make new VRT required immediately
- burn it in first on `release` / nightly
- use `mask`, `stylePath`, and animation disable to remove noise
- prefer per-test contracts over broad full-page snapshots

For the shortest startup path, see [flaker-management-quickstart.md](flaker-management-quickstart.md).

## What to read next

- first 10 minutes of operations: [flaker-management-quickstart.md](flaker-management-quickstart.md)
- day-to-day usage: [usage-guide.md](usage-guide.md)
- plugin skill entrypoint: [../skills/flaker-management/SKILL.md](../skills/flaker-management/SKILL.md)
