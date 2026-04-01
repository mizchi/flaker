# bitflow

Workflow engine core for `bit workspace`.

This repository hosts reusable, pure workflow logic that is being migrated out
from `mizchi/bit`:

- DAG validation
- topological ordering
- affected-node expansion
- flow cache key / fingerprint generation (`flow_fingerprint`, `flow_task_fingerprint`, `plan_task_cache`)
- direct IR execution API
- Starlark subset parser (`workflow/node/task/entrypoint/load`)
- environment-agnostic adapters (`WorkflowAdapter`, `FsAdapter`, `CommandAdapter`)

## Package

- `mizchi/bitflow/workflow`
- `mizchi/bitflow/starlark` (Starlark parser and semantic frontend)

## Quick Commands

```bash
just           # check + test
just fmt       # format code
just check     # type check
just test      # run tests
just info      # generate type definition files
```

## CLI (Parser Check)

`src/main` now provides a small CLI that validates a workflow file with
Starlark `var/config` semantics, including external overrides.

```bash
moon run src/main -- path/to/workflow.star --var profile=prod
# or
BITFLOW_VAR_profile=prod moon run src/main -- path/to/workflow.star
```

Supported forms:

- `bitflow [check] <workflow.star> [--var KEY=VALUE]...`
- env override prefix: `BITFLOW_VAR_`

## Starlark Subset Contract

This project intentionally implements a Starlark-based DSL subset for workflow
definitions, not a full Starlark VM.

### Layered Model

The implementation is organized in three layers:

- **Language Core (Python/Starlark subset evaluator)**:
  expression parser + evaluator for primitive values, arithmetic, comparison,
  indexing/slicing, helper functions, and method calls.
- **Host API (Workflow DSL)**:
  top-level declarative calls (`workflow/node/task/entrypoint/var/config/load`)
  and argument contracts.
- **Execution Layer**:
  lowering to workflow IR, DAG validation/planning, execution, cache planning,
  and changed-path target selection.

- Supported top-level calls: `workflow`, `node`, `task` (`target` alias),
  `entrypoint`, `var`, `config`, `load`
- `var(required=True)` means the value must be provided by `config(...)` or
  external inputs (`--var` / `BITFLOW_VAR_...`)
- `var(default=...)` is still validated and bound, but does not satisfy the
  `required=True` contract by itself
- `load(...)` is supported only in fs parse mode and only as
  `load("path.star")` / `load(path="path.star")`
- `load` paths are normalized and must stay within workspace root (path escape
  via `..` is rejected)
- changed-path entry target selection matches both `task.srcs` and `task.outs`

### Supported Range (Workflow DSL Subset)

- **Program structure**:
  top-level call statements, simple assignments, and control statements
  (`if`, `for`, `while`) for call expansion.
  Control-transfer statements `return`, `break`, and `continue` are supported
  in control-flow suites (`break`/`continue` only inside loops).
  User-defined statement functions (`def name(...): ...`) are supported with
  keyword-argument invocation.
- **Top-level DSL calls**:
  `workflow`, `node`, `task` (`target` alias), `entrypoint`, `var`, `config`,
  `load`.
- **Literal / collection expressions**:
  `string`, `int`, `bool`, `None`, `list`, `dict`, `tuple`, and list
  comprehensions (`[expr for x in iter if cond]`) / dict comprehensions
  (`{k: v for x in iter if cond}`).
- **Operators**:
  arithmetic (`+`, `-`, `*`, `//`, `%`), logical (`and`, `or`, `not`),
  comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), chained comparisons,
  membership (`in`, `not in`), conditional expression (`a if cond else b`).
- **Access / call expressions**:
  indexing, slicing (`start:end[:step]`), helper-function calls, selected
  method-call syntax.
- **Practical compatibility**:
  semicolon-separated calls, trailing commas, single quotes.
  Control statements support both inline and indented block suites:
  `if cond: statement`, `for name in values: statement`,
  `while cond: statement`,
  `if/elif/else ...:\n  ...`, `for ...:\n  ...`, `while ...:\n  ...`.

### Out of Scope (Not Full Starlark VM)

- Set comprehensions, exceptions, lambdas, and mutable runtime objects.
- General-purpose module system; `load` is constrained for workflow files
  (`parse_from_fs*` path only, workspace-root bounded).
- Arbitrary host side effects during evaluation; execution side effects are
  handled by workflow execution layer / adapters.

## Example

```mbt
import {
  "mizchi/bitflow/workflow" @wf,
}

let nodes = [
  @wf.new_node("root", []),
  @wf.new_node("dep", ["root"]),
]

let ordered = @wf.topological_nodes(nodes)
let issues = @wf.graph_issues(nodes)
```

## Examples

- dependency analysis workflow sample:
  `examples/dependency-analysis/README.md`

## License

Apache-2.0
