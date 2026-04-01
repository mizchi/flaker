///|
pub struct FlowTask {
  id : String
  node : String
  cmd : String
  needs : Array[String]
  required : Bool
  srcs : Array[String]
  outs : Array[String]
  env : Map[String, String]
  cwd : String
  trigger_mode : String
}

///|
pub struct FlowIr {
  name : String
  max_parallel : Int
  nodes : Array[FlowNode]
  tasks : Array[FlowTask]
  entry_targets : Array[String]
}

///|
pub struct FlowStep {
  id : String
  status : String
  required : Bool
  message : String
}

///|
pub struct FlowExecutionResult {
  ok : Bool
  state : String
  order : Array[String]
  steps : Array[FlowStep]
  issues : Array[String]
}

///|
pub struct FlowTaskCacheDecision {
  id : String
  cache_key : String
  fingerprint : String
  hit : Bool
}

///|
pub struct FlowTaskCachePlanResult {
  decisions : Array[FlowTaskCacheDecision]
  issues : Array[String]
}

///|
pub struct StarlarkParseResult {
  ir : FlowIr
  errors : Array[String]
}

///|
pub struct ExternalInputParseResult {
  values : Map[String, String]
  errors : Array[String]
}

///|
fn convert_parse_result(
  parsed : @starlark.StarlarkParseResult,
) -> StarlarkParseResult {
  let nodes : Array[FlowNode] = []
  for node in parsed.workflow.nodes {
    nodes.push(new_node(node.id, node.depends_on, required=node.required))
  }
  let tasks : Array[FlowTask] = []
  for task in parsed.workflow.tasks {
    tasks.push(
      new_task(
        task.id,
        task.node,
        task.cmd,
        task.needs,
        required=task.required,
        srcs=task.srcs,
        outs=task.outs,
        env=task.env,
        cwd=task.cwd,
        trigger_mode=task.trigger_mode,
      ),
    )
  }
  {
    ir: new_ir(
      parsed.workflow.name,
      nodes,
      tasks,
      entry_targets=parsed.workflow.entry_targets,
      max_parallel=parsed.workflow.max_parallel,
    ),
    errors: parsed.errors,
  }
}

///|
fn trim_ascii_space(text : String) -> String {
  let mut start = 0
  let mut end = text.length()
  while start < end {
    let ch = text.unsafe_get(start)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      start += 1
    } else {
      break
    }
  }
  while end > start {
    let ch = text.unsafe_get(end - 1)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      end -= 1
    } else {
      break
    }
  }
  if start == 0 && end == text.length() {
    text
  } else {
    String::unsafe_substring(text, start~, end~)
  }
}

///|
fn parse_external_input_assignment(
  raw : String,
  source : String,
  errors : Array[String],
) -> (String, String)? {
  guard raw.find("=") is Some(eq_idx) else {
    errors.push(source + " must be key=value")
    return None
  }
  let name = trim_ascii_space(
    String::unsafe_substring(raw, start=0, end=eq_idx),
  )
  if name.length() == 0 {
    errors.push(source + " key is empty")
    return None
  }
  let value = trim_ascii_space(
    String::unsafe_substring(raw, start=eq_idx + 1, end=raw.length()),
  )
  Some((name, value))
}

