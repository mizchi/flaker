///|
/// Parse a Starlark workflow definition and find affected test targets
/// given a list of changed file paths.
/// Returns task IDs that are directly matched or transitively dependent.
pub fn resolve_affected(
  workflow_text : String,
  changed_paths : Array[String],
) -> Array[String] {
  let parse_result = @wf.parse(workflow_text)
  if parse_result.errors.length() > 0 {
    return []
  }
  let ir = parse_result.ir

  // Get task IDs that directly match changed paths via srcs/outs patterns
  let targets = @wf.entry_targets_for_changed_paths(ir, changed_paths)

  // Build task-level graph nodes from task needs for expansion
  let task_nodes : Array[@wf.FlowNode] = []
  for task in ir.tasks {
    task_nodes.push(@wf.new_node(task.id, task.needs))
  }

  // Expand to include transitive dependents through task needs
  let initial : Map[String, Bool] = {}
  for t in targets {
    initial[t] = true
  }
  let expanded = @wf.expand_affected_nodes(task_nodes, initial)

  let result : Array[String] = []
  for key, _ in expanded {
    result.push(key)
  }
  result
}
