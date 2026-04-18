# flaker 0.4 -> 0.5 Migration Guide

[日本語版](migration-0.4-to-0.5.ja.md)

`0.5.x` is not a hard breaking release like `0.2.0`.
Your `0.4.x` `flaker.toml` and profile-based setup can continue to work as-is.

This migration is mainly about:

- shifting the user-facing language from `profile` to `gate`
- separating day-to-day usage docs from operations docs

## Short version

There is no required config rename from `0.4.x`.

But user-facing scripts and examples should move toward:

| 0.4-style guidance | 0.5 recommendation |
|---|---|
| `flaker run --profile local` | `flaker run --gate iteration` |
| `flaker run --profile ci` | `flaker run --gate merge` |
| `flaker run --profile scheduled` | `flaker run --gate release` |
| `flaker debug doctor` | `flaker doctor` |
| `flaker analyze kpi` | `flaker status` |

## What does not need to change

- `[profile.local]`, `[profile.ci]`, `[profile.scheduled]` in `flaker.toml`
- CI scripts that already use custom profiles
- detailed commands under `analyze`, `debug`, `policy`, and `dev`
- sampling strategy names such as `affected`, `hybrid`, `weighted`, or `full`

So the goal is to keep `0.4.x` behavior working while making the entrypoint thinner in `0.5.x`.

## Gate to profile mapping

`gate` is not a replacement backend. It is a thinner user-facing surface over the existing profiles.

| Gate | Underlying profile |
|---|---|
| `iteration` | `profile.local` |
| `merge` | `profile.ci` |
| `release` | `profile.scheduled` |

If you rely on advanced or custom profiles, keep using `--profile`.

## Script migration examples

### Local run

```bash
# before
pnpm flaker run --profile local

# after
pnpm flaker run --gate iteration
```

### Dry-run with explanation

```bash
# before
pnpm flaker run --profile local --dry-run --explain

# after
pnpm flaker run --gate iteration --dry-run --explain
```

### Health checks

```bash
# before
pnpm flaker analyze kpi
pnpm flaker debug doctor

# after
pnpm flaker status
pnpm flaker doctor
```

## CI guidance

If your `0.4.x` CI already uses `--profile ci` or custom profiles, you do not need to switch immediately.

Recommended path:

1. move user-facing README examples and package scripts to `--gate`
2. leave CI on `--profile` for now if it is already stable
3. migrate only the jobs that are naturally expressible as `--gate merge` or `--gate release`

## Documentation entrypoints

`0.5.x` splits docs by audience:

- day-to-day usage: [usage-guide.md](usage-guide.md)
- operations and rollout: [operations-guide.md](operations-guide.md)
- detailed reference: [how-to-use.md](how-to-use.md)

If you used to jump directly from the README into `how-to-use`, start with `usage-guide` first.

## Recommended verification

After upgrading:

```bash
pnpm flaker doctor
pnpm flaker run --gate iteration --dry-run --explain
pnpm flaker status
```

If you want to validate the CI-facing gate:

```bash
pnpm flaker run --gate merge
```

## Notes

- `0.5.x` adds a gate-oriented UX; it does not remove the profile-based API
- if you are upgrading from `0.2.0` or earlier, see [how-to-use.md#config-migration](how-to-use.md#config-migration) first