///|
pub fn parse_external_inputs(
  cli_args : Array[String],
  env : Map[String, String],
  cli_flag? : String = "--var",
  env_prefix? : String = "BITFLOW_VAR_",
) -> ExternalInputParseResult {
  let values : Map[String, String] = {}
  let errors : Array[String] = []

  for key, value in env {
    if not(key.has_prefix(env_prefix)) {
      continue
    }
    let name = String::unsafe_substring(
      key,
      start=env_prefix.length(),
      end=key.length(),
    )
    if name.length() == 0 {
      errors.push("env var key is empty for prefix '\{env_prefix}'")
      continue
    }
    values[name] = value
  }

  let flag_with_equal = cli_flag + "="
  let mut idx = 0
  while idx < cli_args.length() {
    let arg = cli_args[idx]
    if arg == cli_flag {
      if idx + 1 >= cli_args.length() {
        errors.push("cli flag '\{cli_flag}' expects key=value")
        idx += 1
        continue
      }
      let raw = cli_args[idx + 1]
      match parse_external_input_assignment(raw, "cli arg '\{raw}'", errors) {
        Some((name, value)) => values[name] = value
        None => ()
      }
      idx += 2
      continue
    }
    if arg.has_prefix(flag_with_equal) {
      let raw = String::unsafe_substring(
        arg,
        start=flag_with_equal.length(),
        end=arg.length(),
      )
      match parse_external_input_assignment(raw, "cli arg '\{arg}'", errors) {
        Some((name, value)) => values[name] = value
        None => ()
      }
      idx += 1
      continue
    }
    idx += 1
  }
  { values, errors }
}

///|
fn merge_parse_errors(
  parsed : StarlarkParseResult,
  prepended_errors : Array[String],
) -> StarlarkParseResult {
  if prepended_errors.length() == 0 {
    return parsed
  }
  let errors : Array[String] = []
  for err in prepended_errors {
    errors.push(err)
  }
  for err in parsed.errors {
    errors.push(err)
  }
  { ir: parsed.ir, errors }
}

///|
pub fn new_task(
  id : String,
  node : String,
  cmd : String,
  needs : Array[String],
  required? : Bool = true,
  srcs? : Array[String] = [],
  outs? : Array[String] = [],
  env? : Map[String, String] = {},
  cwd? : String = "",
  trigger_mode? : String = "auto",
) -> FlowTask {
  { id, node, cmd, needs, required, srcs, outs, env, cwd, trigger_mode }
}

///|
pub fn new_ir(
  name : String,
  nodes : Array[FlowNode],
  tasks : Array[FlowTask],
  entry_targets? : Array[String] = [],
  max_parallel? : Int = 1,
) -> FlowIr {
  { name, max_parallel, nodes, tasks, entry_targets }
}

///|
fn sorted_strings(values : Array[String]) -> Array[String] {
  let remaining : Array[String] = []
  for value in values {
    remaining.push(value)
  }
  let sorted : Array[String] = []
  while remaining.length() > 0 {
    let mut min_idx = 0
    let mut idx = 1
    while idx < remaining.length() {
      if String::compare(remaining[idx], remaining[min_idx]) < 0 {
        min_idx = idx
      }
      idx += 1
    }
    sorted.push(remaining[min_idx])
    let next_remaining : Array[String] = []
    let mut keep_idx = 0
    while keep_idx < remaining.length() {
      if keep_idx != min_idx {
        next_remaining.push(remaining[keep_idx])
      }
      keep_idx += 1
    }
    remaining.clear()
    for value in next_remaining {
      remaining.push(value)
    }
  }
  sorted
}

///|
fn sorted_env_keys(env : Map[String, String]) -> Array[String] {
  let keys : Array[String] = []
  for key, _ in env {
    keys.push(key)
  }
  sorted_strings(keys)
}

///|
pub fn flow_task_fingerprint(
  task : FlowTask,
  node : FlowNode,
  signatures : Map[String, String],
) -> String {
  let buf = StringBuilder::new()
  buf.write_string(flow_fingerprint(task.id, task.cmd, node, signatures))
  buf.write_string("\nrequired=")
  buf.write_string(if task.required { "true" } else { "false" })
  buf.write_string("\nnode_ref=")
  buf.write_string(task.node)
  buf.write_string("\ncwd=")
  buf.write_string(task.cwd)
  buf.write_string("\ntrigger=")
  buf.write_string(task.trigger_mode)
  for dep in sorted_strings(task.needs) {
    buf.write_string("\nneed:")
    buf.write_string(dep)
  }
  for src in sorted_strings(task.srcs) {
    buf.write_string("\nsrc:")
    buf.write_string(src)
  }
  for out in sorted_strings(task.outs) {
    buf.write_string("\nout:")
    buf.write_string(out)
  }
  for key in sorted_env_keys(task.env) {
    buf.write_string("\nenv:")
    buf.write_string(key)
    buf.write_string("=")
    buf.write_string(task.env.get(key).unwrap_or(""))
  }
  buf.to_string()
}

