# flaker Usage Guide

[日本語版](usage-guide.ja.md)

The entrypoint for **using** `flaker` day to day.
This page is intentionally narrow: it tells developers which commands to learn first.

It does not cover:

- advisory vs required rollout
- quarantine policy design
- nightly or weekly operating cadence
- staged Playwright E2E / VRT rollout

For those, see [operations-guide.md](operations-guide.md).

If flaker is not installed or initialized yet, start with [new-project-checklist.md](new-project-checklist.md).
If you are upgrading from `0.4.x`, read [migration-0.4-to-0.5.md](migration-0.4-to-0.5.md) first.

## Audience

- developers working in a repo that already has `flaker.toml`
- people who want to run flaker locally as part of normal development
- teams that want a usage entrypoint, not the full operating model

## The first 4 commands to learn

```bash
pnpm flaker doctor
pnpm flaker run --gate iteration
pnpm flaker run --dry-run --gate iteration --explain
pnpm flaker status
```

What they mean:

- `doctor`: verify the local runtime
- `run --gate iteration`: the normal local command
- `run --dry-run --explain`: preview what flaker selected and why
- `status`: look at the current health summary

## How to read gates

Most users only need to know three gates.

| Gate | Main purpose | Used directly by most developers? |
|---|---|---|
| `iteration` | fast local feedback | yes |
| `merge` | PR / mainline gate | sometimes |
| `release` | full or near-full verification | usually CI only |

In normal day-to-day work, `iteration` is the one to remember.

## Common flow

### Check the environment

```bash
pnpm flaker doctor
```

### Preview before pushing

```bash
pnpm flaker run --dry-run --gate iteration --explain --changed src/foo.ts,src/bar.ts
```

### Run the selected tests

```bash
pnpm flaker run --gate iteration --changed src/foo.ts,src/bar.ts
```

### Check current health

```bash
pnpm flaker status
```

## Go deeper when needed

- detailed command reference: [how-to-use.md](how-to-use.md)
- runner / adapter details: [runner-adapters.md](runner-adapters.md), [test-result-adapters.md](test-result-adapters.md)
- failure investigation: [diagnose.md](diagnose.md), `flaker debug confirm`, `flaker debug retry`
- initial onboarding: [new-project-checklist.md](new-project-checklist.md)
- operations and rollout: [operations-guide.md](operations-guide.md)
