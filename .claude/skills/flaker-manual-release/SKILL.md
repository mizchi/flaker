---
name: flaker-manual-release
description: Cut a flaker patch/minor release manually — branch → bump 3 version sites → CHANGELOG → PR → merge → tag → GitHub release → publish.yml OIDC publish. Use when the user asks to "release flaker N.N.N", "bump flaker", "publish flaker", or runs the equivalent in 日本語 ("flaker をリリース", "patch bump"). MAINTAINER-ONLY — only the npm OIDC trusted publisher (mizchi) can complete the publish step. Does NOT apply to chaosbringer (release-please) or other repos.
---

# flaker manual release

Procedure encoded from `docs/contributing.md` § Releases plus the 0.10.7 and 0.11.1 release sessions. The 0.x line is hand-released — `release-please` was removed in 0.10.5 (see commit `c5da2ea` and ADR if asked why).

## Pre-flight

1. `git status` clean on `main`. `git pull --ff-only`.
2. Pick the bump type:
   - **patch** (X.Y.Z → X.Y.Z+1): bug fix, doc update, version-string-only fix
   - **minor** (X.Y.0 → X.Y+1.0): a `feat:` commit landed since the last release
   - **major**: ASK first; rare in the 0.x line.
3. Branch name: `fix/<version>-<slug>` (patch) or `feat/<version>-<slug>` (minor) per contributing.md. Slug 1-3 words describing the dominant change.

## Bump 3 places (one is easy to miss)

| File | Edit |
|---|---|
| `package.json` | `"version": "<new>"` |
| `src/cli/main.ts` | `.version("<new>")` ← **forgotten in 0.11.0**, caused a 0.11.1 patch detour. Always grep `\.version\(` after the bump. |
| `CHANGELOG.md` | Convert `## Unreleased` → `## <version>` heading. Match the existing per-version section format (no date suffix in the 0.x line). |

## Build / verify

```bash
pnpm typecheck   # tsc --noEmit
pnpm build       # writes dist/cli/main.js + dist/moonbit/flaker.js
pnpm test        # vitest run — full suite
```

All three MUST pass before the PR. If `tests/commands/ops-weekly.test.ts` fails locally but CI is green, that is/was the date-sensitive flaky-tag-triage `now` bug fixed in 0.10.7 — not your release.

## PR → merge

1. One commit: `chore(release): <version>` subject. Body summarises CHANGELOG.
2. `gh pr create --title "chore(release): <version>" --body ...`
3. Wait for CI: `test`, `core-tests (with_moonbit_build)`, `core-tests (without_moonbit_build)`. All must be SUCCESS.
4. `gh pr merge <N> --merge --subject "Merge pull request #<N> from ..."` (merge-commit style; matches existing main history).
5. `git checkout main && git pull --ff-only` → note the merge SHA from `git log --oneline -3`.

## Tag + GitHub release + publish

```bash
git tag v<version> <merge-sha>
git push origin v<version>

gh release create v<version> \
  --title "v<version>" \
  --notes "<curated body — typically a tightened version of the CHANGELOG entry>"
```

`publish.yml` fires on `release: published`, i.e. on `gh release create`, **not** on the tag push (OIDC trusted publishing + npm provenance). Creating the release is the publish: confirm with the maintainer before running it. Wait for it:

```bash
gh run list --workflow publish.yml --limit 1 --json status,conclusion
# Or, blocking:
until [ "$(gh run view <run-id> --json status -q .status)" = "completed" ]; do sleep 15; done
gh run view <run-id> --json conclusion -q .conclusion   # expect: success
```

## Verify the published version

```bash
npm view @mizchi/flaker version            # must equal <new>
npx @mizchi/flaker@<version> --version     # must equal <new> too — THIS catches the .version() miss
```

If `npx ... --version` reports the previous version while `npm view version` is correct, the `src/cli/main.ts` bump was missed. Roll forward with a tiny patch release — **do NOT retag**, npm doesn't allow re-publishing the same version and consumers may have already pulled.

## Gotchas

- **chaosbringer's `flaker-merge` advisory check** is a pre-existing flake on its side, unrelated to flaker releases. Ignore the FAILURE on that check when merging flaker PRs.
- **`gh release create` requires the tag to already be on origin** — don't try to create the release before pushing the tag.
- **`npm view` can 404 for a minute or two after `+ @mizchi/flaker@<version>`** appears in the publish log. Poll `npm view @mizchi/flaker@<version> version` before concluding the publish failed, and run the `npx` check from an empty directory: inside the flaker checkout `npx` can resolve a local binary instead of the registry package.
- **Don't skip CHANGELOG** — release-please was removed in 0.10.5, so nothing else generates one. Missing entries are user-visible.

## What this skill is NOT for

- chaosbringer release (use release-please-driven flow there)
- One-off `npm publish` from a workstation (the OIDC flow is mandatory; manual `npm publish` from a laptop will fail without the trusted-publisher token)