///|
fn task_node_map(tasks : Array[FlowTask]) -> Map[String, FlowTask] {
  let result : Map[String, FlowTask] = {}
  for task in tasks {
    result[task.id] = task
  }
  result
}

///|
fn task_as_graph_nodes(tasks : Array[FlowTask]) -> Array[FlowNode] {
  let nodes : Array[FlowNode] = []
  for task in tasks {
    nodes.push(new_node(task.id, task.needs, required=task.required))
  }
  nodes
}

///|
fn node_id_map(nodes : Array[FlowNode]) -> Map[String, FlowNode] {
  let mapped : Map[String, FlowNode] = {}
  for node in nodes {
    mapped[node.id] = node
  }
  mapped
}

///|
fn selected_task_set(ir : FlowIr) -> Map[String, Bool] {
  let selected : Map[String, Bool] = {}
  if ir.entry_targets.length() == 0 {
    for task in ir.tasks {
      selected[task.id] = true
    }
    return selected
  }
  let task_map = task_node_map(ir.tasks)
  let stack : Array[String] = []
  for target in ir.entry_targets {
    stack.push(target)
  }
  while stack.length() > 0 {
    let id = stack.pop().unwrap_or("")
    if id.length() == 0 || selected.get(id) is Some(_) {
      continue
    }
    selected[id] = true
    match task_map.get(id) {
      Some(task) =>
        for dep in task.needs {
          stack.push(dep)
        }
      None => ()
    }
  }
  selected
}

///|
fn is_valid_trigger_mode(mode : String) -> Bool {
  mode == "auto" || mode == "manual"
}

///|
fn wildcard_match(pattern : String, text : String) -> Bool {
  let mut p = 0
  let mut t = 0
  let mut star = -1
  let mut mark = 0
  while t < text.length() {
    if p < pattern.length() {
      let pc = pattern.unsafe_get(p)
      let tc = text.unsafe_get(t)
      if pc == '*' {
        star = p
        p += 1
        mark = t
        continue
      }
      if pc == tc {
        p += 1
        t += 1
        continue
      }
    }
    if star >= 0 {
      p = star + 1
      mark += 1
      t = mark
    } else {
      return false
    }
  }
  while p < pattern.length() && pattern.unsafe_get(p) == '*' {
    p += 1
  }
  p == pattern.length()
}

///|
fn patterns_match_changed_paths(
  patterns : Array[String],
  changed_paths : Array[String],
) -> Bool {
  if patterns.length() == 0 {
    return false
  }
  for pattern in patterns {
    for path in changed_paths {
      if wildcard_match(pattern, path) {
        return true
      }
    }
  }
  false
}

///|
fn task_matches_changed_paths(
  task : FlowTask,
  changed_paths : Array[String],
) -> Bool {
  let patterns : Array[String] = []
  for src in task.srcs {
    patterns.push(src)
  }
  for out in task.outs {
    patterns.push(out)
  }
  patterns_match_changed_paths(patterns, changed_paths)
}

///|
pub fn entry_targets_for_changed_paths(
  ir : FlowIr,
  changed_paths : Array[String],
) -> Array[String] {
  let targets : Array[String] = []
  if changed_paths.length() == 0 {
    return targets
  }
  for task in ir.tasks {
    if task.trigger_mode != "auto" {
      continue
    }
    if task_matches_changed_paths(task, changed_paths) {
      targets.push(task.id)
    }
  }
  targets
}

