# workflow API

## topological_nodes

Returns nodes in dependency-first order.

```mbt check
///|
test {
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let ordered = topological_nodes(nodes)
  inspect(ordered.length(), content="2")
  inspect(ordered[0].id, content="root")
}
```

## graph_issues

Reports graph issues such as unknown dependencies and cycles.

```mbt check
///|
test {
  let nodes = [new_node("a", ["missing"])]
  let issues = graph_issues(nodes)
  inspect(issues.length() > 0, content="true")
}
```

## flow_fingerprint

Builds a deterministic fingerprint string from task, command, node, and signatures.

```mbt check
///|
test {
  let node = new_node("pkg", ["root"])
  let signatures : Map[String, String] = { "pkg": "pkg-1", "root": "root-1" }
  let fp = flow_fingerprint("test", "just test", node, signatures)
  inspect(fp.contains("task=test"), content="true")
}
```

## flow_task_fingerprint

Builds a deterministic fingerprint for a concrete `FlowTask` including
`needs/srcs/outs/env/cwd/trigger_mode`, suitable for local task cache keys.

```mbt check
///|
test {
  let node = new_node("pkg", [])
  let task = new_task(
    "pkg:build",
    "pkg",
    "pnpm build",
    ["dep:a"],
    srcs=["packages/pkg/**"],
    outs=["packages/pkg/dist/**"],
    env={ "NODE_ENV": "test" },
    cwd="packages/pkg",
    trigger_mode="auto",
  )
  let signatures : Map[String, String] = { "pkg": "pkg-1", "dep:a": "dep-1" }
  let fp = flow_task_fingerprint(task, node, signatures)
  inspect(fp.contains("task=pkg:build"), content="true")
  inspect(fp.contains("out:packages/pkg/dist/**"), content="true")
}
```

## plan_task_cache

Plans task cache hit/miss decisions from current signatures and previous cache
entries.

```mbt check
///|
test {
  let nodes = [new_node("root", [])]
  let tasks = [new_task("root:build", "root", "build", [])]
  let ir = new_ir("ci", nodes, tasks)
  let signatures : Map[String, String] = { "root": "sig-root" }
  let fp = flow_task_fingerprint(tasks[0], nodes[0], signatures)
  let cache : Map[String, String] = {}
  cache[flow_cache_key("root:build", "root")] = fp
  let planned = plan_task_cache(ir, signatures, cache)
  inspect(planned.issues.length(), content="0")
  inspect(planned.decisions.length(), content="1")
  inspect(planned.decisions[0].hit, content="true")
}
```

## execute_ir

Construct IR directly from MoonBit API and execute with a callback runner.

```mbt check
///|
test {
  let nodes = [new_node("root", [])]
  let tasks = [new_task("root:build", "root", "build", [])]
  let ir = new_ir("ci", nodes, tasks)
  let run_task = fn(_task : FlowTask) { (true, "") }
  let result = execute_ir(ir, run_task)
  inspect(result.ok, content="true")
  inspect(result.steps[0].status, content="success")
}
```

## parse

Parse a simple Starlark subset for workflow config.

```mbt check
///|
test {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  inspect(parsed.errors.length(), content="0")
  inspect(parsed.ir.tasks.length(), content="1")
}
```

## load (fs parse mode)

`parse_from_fs` / `execute_from_fs` supports
`load("path.star")` to split workflow definitions.

`load` is a DSL subset feature:

- supported forms are `load("path.star")` and `load(path="path.star")`
- resolved paths are normalized
- paths outside workspace root are rejected

```mbt check
///|
test {
  let root =
    #|load("defs/common.star")
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:test"])
  let common =
    #|node(id="dep", depends_on=["root"])
    #|task(id="root:test", node="dep", cmd="test", needs=["root:build"])
  let adapter = WorkflowAdapter::new(
    FsAdapter::memory_with({ "workflow.star": root, "defs/common.star": common }),
    CommandAdapter::none(),
  )
  let parsed = parse_from_fs("workflow.star", adapter)
  inspect(parsed.errors.length(), content="0")
  inspect(parsed.ir.tasks.length(), content="2")
}
```

## adapter APIs

Use `WorkflowAdapter` to wire command and filesystem behavior from outside.
`CommandAdapter::new` receives `(cmd, cwd, env)` so task-level `cwd` / `env`
can be consumed by the host runner.

```mbt check
///|
test {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let adapter = WorkflowAdapter::new(
    FsAdapter::memory_with({ "workflow.star": src }),
    CommandAdapter::new(fn(
      _cmd : String,
      _cwd : String?,
      _env : Map[String, String],
    ) {
      command_success(stdout="ok")
    }),
  )
  let result = execute_from_fs("workflow.star", adapter)
  inspect(result.ok, content="true")
  inspect(write_execution_report("report.txt", result, adapter), content="true")
}
```
