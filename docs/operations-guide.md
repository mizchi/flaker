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
- `flaker ops daily`
- `flaker status`

Purpose:

- grow history
- leave a daily release-gate snapshot
- measure whether gates are still trustworthy

### Triage loop

- `flaker gate review merge`
- `flaker ops weekly`
- `flaker quarantine suggest`
- `flaker quarantine apply`
- weekly promote / keep / demote review

Purpose:

- keep flaky tests out of the gate path
- preserve a stable artifact for promote / keep / demote review
- apply only reviewed quarantine plans
- preserve trust in required checks

### Incident loop

- `flaker ops incident`
- drop to `flaker debug retry / confirm / diagnose` only when needed

Purpose:

- classify a failure as regression or flaky
- shorten the path from failure to action

## Recommended cadence

### Daily

```bash
mkdir -p .artifacts
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 1
pnpm flaker ops daily --output .artifacts/flaker-daily.md
pnpm flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
```

### Weekly

```bash
mkdir -p .artifacts
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

Review:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- count of `flaky` / `quarantined` tests

and decide `promote / keep / demote`.

`status` is summary-only. Use `gate review merge` for the actual promotion decision.

### During an incident

```bash
pnpm flaker ops incident --run <workflow-run-id> --output .artifacts/flaker-incident.md
pnpm flaker ops incident --suite path/to/spec.ts --test "test name" --output .artifacts/flaker-incident.md
```

Drop to raw `debug retry / confirm / diagnose` only if you need finer investigation control.

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