///|
pub fn ir_issues(ir : FlowIr) -> Array[String] {
  let issues : Array[String] = []
  if ir.max_parallel <= 0 {
    issues.push("workflow.max_parallel must be positive")
  }
  for issue in graph_issues(ir.nodes) {
    issues.push("node: " + issue)
  }
  let seen_task_ids : Map[String, Bool] = {}
  let known_node_ids = node_id_set(ir.nodes)
  for task in ir.tasks {
    if task.id.length() == 0 {
      issues.push("task id is empty")
    } else if seen_task_ids.get(task.id) is Some(_) {
      issues.push("duplicate task id '\{task.id}'")
    } else {
      seen_task_ids[task.id] = true
    }
    if known_node_ids.get(task.node) is None {
      issues.push("task '\{task.id}' targets unknown node '\{task.node}'")
    }
    if not(is_valid_trigger_mode(task.trigger_mode)) {
      issues.push(
        "task '\{task.id}' has invalid trigger_mode '\{task.trigger_mode}'",
      )
    }
  }
  let known_task_ids = task_node_map(ir.tasks)
  for task in ir.tasks {
    for dep in task.needs {
      if known_task_ids.get(dep) is None {
        issues.push("task '\{task.id}' depends on unknown task '\{dep}'")
      }
    }
  }
  let task_graph = task_as_graph_nodes(ir.tasks)
  if has_dependency_cycle(task_graph) {
    issues.push("task graph has a cycle")
  }
  for target in ir.entry_targets {
    if known_task_ids.get(target) is None {
      issues.push("entry target '\{target}' does not exist")
    }
  }
  issues
}

///|
pub fn plan_task_cache(
  ir : FlowIr,
  signatures : Map[String, String],
  cache_entries : Map[String, String],
) -> FlowTaskCachePlanResult {
  let issues = ir_issues(ir)
  if issues.length() > 0 {
    return { decisions: [], issues }
  }
  let selected = selected_task_set(ir)
  let ordered = topological_nodes(task_as_graph_nodes(ir.tasks))
  let tasks = task_node_map(ir.tasks)
  let nodes = node_id_map(ir.nodes)
  let decisions : Array[FlowTaskCacheDecision] = []
  for task_node in ordered {
    if selected.get(task_node.id) is None {
      continue
    }
    guard tasks.get(task_node.id) is Some(task) else { continue }
    guard nodes.get(task.node) is Some(node) else { continue }
    let cache_key = flow_cache_key(task.id, task.node)
    let fingerprint = flow_task_fingerprint(task, node, signatures)
    decisions.push({
      id: task.id,
      cache_key,
      fingerprint,
      hit: cache_entries.get(cache_key) == Some(fingerprint),
    })
  }
  { decisions, issues: [] }
}

