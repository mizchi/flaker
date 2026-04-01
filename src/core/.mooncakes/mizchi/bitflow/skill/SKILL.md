---
name: bitflow-dependency-analysis-example
description: Use this skill when adding or updating the dependency-analysis example in this repository, including workflow.star design, changed-path target selection, and executable validation with moon run.
---

# Bitflow Dependency Analysis Example

## When to Use

Use this skill when the user asks to:

- add or extend dependency-aware workflow examples
- show affected targets from changed paths
- validate execution order of selected tasks and dependencies

## Repository Layout Contract

- Put example data under `examples/dependency-analysis/`
- Keep executable code under `src/examples/` (Moon package path)
- Keep fixture data for parser/execution tests under `fixtures/workflow/`

## Required Files for the Example

- `examples/dependency-analysis/workflow.star`
- `examples/dependency-analysis/project/...` (mock monorepo tree for `srcs`/`outs` patterns)
- `examples/dependency-analysis/README.md`
- `src/examples/main.mbt`
- `src/examples/main_test.mbt`
- `src/examples/moon.pkg`

## Workflow DSL Guidance

- Use `trigger="auto"` for tasks that should be selected by changed paths
- Use `trigger="manual"` for tasks that must not be auto-selected
- Include both `srcs` and `outs` when changed files may come from source or build output
- Keep `entrypoint(...)` explicit even for examples

## Example Validation Commands

Run from repository root:

```bash
moon run src/examples -- \
  examples/dependency-analysis/workflow.star \
  examples/dependency-analysis/project/packages/lib-a/src/index.ts
```

Expected:

- `targets=lib-a:build`
- `order=core:build,lib-a:build`

Second scenario:

```bash
moon run src/examples -- \
  examples/dependency-analysis/workflow.star \
  examples/dependency-analysis/project/packages/app/src/main.ts
```

Expected:

- `targets=app:build`
- `order=core:build,lib-a:build,lib-b:build,app:build`

## Quality Gate

After updates, run:

```bash
just fmt
just test
just check
just target=native check test
```
