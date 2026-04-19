# Contributing to flaker

This document covers local development, sibling-repo dogfooding, and the MoonBit/TypeScript build pipeline. For user-facing usage, see [README.md](../README.md).

## Repository layout

- `src/cli/` — TypeScript CLI (commander)
- `src/` — MoonBit core library
- `tests/` — vitest tests
- `docs/` — user docs
- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans

## Build

```bash
pnpm install
pnpm build
```

The build produces `dist/cli/main.js` (bundled by Rolldown) and `dist/moonbit/flaker.js` (the MoonBit JS target, consumed by the CLI).

## Sibling checkout dogfood

When you want to test flaker against another project on your machine without publishing to npm:

```bash
# one-time setup in the flaker repo
pnpm install

# from the sibling project root (e.g. ../sample-webapp-2026)
node ../flaker/scripts/dev-cli.mjs run --dry-run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

`scripts/dev-cli.mjs` reuses `dist/cli/main.js` when it is current, auto-builds when sources are newer, and preserves the caller's cwd through `INIT_CWD`. Use `--rebuild` to force a fresh build.

If multiple local commands share the same `.flaker/data.duckdb`, run them sequentially — DuckDB is single-writer.

## MoonBit / TypeScript fallback

The CLI expects `dist/moonbit/flaker.js` for core algorithms. When it is missing, a TypeScript fallback in `src/cli/core/loader.ts` loads a plain-JS implementation of the same contract. See `src/cli/core/` for the interface.

To build only the MoonBit side: `moon build --target js`.

## Tests

```bash
pnpm test                    # full suite
pnpm test <path>             # specific test
```

The vitest config caps worker forks to 4 and sets a 60s global timeout to stabilize the DuckDB + MoonBit core tests under parallel load. A global setup hook generates parquet fixtures on first run.

New CLI behaviors should come with a test under `tests/cli/`. Prefer integration tests that invoke `node dist/cli/main.js ...` through `execSync` over deep unit tests when exercising user-visible behavior.

## Commit style

This repository uses short, imperative commit subjects (`Verb subject`). When a commit implements a design doc, reference the spec path in the body.

## Releases

The 0.x line is released manually. Conventional-Commits messages still apply so the log is machine-readable later, but no release-please bot cuts PRs.

Manual release steps:

1. Branch: `fix/<version>-<slug>` or `feat/<version>-<slug>` off `main`.
2. Edit `package.json` `version` and the `.version(...)` call in `src/cli/main.ts` to the new version.
3. Add a `CHANGELOG.md` entry under a new `## [<version>] - YYYY-MM-DD` heading, grouped by Added / Changed / Fixed / Removed.
4. `pnpm build && pnpm test && pnpm typecheck` — all must pass.
5. Commit, push, open PR, merge.
6. After merge: `git tag v<version> <merge-sha> && git push origin v<version>`.
7. `gh release create v<version> --title "v<version>" --notes-from-tag` (or `--notes-file` for a curated body).
8. Publishing to npm is handled by `.github/workflows/publish.yml` on tag push (OIDC, Nix-based).

See `CHANGELOG.md` for the version history.