///|
pub fn execute_ir(
  ir : FlowIr,
  run_task : (FlowTask) -> (Bool, String),
) -> FlowExecutionResult {
  let issues = ir_issues(ir)
  if issues.length() > 0 {
    return { ok: false, state: "invalid", order: [], steps: [], issues }
  }
  let selected = selected_task_set(ir)
  let task_map = task_node_map(ir.tasks)
  let selected_tasks : Array[FlowTask] = []
  for task in ir.tasks {
    if selected.get(task.id) is Some(_) {
      selected_tasks.push(task)
    }
  }
  let remaining_deps : Map[String, Int] = {}
  let dependents : Map[String, Array[String]] = {}
  for task in selected_tasks {
    remaining_deps[task.id] = 0
    dependents[task.id] = []
  }
  for task in selected_tasks {
    let mut dep_count = 0
    for dep in task.needs {
      if selected.get(dep) is Some(_) {
        dep_count += 1
        let next = dependents.get(dep).unwrap_or([])
        next.push(task.id)
        dependents[dep] = next
      }
    }
    remaining_deps[task.id] = dep_count
  }
  let ready_queue : Array[String] = []
  for task in selected_tasks {
    if remaining_deps.get(task.id).unwrap_or(0) == 0 {
      ready_queue.push(task.id)
    }
  }
  let mut ready_idx = 0
  let steps : Array[FlowStep] = []
  let order : Array[String] = []
  let success : Map[String, Bool] = {}
  let mut required_failed = false
  while ready_idx < ready_queue.length() {
    let batch_ids : Array[String] = []
    let mut slots = 0
    while ready_idx < ready_queue.length() && slots < ir.max_parallel {
      batch_ids.push(ready_queue[ready_idx])
      ready_idx += 1
      slots += 1
    }
    for id in batch_ids {
      order.push(id)
      guard task_map.get(id) is Some(task) else { continue }
      let blocked_deps : Array[String] = []
      for dep in task.needs {
        if selected.get(dep) is None {
          continue
        }
        if not(success.get(dep).unwrap_or(false)) {
          blocked_deps.push(dep)
        }
      }
      if blocked_deps.length() > 0 {
        steps.push({
          id: task.id,
          status: "blocked",
          required: task.required,
          message: "blocked by dependency: " + blocked_deps.join(", "),
        })
        success[task.id] = false
        if task.required {
          required_failed = true
        }
      } else {
        let (ok, message) = run_task(task)
        if ok {
          steps.push({
            id: task.id,
            status: "success",
            required: task.required,
            message,
          })
          success[task.id] = true
        } else {
          steps.push({
            id: task.id,
            status: "failed",
            required: task.required,
            message: if message.length() == 0 {
              "task failed"
            } else {
              message
            },
          })
          success[task.id] = false
          if task.required {
            required_failed = true
          }
        }
      }
      for dependent_id in dependents.get(id).unwrap_or([]) {
        let next = remaining_deps.get(dependent_id).unwrap_or(0) - 1
        remaining_deps[dependent_id] = next
        if next == 0 {
          ready_queue.push(dependent_id)
        }
      }
    }
  }
  {
    ok: not(required_failed),
    state: if required_failed {
      "partial_failed"
    } else {
      "completed"
    },
    order,
    steps,
    issues: [],
  }
}

///|
pub fn execute_ir_for_changed_paths(
  ir : FlowIr,
  changed_paths : Array[String],
  run_task : (FlowTask) -> (Bool, String),
) -> FlowExecutionResult {
  let targets = entry_targets_for_changed_paths(ir, changed_paths)
  if targets.length() == 0 {
    return { ok: true, state: "completed", order: [], steps: [], issues: [] }
  }
  let scoped = new_ir(
    ir.name,
    ir.nodes,
    ir.tasks,
    entry_targets=targets,
    max_parallel=ir.max_parallel,
  )
  execute_ir(scoped, run_task)
}

///|
pub fn parse(text : String) -> StarlarkParseResult {
  convert_parse_result(@starlark.parse(text))
}

///|
pub fn parse_with_inputs(
  text : String,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  convert_parse_result(@starlark.parse_with_inputs(text, external_inputs))
}

///|
pub fn parse_with_cli_env(
  text : String,
  cli_args : Array[String],
  env : Map[String, String],
  cli_flag? : String = "--var",
  env_prefix? : String = "BITFLOW_VAR_",
) -> StarlarkParseResult {
  let input_result = parse_external_inputs(
    cli_args,
    env,
    cli_flag~,
    env_prefix~,
  )
  let parsed = parse_with_inputs(text, input_result.values)
  merge_parse_errors(parsed, input_result.errors)
}

///|
pub fn execute(
  text : String,
  run_task : (FlowTask) -> (Bool, String),
) -> FlowExecutionResult {
  let parsed = parse(text)
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir(parsed.ir, run_task)
}

///|
pub fn execute_with_inputs(
  text : String,
  external_inputs : Map[String, String],
  run_task : (FlowTask) -> (Bool, String),
) -> FlowExecutionResult {
  let parsed = parse_with_inputs(text, external_inputs)
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir(parsed.ir, run_task)
}

///|
pub fn execute_with_cli_env(
  text : String,
  cli_args : Array[String],
  env : Map[String, String],
  run_task : (FlowTask) -> (Bool, String),
  cli_flag? : String = "--var",
  env_prefix? : String = "BITFLOW_VAR_",
) -> FlowExecutionResult {
  let parsed = parse_with_cli_env(text, cli_args, env, cli_flag~, env_prefix~)
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir(parsed.ir, run_task)
}

