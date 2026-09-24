# flaker Operations Guide

[日本語版](operations-guide.ja.md)

The entrypoint for **operating** `flaker`.
This page is aimed at maintainers, QA, and CI owners who need to design gates and keep them trustworthy over time.

It does not try to be:

- the day-to-day usage guide for normal developers
- the exhaustive per-command reference

For those, see [usage-guide.md](usage-guide.md) and [how-to-use.md](how-to-use.md).

If flaker is not installed or initialized yet, start with [new-project-checklist.md](new-project-checklist.md).

If you operated flaker `0.12.x` before, read [migration-0.12-to-0.13.md](migration-0.12-to-0.13.md) first: the `ops` command group is gone, and gates replace profiles.

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

| Gate | Config section | Role |
|---|---|---|
| `iteration` | `[gate.iteration]` | fast author feedback |
| `merge` | `[gate.merge]` | PR / mainline gate |
| `release` | `[gate.release]` | full or near-full verification |

## The operating loops

### Observation loop

- `flaker apply` (imports CI history and calibrates when `GITHUB_TOKEN` is set)
- `flaker status`

Purpose:

- grow history
- reconcile the repo to `flaker.toml`
- measure whether gates are still trustworthy

### Triage loop

- `flaker status --gate merge --detail --json`
- `flaker status --markdown` + `flaker explain insights`
- `flaker apply` (auto-quarantines via `[quarantine].auto`)
- weekly promote / keep / demote review

Purpose:

- keep flaky tests out of the gate path
- preserve a stable artifact for promote / keep / demote review
- apply quarantine changes declaratively from `flaker.toml`
- preserve trust in required checks

### Incident loop

- `flaker debug retry` / `flaker debug confirm` / `flaker debug diagnose`

Purpose:

- classify a failure as regression or flaky
- shorten the path from failure to action

## Recommended cadence

The `ops` command group and `apply --emit` were removed in 0.13.0; the cadence below uses `apply` + `status` + `explain` directly (see [migration-0.12-to-0.13.md](migration-0.12-to-0.13.md)).

### Daily

```bash
mkdir -p .artifacts
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker apply --json --output .artifacts/flaker-daily.json
pnpm flaker status --markdown > .artifacts/flaker-daily.md
```

### Weekly

```bash
mkdir -p .artifacts
pnpm flaker status --gate merge --detail --json > .artifacts/gate-review-merge.json
pnpm flaker status --markdown > .artifacts/flaker-weekly.md
pnpm flaker explain insights --json > .artifacts/flaker-insights.json
```

Review:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- count of `flaky` / `quarantined` tests (`flaker status --list flaky` / `--list quarantined`)

and decide `promote / keep / demote`.

`status` (without `--gate`) is summary-only. Use `status --gate merge --detail --json` for the actual promotion decision.

### During an incident

```bash
pnpm flaker debug retry --run <workflow-run-id>
pnpm flaker debug confirm "path/to/spec.ts:test name" --repeat 10
pnpm flaker debug diagnose --suite path/to/spec.ts --test "test name"
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
