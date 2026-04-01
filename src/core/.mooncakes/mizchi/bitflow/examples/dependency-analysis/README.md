# Dependency Analysis Example

This example shows how to use `mizchi/bitflow/workflow` as a dependency-aware
workflow engine.

## Files

- `workflow.star`: Starlark workflow definition
- `src/examples/main.mbt`: executable sample that
  - parses `workflow.star`
  - computes affected auto targets from changed paths
  - executes only selected targets + dependencies
- `project/`: mock monorepo tree used by `srcs` patterns

## Run

From repository root:

```bash
moon run src/examples -- \
  examples/dependency-analysis/workflow.star \
  examples/dependency-analysis/project/packages/lib-a/src/index.ts
```

Expected behavior:

- affected target: `lib-a:build`
- executed order: `core:build,lib-a:build`

Another scenario:

```bash
moon run src/examples -- \
  examples/dependency-analysis/workflow.star \
  examples/dependency-analysis/project/packages/app/src/main.ts
```

Expected behavior:

- affected target: `app:build`
- executed order: `core:build,lib-a:build,lib-b:build,app:build`