///|
fn command_result_message(result : CommandResult) -> String {
  if result.ok() {
    result.stdout
  } else if result.stderr.length() > 0 {
    result.stderr
  } else {
    result.stdout
  }
}

///|
pub fn execute_ir_with_adapter(
  ir : FlowIr,
  adapter : WorkflowAdapter,
) -> FlowExecutionResult {
  execute_ir(ir, fn(task : FlowTask) {
    let cwd = if task.cwd.length() == 0 { None } else { Some(task.cwd) }
    let result = (adapter.cmd.run)(task.cmd, cwd, task.env)
    (result.ok(), command_result_message(result))
  })
}

///|
pub fn parse_from_fs(
  path : String,
  adapter : WorkflowAdapter,
) -> StarlarkParseResult {
  convert_parse_result(
    @starlark.parse_from_fs(path, adapter.fs.exists, adapter.fs.read_text),
  )
}

///|
pub fn parse_from_fs_with_inputs(
  path : String,
  adapter : WorkflowAdapter,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  convert_parse_result(
    @starlark.parse_from_fs_with_inputs(
      path,
      adapter.fs.exists,
      adapter.fs.read_text,
      external_inputs,
    ),
  )
}

///|
pub fn parse_from_fs_with_cli_env(
  path : String,
  adapter : WorkflowAdapter,
  cli_args : Array[String],
  env : Map[String, String],
  cli_flag? : String = "--var",
  env_prefix? : String = "BITFLOW_VAR_",
) -> StarlarkParseResult {
  let input_result = parse_external_inputs(
    cli_args,
    env,
    cli_flag~,
    env_prefix~,
  )
  let parsed = parse_from_fs_with_inputs(path, adapter, input_result.values)
  merge_parse_errors(parsed, input_result.errors)
}

///|
pub fn execute_from_fs(
  path : String,
  adapter : WorkflowAdapter,
) -> FlowExecutionResult {
  let parsed = parse_from_fs(path, adapter)
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir_with_adapter(parsed.ir, adapter)
}

///|
pub fn execute_from_fs_with_inputs(
  path : String,
  adapter : WorkflowAdapter,
  external_inputs : Map[String, String],
) -> FlowExecutionResult {
  let parsed = parse_from_fs_with_inputs(path, adapter, external_inputs)
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir_with_adapter(parsed.ir, adapter)
}

///|
pub fn execute_from_fs_with_cli_env(
  path : String,
  adapter : WorkflowAdapter,
  cli_args : Array[String],
  env : Map[String, String],
  cli_flag? : String = "--var",
  env_prefix? : String = "BITFLOW_VAR_",
) -> FlowExecutionResult {
  let parsed = parse_from_fs_with_cli_env(
    path,
    adapter,
    cli_args,
    env,
    cli_flag~,
    env_prefix~,
  )
  if parsed.errors.length() > 0 {
    return {
      ok: false,
      state: "invalid",
      order: [],
      steps: [],
      issues: parsed.errors,
    }
  }
  execute_ir_with_adapter(parsed.ir, adapter)
}

///|
fn render_execution_report(result : FlowExecutionResult) -> String {
  let buf = StringBuilder::new()
  buf.write_string("state=")
  buf.write_string(result.state)
  buf.write_string("\n")
  buf.write_string("ok=")
  buf.write_string(if result.ok { "true" } else { "false" })
  buf.write_string("\n")
  for step in result.steps {
    buf.write_string(step.id)
    buf.write_string(":")
    buf.write_string(step.status)
    if step.message.length() > 0 {
      buf.write_string(":")
      buf.write_string(step.message)
    }
    buf.write_string("\n")
  }
  if result.issues.length() > 0 {
    for issue in result.issues {
      buf.write_string("issue:")
      buf.write_string(issue)
      buf.write_string("\n")
    }
  }
  buf.to_string()
}

///|
pub fn write_execution_report(
  path : String,
  result : FlowExecutionResult,
  adapter : WorkflowAdapter,
) -> Bool {
  (adapter.fs.write_text)(path, render_execution_report(result))
}
