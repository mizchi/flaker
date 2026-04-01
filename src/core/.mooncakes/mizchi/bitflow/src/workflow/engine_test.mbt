///|
fn run_ok(_task : FlowTask) -> (Bool, String) {
  (true, "")
}

///|
fn cache_hit_map(result : FlowTaskCachePlanResult) -> Map[String, Bool] {
  let hits : Map[String, Bool] = {}
  for decision in result.decisions {
    hits[decision.id] = decision.hit
  }
  hits
}

///|
struct TaskScenario {
  task_id : String
  ok : Bool
  message : String
}

///|
fn task_scenario_success(
  task_id : String,
  message? : String = "",
) -> TaskScenario {
  { task_id, ok: true, message }
}

///|
fn task_scenario_failure(
  task_id : String,
  message? : String = "task failed",
) -> TaskScenario {
  { task_id, ok: false, message }
}

///|
struct MockTaskRunner {
  run : (FlowTask) -> (Bool, String)
  called_ids : () -> Array[String]
}

///|
fn mock_task_runner(
  scenarios : Array[TaskScenario],
  default_ok? : Bool = true,
  default_message? : String = "",
) -> MockTaskRunner {
  let outcomes : Map[String, (Bool, String)] = {}
  for scenario in scenarios {
    outcomes[scenario.task_id] = (scenario.ok, scenario.message)
  }
  let called : Array[String] = []
  {
    run: fn(task : FlowTask) {
      called.push(task.id)
      match outcomes.get(task.id) {
        Some(result) => result
        None => (default_ok, default_message)
      }
    },
    called_ids: fn() {
      let snapshot : Array[String] = []
      for id in called {
        snapshot.push(id)
      }
      snapshot
    },
  }
}

///|
test "workflow engine: mock runner can describe task outcomes and execution order" {
  let runner = mock_task_runner([
    task_scenario_success("root:build"),
    task_scenario_failure("dep:test", message="dep failed"),
  ])
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let tasks = [
    new_task("root:build", "root", "build", []),
    new_task("dep:test", "dep", "test", ["root:build"]),
  ]
  let ir = new_ir("ci", nodes, tasks, entry_targets=["dep:test"])
  let result = execute_ir(ir, runner.run)
  assert_eq(result.ok, false)
  assert_eq(result.steps.length(), 2)
  assert_eq(result.steps[0].status, "success")
  assert_eq(result.steps[1].status, "failed")
  assert_eq((runner.called_ids)().join(","), "root:build,dep:test")
}

///|
fn trim_ascii_space(s : String) -> String {
  let mut start = 0
  let mut end = s.length()
  while start < end {
    let ch = s.unsafe_get(start)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      start += 1
    } else {
      break
    }
  }
  while end > start {
    let ch = s.unsafe_get(end - 1)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      end -= 1
    } else {
      break
    }
  }
  if start == 0 && end == s.length() {
    s
  } else {
    String::unsafe_substring(s, start~, end~)
  }
}

///|
fn parse_chunk_expected_literal(raw : String) -> String? {
  let text = trim_ascii_space(raw)
  if text.length() < 2 {
    return None
  }
  if text.has_prefix("\"") && text.has_suffix("\"") {
    return Some(String::unsafe_substring(text, start=1, end=text.length() - 1))
  }
  let first = text.unsafe_get(0)
  let last = text.unsafe_get(text.length() - 1)
  if first.to_int() == 96 && last.to_int() == 96 {
    return Some(String::unsafe_substring(text, start=1, end=text.length() - 1))
  }
  None
}

///|
fn parse_chunk_source_line(line : String) -> (String, String?) {
  match line.find("###") {
    Some(idx) => {
      let code = trim_ascii_space(
        String::unsafe_substring(line, start=0, end=idx),
      )
      let expected_text = String::unsafe_substring(
        line,
        start=idx + 3,
        end=line.length(),
      )
      (code, parse_chunk_expected_literal(expected_text))
    }
    None => (trim_ascii_space(line), None)
  }
}

///|
fn parse_go_chunked_cases(text : String) -> Array[(String, String?)] {
  let lines : Array[String] = []
  for view in text.split("\n") {
    lines.push(view.to_string())
  }
  // Sentinel delimiter to flush last case.
  lines.push("---")

  let cases : Array[(String, String?)] = []
  let mut current_lines : Array[String] = []
  let mut current_expected : String? = None

  for raw_line in lines {
    let trimmed = trim_ascii_space(raw_line)
    if trimmed == "---" {
      if current_lines.length() > 0 {
        cases.push((current_lines.join("\n"), current_expected))
      }
      current_lines = []
      current_expected = None
      continue
    }
    if trimmed.length() == 0 {
      continue
    }
    if trimmed.has_prefix("#") && raw_line.find("###") is None {
      continue
    }
    let (code, expected) = parse_chunk_source_line(raw_line)
    if code.length() > 0 {
      current_lines.push(code)
    }
    match expected {
      Some(value) => current_expected = Some(value)
      None => ()
    }
  }
  cases
}

///|
fn go_errors_subset_chunked_embedded() -> String {
  let text =
    #|# source=embedded-fallback
    #|workflow(1+2 = 3) ### "keyword argument must have form name=expr"
    #|---
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", *, needs=[]) ### "splat arguments are not supported"
    #|---
    #|workflow(name="ci",
    #|### "expected ')' to close argument list"
    #|---
    #|workflow(name="ci",)
    #|node(id="root", depends_on=[],)
    #|task(id="root:build", node="root", cmd="build", needs=[],)
    #|entrypoint(targets=["root:build"],)
    #|---
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="\x-0", needs=[]) ### "invalid escape sequence"
  text
}

///|
#cfg(target="js")
extern "js" fn read_go_errors_subset_from_fs() -> String? =
  #| function() {
  #|   try {
  #|     const fs = require("node:fs");
  #|     const path = require("node:path");
  #|     const cwd = (typeof process !== "undefined" && typeof process.cwd === "function")
  #|       ? process.cwd()
  #|       : ".";
  #|     const candidates = [
  #|       path.join(cwd, "fixtures/workflow/starlark_go_errors_subset.star"),
  #|       path.join(cwd, "../fixtures/workflow/starlark_go_errors_subset.star"),
  #|       path.join(cwd, "../../fixtures/workflow/starlark_go_errors_subset.star"),
  #|       "fixtures/workflow/starlark_go_errors_subset.star",
  #|     ];
  #|     for (const p of candidates) {
  #|       if (fs.existsSync(p)) {
  #|         return fs.readFileSync(p, "utf8");
  #|       }
  #|     }
  #|     return null;
  #|   } catch (_err) {
  #|     return null;
  #|   }
  #| }

///|
#cfg(target="js")
fn go_errors_subset_chunked() -> String {
  let fallback = go_errors_subset_chunked_embedded()
  match read_go_errors_subset_from_fs() {
    Some(text) => text
    None => fallback
  }
}

///|
#cfg(not(target="js"))
fn go_errors_subset_chunked() -> String {
  go_errors_subset_chunked_embedded()
}

///|
#cfg(target="js")
fn expected_go_errors_source_marker() -> String {
  "# source=external-file"
}

///|
#cfg(not(target="js"))
fn expected_go_errors_source_marker() -> String {
  "# source=embedded-fallback"
}

///|
struct ExecutionFixtureCase {
  name : String
  source : String
  scenarios : Array[TaskScenario]
  runner_default_ok : Bool?
  runner_default_message : String?
  expect_ok : Bool?
  expect_state : String?
  expect_order : Array[String]
  expect_steps : Array[String]
  expect_issues_contains : Array[String]
  expect_issues_count : Int?
}

///|
fn strip_prefix_value(line : String, prefix : String) -> String? {
  if not(line.has_prefix(prefix)) {
    return None
  }
  let raw = String::unsafe_substring(
    line,
    start=prefix.length(),
    end=line.length(),
  )
  Some(trim_ascii_space(raw))
}

///|
fn parse_fixture_assignment(raw : String) -> (String, String)? {
  match raw.find("=") {
    Some(idx) => {
      let key = trim_ascii_space(
        String::unsafe_substring(raw, start=0, end=idx),
      )
      let value = trim_ascii_space(
        String::unsafe_substring(raw, start=idx + 1, end=raw.length()),
      )
      if key.length() == 0 {
        None
      } else {
        Some((key, value))
      }
    }
    None => None
  }
}

///|
fn parse_csv_values(raw : String) -> Array[String] {
  let text = trim_ascii_space(raw)
  if text.length() == 0 {
    return []
  }
  let values : Array[String] = []
  for view in text.split(",") {
    let item = trim_ascii_space(view.to_string())
    if item.length() > 0 {
      values.push(item)
    }
  }
  values
}

///|
fn parse_fixture_bool(raw : String) -> Bool? {
  let lowered = trim_ascii_space(raw).to_lower()
  if lowered == "true" {
    Some(true)
  } else if lowered == "false" {
    Some(false)
  } else {
    None
  }
}

///|
fn parse_fixture_int(raw : String) -> Int? {
  let text = trim_ascii_space(raw)
  if text.length() == 0 {
    return None
  }
  let zero = '0'.to_int().to_uint16()
  let nine = '9'.to_int().to_uint16()
  let mut value = 0
  let mut idx = 0
  while idx < text.length() {
    let ch = text.unsafe_get(idx)
    if ch < zero || ch > nine {
      return None
    }
    value = value * 10 + (ch - zero).to_int()
    idx += 1
  }
  Some(value)
}

///|
fn parse_scenario_spec(raw : String) -> TaskScenario? {
  match parse_fixture_assignment(raw) {
    Some((task_id, spec_raw)) => {
      let spec = trim_ascii_space(spec_raw)
      let (status, message) = match spec.find(":") {
        Some(idx) =>
          (
            trim_ascii_space(String::unsafe_substring(spec, start=0, end=idx)),
            trim_ascii_space(
              String::unsafe_substring(spec, start=idx + 1, end=spec.length()),
            ),
          )
        None => (spec, "")
      }
      let lowered = status.to_lower()
      if lowered == "success" || lowered == "ok" {
        Some(task_scenario_success(task_id, message~))
      } else if lowered == "fail" || lowered == "failed" {
        if message.length() == 0 {
          Some(task_scenario_failure(task_id))
        } else {
          Some(task_scenario_failure(task_id, message~))
        }
      } else {
        None
      }
    }
    None => None
  }
}

///|
fn parse_execution_fixture_cases(text : String) -> Array[ExecutionFixtureCase] {
  let lines : Array[String] = []
  for view in text.split("\n") {
    lines.push(view.to_string())
  }
  lines.push("---")

  let cases : Array[ExecutionFixtureCase] = []
  let mut current_name = "unnamed"
  let mut current_source_lines : Array[String] = []
  let mut current_scenarios : Array[TaskScenario] = []
  let mut current_runner_default_ok : Bool? = None
  let mut current_runner_default_message : String? = None
  let mut current_expect_ok : Bool? = None
  let mut current_expect_state : String? = None
  let mut current_expect_order : Array[String] = []
  let mut current_expect_steps : Array[String] = []
  let mut current_expect_issues_contains : Array[String] = []
  let mut current_expect_issues_count : Int? = None

  for raw_line in lines {
    let trimmed = trim_ascii_space(raw_line)
    if trimmed == "---" {
      if current_source_lines.length() > 0 {
        cases.push({
          name: current_name,
          source: current_source_lines.join("\n"),
          scenarios: current_scenarios,
          runner_default_ok: current_runner_default_ok,
          runner_default_message: current_runner_default_message,
          expect_ok: current_expect_ok,
          expect_state: current_expect_state,
          expect_order: current_expect_order,
          expect_steps: current_expect_steps,
          expect_issues_contains: current_expect_issues_contains,
          expect_issues_count: current_expect_issues_count,
        })
      }
      current_name = "unnamed"
      current_source_lines = []
      current_scenarios = []
      current_runner_default_ok = None
      current_runner_default_message = None
      current_expect_ok = None
      current_expect_state = None
      current_expect_order = []
      current_expect_steps = []
      current_expect_issues_contains = []
      current_expect_issues_count = None
      continue
    }
    if trimmed.length() == 0 {
      continue
    }
    if trimmed.has_prefix("#") {
      match strip_prefix_value(trimmed, "# case=") {
        Some(value) => {
          current_name = if value.length() == 0 { "unnamed" } else { value }
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# scenario ") {
        Some(value) => {
          match parse_scenario_spec(value) {
            Some(scenario) => current_scenarios.push(scenario)
            None => ()
          }
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# runner.default_ok=") {
        Some(value) => {
          current_runner_default_ok = parse_fixture_bool(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# runner.default_message=") {
        Some(value) => {
          current_runner_default_message = Some(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.ok=") {
        Some(value) => {
          current_expect_ok = parse_fixture_bool(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.state=") {
        Some(value) => {
          current_expect_state = Some(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.order=") {
        Some(value) => {
          current_expect_order = parse_csv_values(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.steps=") {
        Some(value) => {
          current_expect_steps = parse_csv_values(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.issues_contains=") {
        Some(value) => {
          current_expect_issues_contains = parse_csv_values(value)
          continue
        }
        None => ()
      }
      match strip_prefix_value(trimmed, "# expect.issues_count=") {
        Some(value) => {
          current_expect_issues_count = parse_fixture_int(value)
          continue
        }
        None => ()
      }
      continue
    }
    current_source_lines.push(trimmed)
  }
  cases
}

///|
fn execution_fixtures_embedded() -> String {
  let text =
    #|# source=embedded-fallback
    #|# case=required_failure_blocks_dependent
    #|# scenario root:build=fail:build failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="dep", depends_on=["root"])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
    #|entrypoint(targets=["dep:test"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=root:build,dep:test
    #|# expect.steps=root:build:failed,dep:test:blocked
    #|---
    #|# case=optional_failure_keeps_completed
    #|# scenario root:lint=fail:lint failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:lint", node="root", cmd="lint", needs=[], required=False)
    #|entrypoint(targets=["root:lint"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:lint
    #|# expect.steps=root:lint:failed
    #|---
    #|# case=all_success_chain
    #|workflow(name="ci")
    #|node(id="base", depends_on=[])
    #|node(id="app", depends_on=["base"])
    #|task(id="base:prep", node="base", cmd="prep", needs=[])
    #|task(id="app:build", node="app", cmd="build", needs=["base:prep"])
    #|task(id="app:test", node="app", cmd="test", needs=["app:build"])
    #|entrypoint(targets=["app:test"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=base:prep,app:build,app:test
    #|# expect.steps=base:prep:success,app:build:success,app:test:success
    #|---
    #|# case=entrypoint_scopes_transitive_only
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="app", depends_on=["root"])
    #|node(id="misc", depends_on=[])
    #|task(id="root:prep", node="root", cmd="prep", needs=[])
    #|task(id="app:build", node="app", cmd="build", needs=["root:prep"])
    #|task(id="misc:lint", node="misc", cmd="lint", needs=[])
    #|entrypoint(targets=["app:build"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:prep,app:build
    #|# expect.steps=root:prep:success,app:build:success
    #|---
    #|# case=two_entry_targets_share_dependency
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="app", depends_on=["root"])
    #|task(id="root:prep", node="root", cmd="prep", needs=[])
    #|task(id="app:build", node="app", cmd="build", needs=["root:prep"])
    #|task(id="app:lint", node="app", cmd="lint", needs=["root:prep"])
    #|entrypoint(targets=["app:build", "app:lint"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:prep,app:build,app:lint
    #|# expect.steps=root:prep:success,app:build:success,app:lint:success
    #|---
    #|# case=optional_failure_blocks_required_dependent
    #|# scenario root:seed=fail:seed failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="app", depends_on=["root"])
    #|task(id="root:seed", node="root", cmd="seed", needs=[], required=False)
    #|task(id="app:use", node="app", cmd="use", needs=["root:seed"])
    #|entrypoint(targets=["app:use"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=root:seed,app:use
    #|# expect.steps=root:seed:failed,app:use:blocked
    #|---
    #|# case=optional_failure_blocks_optional_dependent
    #|# scenario root:seed=fail:seed failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="app", depends_on=["root"])
    #|task(id="root:seed", node="root", cmd="seed", needs=[], required=False)
    #|task(id="app:use", node="app", cmd="use", needs=["root:seed"], required=False)
    #|entrypoint(targets=["app:use"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:seed,app:use
    #|# expect.steps=root:seed:failed,app:use:blocked
    #|---
    #|# case=required_failure_does_not_stop_independent_task
    #|# scenario root:build=fail:build failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="util", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="util:lint", node="util", cmd="lint", needs=[])
    #|entrypoint(targets=["root:build", "util:lint"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=root:build,util:lint
    #|# expect.steps=root:build:failed,util:lint:success
    #|---
    #|# case=no_scenario_defaults_to_success
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="dep", depends_on=["root"])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
    #|entrypoint(targets=["dep:test"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:build,dep:test
    #|# expect.steps=root:build:success,dep:test:success
    #|---
    #|# case=max_parallel_batches_preserve_queue_order
    #|workflow(name="ci", max_parallel=2)
    #|node(id="n", depends_on=[])
    #|task(id="n:a", node="n", cmd="a", needs=[])
    #|task(id="n:b", node="n", cmd="b", needs=[])
    #|task(id="n:c", node="n", cmd="c", needs=[])
    #|task(id="n:d", node="n", cmd="d", needs=[])
    #|entrypoint(targets=["n:a", "n:b", "n:c", "n:d"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:a,n:b,n:c,n:d
    #|# expect.steps=n:a:success,n:b:success,n:c:success,n:d:success
    #|---
    #|# case=no_entrypoint_runs_all_tasks
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="util", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="util:lint", node="util", cmd="lint", needs=[])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=root:build,util:lint
    #|# expect.steps=root:build:success,util:lint:success
    #|---
    #|# case=default_runner_failure_causes_required_failure
    #|# runner.default_ok=false
    #|# runner.default_message=default failed
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=root:build
    #|# expect.steps=root:build:failed
    #|---
    #|# case=scenario_success_overrides_default_failure
    #|# runner.default_ok=false
    #|# scenario n:a=success:done
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:a", node="n", cmd="a", needs=[])
    #|task(id="n:b", node="n", cmd="b", needs=[])
    #|entrypoint(targets=["n:a", "n:b"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=n:a,n:b
    #|# expect.steps=n:a:success,n:b:failed
    #|---
    #|# case=scenario_failure_overrides_default_success
    #|# runner.default_ok=true
    #|# scenario n:a=fail:boom
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:a", node="n", cmd="a", needs=[])
    #|entrypoint(targets=["n:a"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=n:a
    #|# expect.steps=n:a:failed
    #|---
    #|# case=manual_trigger_mode_executes_normally
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:manual", node="n", cmd="manual", needs=[], trigger="manual")
    #|entrypoint(targets=["n:manual"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:manual
    #|# expect.steps=n:manual:success
    #|---
    #|# case=entrypoint_manual_target_does_not_select_unrelated_auto
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:manual", node="n", cmd="manual", needs=[], trigger="manual")
    #|task(id="n:auto", node="n", cmd="auto", needs=[])
    #|entrypoint(targets=["n:manual"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:manual
    #|# expect.steps=n:manual:success
    #|---
    #|# case=diamond_failure_blocks_join
    #|# scenario n:right=fail:right failed
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:root", node="n", cmd="root", needs=[])
    #|task(id="n:left", node="n", cmd="left", needs=["n:root"])
    #|task(id="n:right", node="n", cmd="right", needs=["n:root"])
    #|task(id="n:join", node="n", cmd="join", needs=["n:left", "n:right"])
    #|entrypoint(targets=["n:join"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=n:root,n:left,n:right,n:join
    #|# expect.steps=n:root:success,n:left:success,n:right:failed,n:join:blocked
    #|---
    #|# case=optional_failed_and_optional_blocked_can_complete_with_required_success
    #|# scenario n:seed=fail:seed failed
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:seed", node="n", cmd="seed", needs=[], required=False)
    #|task(id="n:use", node="n", cmd="use", needs=["n:seed"], required=False)
    #|task(id="n:check", node="n", cmd="check", needs=[])
    #|entrypoint(targets=["n:use", "n:check"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:seed,n:check,n:use
    #|# expect.steps=n:seed:failed,n:check:success,n:use:blocked
    #|---
    #|# case=max_parallel_two_two_stage
    #|workflow(name="ci", max_parallel=2)
    #|node(id="n", depends_on=[])
    #|task(id="n:a", node="n", cmd="a", needs=[])
    #|task(id="n:b", node="n", cmd="b", needs=[])
    #|task(id="n:c", node="n", cmd="c", needs=["n:a"])
    #|task(id="n:d", node="n", cmd="d", needs=["n:b"])
    #|entrypoint(targets=["n:a", "n:b", "n:c", "n:d"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:a,n:b,n:c,n:d
    #|# expect.steps=n:a:success,n:b:success,n:c:success,n:d:success
    #|---
    #|# case=multiple_entry_components_transitive
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:a1", node="n", cmd="a1", needs=[])
    #|task(id="n:a2", node="n", cmd="a2", needs=["n:a1"])
    #|task(id="n:b1", node="n", cmd="b1", needs=[])
    #|task(id="n:b2", node="n", cmd="b2", needs=["n:b1"])
    #|entrypoint(targets=["n:a2", "n:b2"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:a1,n:b1,n:a2,n:b2
    #|# expect.steps=n:a1:success,n:b1:success,n:a2:success,n:b2:success
    #|---
    #|# case=redundant_entry_targets_deduplicated
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:build", node="n", cmd="build", needs=[])
    #|task(id="n:test", node="n", cmd="test", needs=["n:build"])
    #|entrypoint(targets=["n:test", "n:build"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:build,n:test
    #|# expect.steps=n:build:success,n:test:success
    #|---
    #|# case=required_failure_blocks_optional_dependent_and_reports_partial
    #|# scenario n:root=fail:root failed
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:root", node="n", cmd="root", needs=[])
    #|task(id="n:opt", node="n", cmd="opt", needs=["n:root"], required=False)
    #|entrypoint(targets=["n:opt"])
    #|# expect.ok=false
    #|# expect.state=partial_failed
    #|# expect.order=n:root,n:opt
    #|# expect.steps=n:root:failed,n:opt:blocked
    #|---
    #|# case=optional_failure_independent_of_required_success_completed
    #|# scenario n:opt=fail:optional failed
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|task(id="n:opt", node="n", cmd="opt", needs=[], required=False)
    #|task(id="n:req", node="n", cmd="req", needs=[])
    #|entrypoint(targets=["n:opt", "n:req"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:opt,n:req
    #|# expect.steps=n:opt:failed,n:req:success
    #|---
    #|# case=while_inline_expands_multiple_tasks
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|while counter < 3: task(id="n:" + str(counter), node="n", cmd="run", needs=[]); counter = counter + 1
    #|entrypoint(targets=["n:0", "n:1", "n:2"])
    #|# expect.ok=true
    #|# expect.state=completed
    #|# expect.order=n:0,n:1,n:2
    #|# expect.steps=n:0:success,n:1:success,n:2:success
  text
}

///|
#cfg(target="js")
extern "js" fn read_execution_fixtures_from_fs() -> String? =
  #| function() {
  #|   try {
  #|     const fs = require("node:fs");
  #|     const path = require("node:path");
  #|     const cwd = (typeof process !== "undefined" && typeof process.cwd === "function")
  #|       ? process.cwd()
  #|       : ".";
  #|     const candidates = [
  #|       path.join(cwd, "fixtures/workflow/execution_fixtures.star"),
  #|       path.join(cwd, "../fixtures/workflow/execution_fixtures.star"),
  #|       path.join(cwd, "../../fixtures/workflow/execution_fixtures.star"),
  #|       "fixtures/workflow/execution_fixtures.star",
  #|     ];
  #|     for (const p of candidates) {
  #|       if (fs.existsSync(p)) {
  #|         return fs.readFileSync(p, "utf8");
  #|       }
  #|     }
  #|     return null;
  #|   } catch (_err) {
  #|     return null;
  #|   }
  #| }

///|
#cfg(target="js")
fn execution_fixtures() -> String {
  let fallback = execution_fixtures_embedded()
  match read_execution_fixtures_from_fs() {
    Some(text) => text
    None => fallback
  }
}

///|
#cfg(not(target="js"))
fn execution_fixtures() -> String {
  execution_fixtures_embedded()
}

///|
#cfg(target="js")
fn expected_execution_fixture_source_marker() -> String {
  "# source=external-file"
}

///|
#cfg(not(target="js"))
fn expected_execution_fixture_source_marker() -> String {
  "# source=embedded-fallback"
}

///|
fn invalid_execution_fixtures_embedded() -> String {
  let text =
    #|# source=embedded-fallback
    #|# case=duplicate_node_id
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=node: duplicate node id 'root'
    #|---
    #|# case=node_depends_on_unknown_node
    #|workflow(name="ci")
    #|node(id="root", depends_on=["missing"])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=node: node 'root' depends on unknown node 'missing'
    #|---
    #|# case=node_dependency_cycle
    #|workflow(name="ci")
    #|node(id="a", depends_on=["b"])
    #|node(id="b", depends_on=["a"])
    #|task(id="a:build", node="a", cmd="build", needs=[])
    #|entrypoint(targets=["a:build"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=node: dependency graph has a cycle
    #|---
    #|# case=duplicate_task_id
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="root:build", node="root", cmd="test", needs=[])
    #|entrypoint(targets=["root:build"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=duplicate task id 'root:build'
    #|---
    #|# case=task_targets_unknown_node
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="dep:build", node="dep", cmd="build", needs=[])
    #|entrypoint(targets=["dep:build"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=targets unknown node 'dep'
    #|---
    #|# case=task_depends_on_unknown_task
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:test", node="root", cmd="test", needs=["root:build"])
    #|entrypoint(targets=["root:test"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=depends on unknown task 'root:build'
    #|---
    #|# case=task_graph_cycle
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:a", node="root", cmd="a", needs=["root:b"])
    #|task(id="root:b", node="root", cmd="b", needs=["root:a"])
    #|entrypoint(targets=["root:a"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=task graph has a cycle
    #|---
    #|# case=entry_target_missing
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:test"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=entry target 'root:test' does not exist
    #|---
    #|# case=multiple_missing_entry_targets
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:test", "root:deploy"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=entry target 'root:test' does not exist,entry target 'root:deploy' does not exist
    #|# expect.issues_count=2
    #|---
    #|# case=task_cycle_and_unknown_dependency
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:a", node="root", cmd="a", needs=["root:b", "root:missing"])
    #|task(id="root:b", node="root", cmd="b", needs=["root:a"])
    #|entrypoint(targets=["root:a"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=task 'root:a' depends on unknown task 'root:missing',task graph has a cycle
    #|# expect.issues_count=2
    #|---
    #|# case=mixed_node_and_task_issues
    #|workflow(name="ci")
    #|node(id="root", depends_on=["missing"])
    #|task(id="dup", node="root", cmd="build", needs=["missing:task"])
    #|task(id="dup", node="ghost", cmd="test", needs=["missing:task"])
    #|entrypoint(targets=["missing:entry"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=node: node 'root' depends on unknown node 'missing',duplicate task id 'dup',task 'dup' targets unknown node 'ghost',task 'dup' depends on unknown task 'missing:task',entry target 'missing:entry' does not exist
    #|# expect.issues_count=6
    #|---
    #|# case=while_inline_duplicate_task_ids
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="n", depends_on=[])
    #|while counter < 2: task(id="n:dup", node="n", cmd="run", needs=[]); counter = counter + 1
    #|entrypoint(targets=["n:dup"])
    #|# expect.ok=false
    #|# expect.state=invalid
    #|# expect.order=
    #|# expect.steps=
    #|# expect.issues_contains=duplicate task id 'n:dup'
  text
}

///|
#cfg(target="js")
extern "js" fn read_invalid_execution_fixtures_from_fs() -> String? =
  #| function() {
  #|   try {
  #|     const fs = require("node:fs");
  #|     const path = require("node:path");
  #|     const cwd = (typeof process !== "undefined" && typeof process.cwd === "function")
  #|       ? process.cwd()
  #|       : ".";
  #|     const candidates = [
  #|       path.join(cwd, "fixtures/workflow/invalid_execution_fixtures.star"),
  #|       path.join(cwd, "../fixtures/workflow/invalid_execution_fixtures.star"),
  #|       path.join(cwd, "../../fixtures/workflow/invalid_execution_fixtures.star"),
  #|       "fixtures/workflow/invalid_execution_fixtures.star",
  #|     ];
  #|     for (const p of candidates) {
  #|       if (fs.existsSync(p)) {
  #|         return fs.readFileSync(p, "utf8");
  #|       }
  #|     }
  #|     return null;
  #|   } catch (_err) {
  #|     return null;
  #|   }
  #| }

///|
#cfg(target="js")
fn invalid_execution_fixtures() -> String {
  let fallback = invalid_execution_fixtures_embedded()
  match read_invalid_execution_fixtures_from_fs() {
    Some(text) => text
    None => fallback
  }
}

///|
#cfg(not(target="js"))
fn invalid_execution_fixtures() -> String {
  invalid_execution_fixtures_embedded()
}

///|
#cfg(target="js")
fn expected_invalid_execution_fixture_source_marker() -> String {
  "# source=external-file"
}

///|
#cfg(not(target="js"))
fn expected_invalid_execution_fixture_source_marker() -> String {
  "# source=embedded-fallback"
}

///|
test "workflow engine: direct API executes topological tasks" {
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let tasks = [
    new_task("root:build", "root", "build", []),
    new_task("dep:test", "dep", "test", ["root:build"]),
  ]
  let ir = new_ir(
    "ci",
    nodes,
    tasks,
    entry_targets=["dep:test"],
    max_parallel=2,
  )
  let result = execute_ir(ir, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.state, "completed")
  assert_eq(result.order.length(), 2)
  assert_eq(result.steps[0].status, "success")
  assert_eq(result.steps[1].status, "success")
}

///|
test "workflow engine: task fingerprint includes execution metadata" {
  let node = new_node("root", [])
  let signatures : Map[String, String] = { "root": "sig-root" }
  let task_a = new_task(
    "root:build",
    "root",
    "build",
    ["dep:b", "dep:a"],
    required=false,
    srcs=["src/b/**", "src/a/**"],
    outs=["dist/b/**", "dist/a/**"],
    env={ "B": "2", "A": "1" },
    cwd="packages/root",
    trigger_mode="auto",
  )
  let task_b = new_task(
    "root:build",
    "root",
    "build",
    ["dep:a", "dep:b"],
    required=false,
    srcs=["src/a/**", "src/b/**"],
    outs=["dist/a/**", "dist/b/**"],
    env={ "A": "1", "B": "2" },
    cwd="packages/root",
    trigger_mode="auto",
  )
  let fp_a = flow_task_fingerprint(task_a, node, signatures)
  let fp_b = flow_task_fingerprint(task_b, node, signatures)
  assert_eq(fp_a, fp_b)
  let task_changed = new_task(
    "root:build",
    "root",
    "build",
    ["dep:a", "dep:b"],
    required=false,
    srcs=["src/a/**", "src/b/**"],
    outs=["dist/a/**", "dist/b/**", "dist/c/**"],
    env={ "A": "1", "B": "2" },
    cwd="packages/root",
    trigger_mode="auto",
  )
  let fp_changed = flow_task_fingerprint(task_changed, node, signatures)
  assert_true(fp_changed != fp_a)
}

///|
test "workflow engine: task cache plan reports hit and miss" {
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let tasks = [
    new_task("root:build", "root", "build", []),
    new_task("dep:test", "dep", "test", ["root:build"]),
  ]
  let ir = new_ir("ci", nodes, tasks, entry_targets=["dep:test"])
  let signatures : Map[String, String] = {
    "root": "sig-root",
    "dep": "sig-dep",
  }
  let build_fp = flow_task_fingerprint(tasks[0], nodes[0], signatures)
  let cache : Map[String, String] = {}
  cache[flow_cache_key("root:build", "root")] = build_fp
  let planned = plan_task_cache(ir, signatures, cache)
  assert_eq(planned.issues.length(), 0)
  assert_eq(planned.decisions.length(), 2)
  let hits = cache_hit_map(planned)
  assert_eq(hits.get("root:build"), Some(true))
  assert_eq(hits.get("dep:test"), Some(false))
}

///|
test "workflow engine: task cache plan is invalid when ir has issues" {
  let ir = new_ir("ci", [new_node("root", ["missing"])], [
    new_task("root:build", "root", "build", []),
  ])
  let planned = plan_task_cache(ir, { "root": "sig-root" }, {})
  assert_eq(planned.decisions.length(), 0)
  assert_true(planned.issues.length() > 0)
}

///|
test "workflow engine: required failure blocks dependent task" {
  let runner = mock_task_runner([
    task_scenario_failure("dep:test", message="dep failed"),
  ])
  let nodes = [
    new_node("root", []),
    new_node("dep", ["root"]),
    new_node("leaf", ["dep"]),
  ]
  let tasks = [
    new_task("root:build", "root", "build", []),
    new_task("dep:test", "dep", "test", ["root:build"]),
    new_task("leaf:deploy", "leaf", "deploy", ["dep:test"]),
  ]
  let ir = new_ir("ci", nodes, tasks)
  let result = execute_ir(ir, runner.run)
  assert_eq(result.ok, false)
  assert_eq(result.state, "partial_failed")
  let text = result.steps.map(step => step.id + ":" + step.status).join("\n")
  assert_true(text.contains("dep:test:failed"))
  assert_true(text.contains("leaf:deploy:blocked"))
}

///|
test "workflow engine: entry target executes only transitive dependencies" {
  let nodes = [
    new_node("root", []),
    new_node("dep", ["root"]),
    new_node("extra", []),
  ]
  let tasks = [
    new_task("root:build", "root", "build", []),
    new_task("dep:test", "dep", "test", ["root:build"]),
    new_task("extra:lint", "extra", "lint", []),
  ]
  let ir = new_ir("ci", nodes, tasks, entry_targets=["dep:test"])
  let result = execute_ir(ir, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.order.length(), 2)
  assert_true(result.order.contains("root:build"))
  assert_true(result.order.contains("dep:test"))
  assert_eq(result.order.contains("extra:lint"), false)
}

///|
test "workflow engine: optional task failure keeps workflow completed" {
  let runner = mock_task_runner([
    task_scenario_failure("root:lint", message="lint failed"),
  ])
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let tasks = [
    new_task("root:lint", "root", "lint", [], required=false),
    new_task("dep:test", "dep", "test", [], required=true),
  ]
  let ir = new_ir("ci", nodes, tasks)
  let result = execute_ir(ir, runner.run)
  assert_eq(result.ok, true)
  assert_eq(result.state, "completed")
  let text = result.steps.map(step => step.id + ":" + step.status).join("\n")
  assert_true(text.contains("root:lint:failed"))
  assert_true(text.contains("dep:test:success"))
}

///|
test "workflow engine: execute_ir returns invalid when ir has issues" {
  let nodes = [new_node("root", ["missing"])]
  let tasks = [new_task("root:test", "unknown", "test", ["missing:task"])]
  let ir = new_ir("ci", nodes, tasks, entry_targets=["missing:target"])
  let result = execute_ir(ir, run_ok)
  assert_eq(result.ok, false)
  assert_eq(result.state, "invalid")
  assert_eq(result.steps.length(), 0)
  assert_true(result.issues.length() >= 3)
  let text = result.issues.join("\n")
  assert_true(
    text.contains("node: node 'root' depends on unknown node 'missing'"),
  )
  assert_true(text.contains("targets unknown node"))
  assert_true(text.contains("depends on unknown task"))
  assert_true(text.contains("entry target 'missing:target' does not exist"))
}

///|
test "workflow engine: ir issues reports non-positive max_parallel" {
  let ir = new_ir(
    "ci",
    [new_node("root", [])],
    [new_task("root:build", "root", "build", [])],
    max_parallel=0,
  )
  let issues = ir_issues(ir)
  let text = issues.join("\n")
  assert_true(text.contains("workflow.max_parallel must be positive"))
}

///|
test "workflow engine: starlark subset parses and runs" {
  let src =
    #|workflow(name="ci", max_parallel=4)
    #|node(id="root", depends_on=[])
    #|node(id="dep", depends_on=["root"])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
    #|entrypoint(targets=["dep:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 2)
  assert_eq(parsed.ir.tasks.length(), 2)
  let result = execute_ir(parsed.ir, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.steps.length(), 2)
}

///|
test "workflow engine: starlark subset parser reports unknown function" {
  let src =
    #|workflow(name="ci")
    #|unknown_call(x="y")
  let parsed = parse(src)
  assert_true(parsed.errors.length() > 0)
  assert_true(parsed.errors.join("\n").contains("unknown statement"))
}

///|
test "workflow engine: parse_from_fs load imports function and alias" {
  let root_src =
    #|load("lib.star", "emit", alias_emit="emit")
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|emit(name="build")
    #|alias_emit(name="test")
    #|entrypoint(targets=["root:build", "root:test"])
  let lib_src =
    #|def emit(name):
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
  let fs = FsAdapter::memory_with({
    "workspace/main.star": root_src,
    "workspace/lib.star": lib_src,
  })
  let adapter = WorkflowAdapter::new(fs, CommandAdapter::none())
  let parsed = parse_from_fs("workspace/main.star", adapter)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[1].id, "root:test")
}

///|
test "workflow engine: parse_from_fs load imports value with alias" {
  let root_src =
    #|load("lib.star", local_name="task_name")
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:" + local_name, node="root", cmd=local_name, needs=[])
    #|entrypoint(targets=["root:build"])
  let lib_src =
    #|task_name = "build"
  let fs = FsAdapter::memory_with({
    "workspace/main.star": root_src,
    "workspace/lib.star": lib_src,
  })
  let adapter = WorkflowAdapter::new(fs, CommandAdapter::none())
  let parsed = parse_from_fs("workspace/main.star", adapter)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[0].cmd, "build")
}

///|
test "workflow engine: parse_from_fs load reports unknown symbol" {
  let root_src =
    #|load("lib.star", "missing")
    #|workflow(name="ci")
  let lib_src =
    #|def emit(name):
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
  let fs = FsAdapter::memory_with({
    "workspace/main.star": root_src,
    "workspace/lib.star": lib_src,
  })
  let adapter = WorkflowAdapter::new(fs, CommandAdapter::none())
  let parsed = parse_from_fs("workspace/main.star", adapter)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("loaded symbol 'missing' not found"))
}

///|
test "workflow engine: starlark def defines reusable statement function" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit(name):
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
    #|emit(name="build")
    #|emit(name="test")
    #|entrypoint(targets=["root:build", "root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[1].id, "root:test")
}

///|
test "workflow engine: starlark def uses local scope for assignments" {
  let src =
    #|name = "global"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit():
    #|  name = "local"
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
    #|emit()
    #|task(id="root:" + name, node="root", cmd=name, needs=[])
    #|entrypoint(targets=["root:local", "root:global"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:local")
  assert_eq(parsed.ir.tasks[1].id, "root:global")
}

///|
test "workflow engine: starlark return inside def does not stop caller scope" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit():
    #|  task(id="root:a", node="root", cmd="a", needs=[])
    #|  return
    #|  task(id="root:b", node="root", cmd="b", needs=[])
    #|emit()
    #|task(id="root:c", node="root", cmd="c", needs=[])
    #|entrypoint(targets=["root:a", "root:c"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:a")
  assert_eq(parsed.ir.tasks[1].id, "root:c")
}

///|
test "workflow engine: starlark def validates missing arguments" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit(name):
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
    #|emit()
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("missing argument 'name' for function emit"))
}

///|
test "workflow engine: starlark def supports positional and default arguments" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit(name, cmd="run"):
    #|  task(id="root:" + name, node="root", cmd=cmd, needs=[])
    #|emit("build")
    #|emit("test", "test")
    #|entrypoint(targets=["root:build", "root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[0].cmd, "run")
  assert_eq(parsed.ir.tasks[1].id, "root:test")
  assert_eq(parsed.ir.tasks[1].cmd, "test")
}

///|
test "workflow engine: starlark def supports return value in expression context" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def task_id(name):
    #|  return "root:" + name
    #|task(id=task_id("build"), node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
}

///|
test "workflow engine: starlark def reports too many positional arguments" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def emit(name):
    #|  task(id="root:" + name, node="root", cmd=name, needs=[])
    #|emit("build", "extra")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("too many positional arguments for function emit"))
}

///|
test "workflow engine: starlark def expression call supports keyword arguments" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|def task_id(prefix, name):
    #|  return prefix + ":" + name
    #|task(id=task_id(prefix="root", name="build"), node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
}

///|
test "workflow engine: starlark expression helper rejects keyword arguments" {
  let src =
    #|workflow(name=str(value="ci"))
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(
    text.contains(
      "keyword arguments are not supported for expression function str",
    ),
  )
}

///|
test "workflow engine: starlark function recursion depth is limited" {
  let src =
    #|def loop(n):
    #|  return loop(n + 1)
    #|workflow(name=loop(0))
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("function call depth exceeded"))
  assert_true(text.contains("call stack"))
}

///|
test "workflow engine: starlark function errors include call stack" {
  let src =
    #|def inner(name):
    #|  return name
    #|def outer():
    #|  return inner()
    #|workflow(name=outer())
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("missing argument 'name' for function inner"))
  assert_true(text.contains("call stack: outer -> inner"))
}

///|
test "workflow engine: starlark parser supports cmd array and inline comments" {
  let src =
    #|workflow(name="ci") # inline comment
    #|node(id="root", depends_on=[])
    #|task(id="root:test", node="root", cmd=["just", "test"], needs=[]) # tail comment
    #|entrypoint(targets=["root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].cmd, "just test")
  let result = execute_ir(parsed.ir, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.steps.length(), 1)
}

///|
test "workflow engine: starlark task supports srcs outs cwd and trigger" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(
    #|  id="root:build",
    #|  node="root",
    #|  cmd=["pnpm", "build"],
    #|  needs=[],
    #|  srcs=["packages/root/**", "pnpm-lock.yaml"],
    #|  outs=["packages/root/dist/**"],
    #|  cwd="packages/root",
    #|  trigger="manual",
    #|)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  let task = parsed.ir.tasks[0]
  assert_eq(task.srcs.length(), 2)
  assert_eq(task.srcs[0], "packages/root/**")
  assert_eq(task.outs.length(), 1)
  assert_eq(task.outs[0], "packages/root/dist/**")
  assert_eq(task.cwd, "packages/root")
  assert_eq(task.trigger_mode, "manual")
}

///|
test "workflow engine: starlark target alias maps to task semantics" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|target(
    #|  id="root:build",
    #|  node="root",
    #|  cmd=["pnpm", "build"],
    #|  needs=[],
    #|  srcs=["packages/root/**"],
    #|)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  let task = parsed.ir.tasks[0]
  assert_eq(task.id, "root:build")
  assert_eq(task.cmd, "pnpm build")
  assert_eq(task.srcs.length(), 1)
  assert_eq(task.srcs[0], "packages/root/**")
}

///|
test "workflow engine: starlark task supports env dict" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(
    #|  id="root:build",
    #|  node="root",
    #|  cmd="build",
    #|  needs=[],
    #|  env={"NODE_ENV": "test", "CI": "1"},
    #|)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  let env = parsed.ir.tasks[0].env
  assert_eq(env.get("NODE_ENV"), Some("test"))
  assert_eq(env.get("CI"), Some("1"))
}

///|
test "workflow engine: starlark task env rejects non-string value" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(
    #|  id="root:build",
    #|  node="root",
    #|  cmd="build",
    #|  needs=[],
    #|  env={"CI": 1},
    #|)
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("task.env must be {string:string}"))
}

///|
test "workflow engine: starlark assignment binds and references values" {
  let src =
    #|workflow_name = "ci"
    #|target_id = "root:build"
    #|target_node = "root"
    #|build_cmd = ["pnpm", "build"]
    #|task_srcs = ["packages/root/**"]
    #|task_env = {"NODE_ENV": "test", "CI": "1"}
    #|workflow(name=workflow_name)
    #|node(id=target_node, depends_on=[])
    #|task(id=target_id, node=target_node, cmd=build_cmd, needs=[], srcs=task_srcs, env=task_env)
    #|entry_targets = [target_id]
    #|entrypoint(targets=entry_targets)
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci")
  assert_eq(parsed.ir.entry_targets.length(), 1)
  assert_eq(parsed.ir.entry_targets[0], "root:build")
  assert_eq(parsed.ir.tasks.length(), 1)
  let task = parsed.ir.tasks[0]
  assert_eq(task.cmd, "pnpm build")
  assert_eq(task.srcs.length(), 1)
  assert_eq(task.srcs[0], "packages/root/**")
  assert_eq(task.env.get("NODE_ENV"), Some("test"))
}

///|
test "workflow engine: starlark assignment reports unknown variable reference" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=unknown_cmd, needs=[])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("unknown variable 'unknown_cmd'"))
}

///|
test "workflow engine: starlark var binds default value by name" {
  let src =
    #|var(name="workflow_name", default="ci")
    #|var(name="node_id", default="root")
    #|var(name="task_id", default="root:build")
    #|var(name="task_cmd", default=["pnpm", "build"])
    #|var(name="task_env", default={"NODE_ENV": "test"})
    #|workflow(name=workflow_name)
    #|node(id=node_id, depends_on=[])
    #|task(id=task_id, node=node_id, cmd=task_cmd, needs=[], env=task_env)
    #|entrypoint(targets=[task_id])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci")
  assert_eq(parsed.ir.tasks.length(), 1)
  let task = parsed.ir.tasks[0]
  assert_eq(task.cmd, "pnpm build")
  assert_eq(task.env.get("NODE_ENV"), Some("test"))
}

///|
test "workflow engine: starlark config overrides var binding" {
  let src =
    #|var(name="profile", default="dev")
    #|config(name="profile", value="prod")
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=["echo", profile], needs=[], env={"PROFILE": profile})
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  let task = parsed.ir.tasks[0]
  assert_eq(task.cmd, "echo prod")
  assert_eq(task.env.get("PROFILE"), Some("prod"))
}

///|
test "workflow engine: starlark var type enforces default and config values" {
  let src =
    #|var(name="retries", type="int", default=1)
    #|config(name="retries", value=3)
    #|workflow(name="ci", max_parallel=retries)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 3)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].cmd, "build")
}

///|
test "workflow engine: starlark var type rejects default mismatch" {
  let src =
    #|var(name="retries", type="int", default="1")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("var.default must match type 'int'"))
}

///|
test "workflow engine: starlark var type rejects config mismatch" {
  let src =
    #|var(name="retries", type="int", default=1)
    #|config(name="retries", value="3")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("config.value for 'retries' must match type 'int'"))
}

///|
test "workflow engine: starlark var type rejects unknown type name" {
  let src =
    #|var(name="mode", type="unknown", default="dev")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("var.type must be one of"))
}

///|
test "workflow engine: starlark config requires declared var" {
  let src =
    #|config(name="mode", value="prod")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("config.name 'mode' is not declared by var()"))
}

///|
test "workflow engine: starlark required var can be injected by external inputs" {
  let src =
    #|var(name="profile", type="string", required=True, default="dev")
    #|workflow(name=profile)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=["echo", profile], needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse_with_inputs(src, { "profile": "prod" })
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "prod")
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].cmd, "echo prod")
}

///|
test "workflow engine: starlark required var allows missing default with external input" {
  let src =
    #|var(name="profile", type="string", required=True)
    #|workflow(name=profile)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=["echo", profile], needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse_with_inputs(src, { "profile": "prod" })
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "prod")
  assert_eq(parsed.ir.tasks[0].cmd, "echo prod")
}

///|
test "workflow engine: starlark required var reports error when unresolved" {
  let src =
    #|var(name="profile", type="string", required=True, default="dev")
    #|workflow(name=profile)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=["echo", profile], needs=[])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("required var 'profile' must be provided"))
}

///|
test "workflow engine: starlark non-required var without default reports semantic error" {
  let src =
    #|var(name="profile")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(
    text.contains("var.default is required when var.required is false"),
  )
}

///|
test "workflow engine: starlark unresolved var default does not emit required-var noise" {
  let src =
    #|var(name="profile", required=True, default=unknown_profile)
    #|workflow(name="ci")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("unknown variable 'unknown_profile'"))
  assert_eq(
    text.contains(
      "required var 'profile' must be provided by config() or external inputs",
    ),
    false,
  )
}

///|
test "workflow engine: starlark required var is resolved by config override" {
  let src =
    #|var(name="profile", type="string", required=True, default="dev")
    #|config(name="profile", value="prod")
    #|workflow(name=profile)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=["echo", profile], needs=[])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "prod")
  assert_eq(parsed.ir.tasks[0].cmd, "echo prod")
}

///|
test "workflow engine: starlark config before var reports declaration-order error" {
  let src =
    #|config(name="profile", value="prod")
    #|var(name="profile", default="dev")
    #|workflow(name=profile)
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("config.name 'profile' is not declared by var()"))
}

///|
test "workflow engine: starlark external inputs follow var type conversion" {
  let src =
    #|var(name="retries", type="int", required=True, default=1)
    #|var(name="enable_cache", type="bool", required=True, default=False)
    #|var(name="labels", type="string_list", required=True, default=["dev"])
    #|var(name="env_map", type="string_dict", required=True, default={"NODE_ENV": "dev"})
    #|workflow(name="ci", max_parallel=retries)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd=labels, needs=[], env=env_map, required=enable_cache)
  let parsed = parse_with_inputs(src, {
    "retries": "3",
    "enable_cache": "true",
    "labels": "prod,release",
    "env_map": "NODE_ENV=prod,CI=1",
  })
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 3)
  assert_eq(parsed.ir.tasks[0].cmd, "prod release")
  assert_eq(parsed.ir.tasks[0].required, true)
  assert_eq(parsed.ir.tasks[0].env.get("NODE_ENV"), Some("prod"))
  assert_eq(parsed.ir.tasks[0].env.get("CI"), Some("1"))
}

///|
test "workflow engine: starlark external input conversion reports type errors" {
  let src =
    #|var(name="retries", type="int", required=True, default=1)
  let parsed = parse_with_inputs(src, { "retries": "abc" })
  let text = parsed.errors.join("\n")
  assert_true(text.contains("external input for 'retries' must be int"))
}

///|
test "workflow engine: parse_external_inputs merges env and cli with cli precedence" {
  let result = parse_external_inputs(
    ["--var", "profile=prod", "--var=retries=3"],
    { "BITFLOW_VAR_profile": "dev", "BITFLOW_VAR_node_id": "root" },
  )
  assert_eq(result.errors.length(), 0)
  assert_eq(result.values.get("profile"), Some("prod"))
  assert_eq(result.values.get("retries"), Some("3"))
  assert_eq(result.values.get("node_id"), Some("root"))
}

///|
test "workflow engine: parse_external_inputs reports malformed cli and env entries" {
  let result = parse_external_inputs(
    ["--var", "broken", "--var=novalue", "--var"],
    { "BITFLOW_VAR_": "x" },
  )
  let text = result.errors.join("\n")
  assert_true(text.contains("expects key=value"))
  assert_true(text.contains("must be key=value"))
  assert_true(text.contains("env var key is empty"))
}

///|
test "workflow engine: parse_external_inputs trims cli key and value" {
  let result = parse_external_inputs(["--var", " profile = prod "], {})
  assert_eq(result.errors.length(), 0)
  assert_eq(result.values.get("profile"), Some("prod"))
}

///|
test "workflow engine: starlark reports unknown external input key" {
  let src =
    #|var(name="profile", default="dev")
    #|workflow(name=profile)
  let parsed = parse_with_inputs(src, { "profile": "prod", "profiel": "typo" })
  let text = parsed.errors.join("\n")
  assert_true(
    text.contains("external input 'profiel' is not declared by var()"),
  )
}

///|
test "workflow engine: parse_with_cli_env injects vars" {
  let src =
    #|var(name="profile", type="string", required=True, default="dev")
    #|workflow(name=profile)
  let parsed = parse_with_cli_env(src, ["--var=profile=prod"], {})
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "prod")
}

///|
test "workflow engine: changed paths selects auto targets and executes dependencies" {
  let nodes = [new_node("root", []), new_node("dep", ["root"])]
  let tasks = [
    new_task(
      "root:build",
      "root",
      "build",
      [],
      srcs=["packages/root/**"],
      trigger_mode="auto",
    ),
    new_task(
      "dep:test",
      "dep",
      "test",
      ["root:build"],
      srcs=["packages/dep/**"],
      trigger_mode="manual",
    ),
    new_task(
      "dep:lint",
      "dep",
      "lint",
      ["root:build"],
      srcs=["packages/dep/**"],
      trigger_mode="auto",
    ),
  ]
  let ir = new_ir("ci", nodes, tasks)
  let changed = ["packages/dep/src/main.ts"]
  let targets = entry_targets_for_changed_paths(ir, changed)
  assert_eq(targets.contains("dep:lint"), true)
  assert_eq(targets.contains("dep:test"), false)
  let result = execute_ir_for_changed_paths(ir, changed, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.order.length(), 2)
  assert_eq(result.order[0], "root:build")
  assert_eq(result.order[1], "dep:lint")
}

///|
test "workflow engine: changed paths can target auto task by outs patterns" {
  let nodes = [new_node("root", [])]
  let tasks = [
    new_task(
      "root:pack",
      "root",
      "pack",
      [],
      srcs=[],
      outs=["dist/root/**"],
      trigger_mode="auto",
    ),
  ]
  let ir = new_ir("ci", nodes, tasks)
  let changed = ["dist/root/bundle.js"]
  let targets = entry_targets_for_changed_paths(ir, changed)
  assert_eq(targets.length(), 1)
  assert_eq(targets[0], "root:pack")
  let result = execute_ir_for_changed_paths(ir, changed, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.order.join(","), "root:pack")
}

///|
test "workflow engine: execute runs parsed workflow directly" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let result = execute(src, run_ok)
  assert_eq(result.ok, true)
  assert_eq(result.state, "completed")
  assert_eq(result.order.length(), 1)
  assert_eq(result.steps[0].status, "success")
}

///|
test "workflow engine: starlark compatibility accepts semicolon separated calls" {
  let src =
    #|workflow(name='ci'); node(id='root', depends_on=[]); task(id='root:build', node='root', cmd='build', needs=[]); entrypoint(targets=['root:build'])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.entry_targets.length(), 1)
}

///|
test "workflow engine: starlark compatibility accepts trailing comma in call args" {
  let src =
    #|workflow(name="ci",)
    #|node(id="root", depends_on=[],)
    #|task(id="root:test", node="root", cmd=["just", "test",], needs=[],)
    #|entrypoint(targets=["root:test"],)
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].cmd, "just test")
}

///|
test "workflow engine: starlark compatibility supports single quote and bool literal" {
  let src =
    #|workflow(name='ci')
    #|node(id='root', depends_on=[], required=False)
    #|task(id='root:lint', node='root', cmd='lint', needs=[], required=True)
    #|entrypoint(targets=['root:lint'])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, false)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark compatibility supports plus expressions" {
  let src =
    #|task_name = "build"
    #|workflow(name="ci", max_parallel=1 + 1)
    #|node(id="root", depends_on=[])
    #|task(id="root:" + task_name, node="root", cmd=["just", task_name + "-all"], needs=[])
    #|entrypoint(targets=["root:" + task_name])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 2)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[0].cmd, "just build-all")
  assert_eq(parsed.ir.entry_targets.length(), 1)
  assert_eq(parsed.ir.entry_targets[0], "root:build")
}

///|
test "workflow engine: starlark compatibility supports if statement (inline suite)" {
  let src =
    #|enabled = True
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if enabled: task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
}

///|
test "workflow engine: starlark if statement skips body when condition is false" {
  let src =
    #|enabled = False
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if enabled: task(id="root:build", node="root", cmd="build", needs=[])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 0)
}

///|
test "workflow engine: starlark compatibility supports if statement (block suite)" {
  let src =
    #|enabled = True
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if enabled:
    #|  task(id="root:build", node="root", cmd="build", needs=[])
    #|  entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.entry_targets.length(), 1)
  assert_eq(parsed.ir.entry_targets[0], "root:build")
}

///|
test "workflow engine: starlark if statement supports else block" {
  let src =
    #|enabled = False
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if enabled:
    #|  task(id="root:build", node="root", cmd="build", needs=[])
    #|else:
    #|  task(id="root:lint", node="root", cmd="lint", needs=[])
    #|entrypoint(targets=["root:lint"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:lint")
  assert_eq(parsed.ir.entry_targets.length(), 1)
  assert_eq(parsed.ir.entry_targets[0], "root:lint")
}

///|
test "workflow engine: starlark if statement supports elif chain" {
  let src =
    #|mode = "test"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if mode == "build":
    #|  task(id="root:build", node="root", cmd="build", needs=[])
    #|elif mode == "test":
    #|  task(id="root:test", node="root", cmd="test", needs=[])
    #|else:
    #|  task(id="root:lint", node="root", cmd="lint", needs=[])
    #|entrypoint(targets=["root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:test")
}

///|
test "workflow engine: starlark compatibility supports for statement (inline suite)" {
  let src =
    #|task_names = ["build", "test"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in task_names: task(id="root:" + task_name, node="root", cmd=task_name, needs=[])
    #|entrypoint(targets=["root:build", "root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[1].id, "root:test")
}

///|
test "workflow engine: starlark compatibility supports for statement (block suite)" {
  let src =
    #|task_names = ["build", "test"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in task_names:
    #|  task(id="root:" + task_name, node="root", cmd=task_name, needs=[])
    #|entrypoint(targets=["root:build", "root:test"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[1].id, "root:test")
}

///|
test "workflow engine: starlark block suites support nested if inside for" {
  let src =
    #|task_names = ["build", "test"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in task_names:
    #|  if task_name == "build":
    #|    task(id="root:" + task_name, node="root", cmd=task_name, needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
}

///|
test "workflow engine: starlark block suites support nested if else inside for" {
  let src =
    #|task_names = ["build", "lint"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in task_names:
    #|  if task_name == "build":
    #|    task(id="root:" + task_name, node="root", cmd=task_name, needs=[])
    #|  else:
    #|    task(id="root:" + task_name, node="root", cmd=task_name, needs=[])
    #|entrypoint(targets=["root:build", "root:lint"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
  assert_eq(parsed.ir.tasks[1].id, "root:lint")
}

///|
test "workflow engine: starlark compatibility supports while statement (block suite)" {
  let src =
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|while counter < 2:
    #|  task(id="root:" + str(counter), node="root", cmd="run", needs=[])
    #|  counter = counter + 1
    #|entrypoint(targets=["root:0", "root:1"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:0")
  assert_eq(parsed.ir.tasks[1].id, "root:1")
}

///|
test "workflow engine: starlark while statement skips body when condition is false" {
  let src =
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|while counter > 0: task(id="root:run", node="root", cmd="run", needs=[])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 0)
}

///|
test "workflow engine: starlark while statement supports break" {
  let src =
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|while counter < 5:
    #|  counter = counter + 1
    #|  task(id="root:" + str(counter), node="root", cmd="run", needs=[])
    #|  if counter == 3:
    #|    break
    #|entrypoint(targets=["root:1", "root:2", "root:3"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 3)
  assert_eq(parsed.ir.tasks[0].id, "root:1")
  assert_eq(parsed.ir.tasks[1].id, "root:2")
  assert_eq(parsed.ir.tasks[2].id, "root:3")
}

///|
test "workflow engine: starlark while statement supports continue" {
  let src =
    #|counter = 0
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|while counter < 4:
    #|  counter = counter + 1
    #|  if counter == 2:
    #|    continue
    #|  task(id="root:" + str(counter), node="root", cmd="run", needs=[])
    #|entrypoint(targets=["root:1", "root:3", "root:4"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 3)
  assert_eq(parsed.ir.tasks[0].id, "root:1")
  assert_eq(parsed.ir.tasks[1].id, "root:3")
  assert_eq(parsed.ir.tasks[2].id, "root:4")
}

///|
test "workflow engine: starlark return stops subsequent statements" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|entrypoint(targets=["root:a"])
    #|task(id="root:a", node="root", cmd="a", needs=[])
    #|return
    #|task(id="root:b", node="root", cmd="b", needs=[])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:a")
}

///|
test "workflow engine: starlark break outside loop reports semantic error" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|break
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("break statement is only allowed inside loops"))
}

///|
test "workflow engine: starlark continue outside loop reports semantic error" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|continue
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("continue statement is only allowed inside loops"))
}

///|
test "workflow engine: starlark block suite requires indentation" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|if True:
    #|task(id="root:build", node="root", cmd="build", needs=[])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("expected indented statement body after if"))
}

///|
test "workflow engine: starlark for statement requires list iterable" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in 1: task(id="root:" + task_name, node="root", cmd="build", needs=[])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("for.iter must be iterable"))
}

///|
test "workflow engine: starlark for statement supports dict iterable" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for task_name in {"build": "ok"}:
    #|  task(id="root:" + task_name, node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].id, "root:build")
}

///|
test "workflow engine: starlark for statement supports string iterable" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|for ch in "ab":
    #|  task(id="root:" + ch, node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:a", "root:b"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[0].id, "root:a")
  assert_eq(parsed.ir.tasks[1].id, "root:b")
}

///|
test "workflow engine: starlark compatibility recognizes None literal" {
  let src =
    #|workflow(name=None)
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("workflow.name must be string"))
}

///|
test "workflow engine: starlark compatibility supports equality expressions" {
  let src =
    #|mode = "strict"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=mode == "strict")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=mode != "skip")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark compatibility comparison has lower precedence than plus" {
  let src =
    #|task_name = "build"
    #|is_entry = "root:" + task_name == "root:build"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=is_entry)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
}

///|
test "workflow engine: starlark compatibility supports None equality" {
  let src =
    #|missing = None
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=missing == None)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=missing != None)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, false)
}

///|
test "workflow engine: starlark compatibility reports invalid plus operand types" {
  let src =
    #|workflow(name="ci", max_parallel=1 + "x")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("'+' requires both operands"))
}

///|
test "workflow engine: starlark compatibility supports binary minus and multiply" {
  let src =
    #|n = 5
    #|workflow(name="ci", max_parallel=1 + (n - 2))
    #|node(id="root", depends_on=[], required=(2 * 3 == 6) and (n - 3 == 2))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(n - 2 * 2 == 1))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 4)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark compatibility supports sequence repetition by multiply" {
  let src =
    #|label = "ab" * 2
    #|items = ["x"] * 3
    #|workflow(name=2 * "ci")
    #|node(id="root", depends_on=[], required=label == "abab" and items == ["x", "x", "x"])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(2 * ["a", "b"] == ["a", "b", "a", "b"]) and ("x" * 0 == ""))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "cici")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark arithmetic reports invalid operand types" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=("x" - "y") == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=({"k":"v"} * 2) == 0)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("'-' requires int operands"))
  assert_true(text.contains("'*' requires int*int or (string/list)*int"))
}

///|
test "workflow engine: starlark compatibility supports floor division and modulo" {
  let src =
    #|workflow(name="ci", max_parallel=8 // 2 + 1)
    #|node(id="root", depends_on=[], required=(7 % 3 == 1) and (3 * 2 // 3 == 2))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(8 // 3 == 2))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 5)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark floor division and modulo report invalid usage" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=("x" // 2) == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(1 % 0) == 0)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("'//' requires int operands"))
  assert_true(text.contains("integer modulo by zero"))
}

///|
test "workflow engine: starlark compatibility supports logical operators and grouping" {
  let src =
    #|flag = not ("x" == "y")
    #|gate = ("root:" + "build" == "root:build") and flag
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=gate)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=None or False)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, false)
}

///|
test "workflow engine: starlark logical operators short-circuit unresolved refs" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=False and missing_ref)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=True or missing_ref)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes[0].required, false)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark parser reports unclosed grouped expression" {
  let src =
    #|workflow(name=("ci", max_parallel=1)
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("expected ')' to close expression"))
}

///|
test "workflow engine: starlark compatibility supports relational operators" {
  let src =
    #|workers = 3
    #|workflow(name="ci", max_parallel=workers)
    #|node(id="root", depends_on=[], required=workers >= 3 and workers > 2 and workers <= 3 and workers < 4)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=workers < 3)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 3)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, false)
}

///|
test "workflow engine: starlark compatibility supports chained comparisons" {
  let src =
    #|workers = 3
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=1 < workers < 5)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=5 > workers >= 3)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark chained comparisons short-circuit unresolved refs" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=3 < 2 < missing_ref)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=2 > 3 > missing_ref)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, false)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, false)
}

///|
test "workflow engine: starlark compatibility supports in and not in operators" {
  let src =
    #|labels = ["build", "test"]
    #|env = {"MODE":"prod"}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required="build" in labels and "release" not in labels)
    #|task(id="root:build", node="root", cmd="build", needs=[], required="MODE" in env and "DEBUG" not in env and "od" in "prod")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark compatibility supports index expressions" {
  let src =
    #|labels = ["build", "test"]
    #|env = {"MODE":"prod"}
    #|workflow(name="c" + "i")
    #|node(id="root", depends_on=[], required=labels[0] == "build" and env["MODE"][0] == "p")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=("i" == "ci"[1]) and labels[1] == "test")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark index expression short-circuits unresolved refs" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=False and missing_ref[0])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=True or missing_ref[0])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, false)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark index expression reports invalid access" {
  let src =
    #|items = ["a"]
    #|env = {"MODE":"prod"}
    #|workflow(name=items["0"])
    #|node(id="root", depends_on=[], required=items[1] == "a")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=env["DEBUG"] == "1")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("list index must be int"))
  assert_true(text.contains("list index out of range"))
  assert_true(text.contains("dict key not found"))
}

///|
test "workflow engine: starlark compatibility supports slice expressions" {
  let src =
    #|labels = ["build", "test", "lint"]
    #|word = "workflow"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=labels[0:2] == ["build", "test"] and labels[:1] == ["build"])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=labels[1:] == ["test", "lint"] and word[1:5] == "orkf" and word[-4:-1] == "flo")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark slice expression short-circuits unresolved refs" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=False and missing_ref[0:1])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=True or missing_ref[:1])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, false)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark slice expression reports invalid bounds" {
  let src =
    #|items = ["a", "b"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=items["0":1] == ["a"])
    #|task(id="root:build", node="root", cmd="build", needs=[], required="abc"[0:"2"] == "ab")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("slice start must be int"))
  assert_true(text.contains("slice end must be int"))
}

///|
test "workflow engine: starlark compatibility supports slice step expressions" {
  let src =
    #|labels = ["a", "b", "c", "d", "e"]
    #|word = "workflow"
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=labels[::2] == ["a", "c", "e"] and labels[1:5:2] == ["b", "d"])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=word[::2] == "wrfo" and word[6:1:-2] == "ofr")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark slice step reports invalid usage" {
  let src =
    #|items = ["a", "b", "c"]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=items[::0] == ["a"])
    #|task(id="root:build", node="root", cmd="build", needs=[], required="abc"[::"2"] == "ac")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("slice step cannot be 0"))
  assert_true(text.contains("slice step must be int"))
}

///|
test "workflow engine: starlark compatibility supports expression helper calls" {
  let src =
    #|labels = ["build", "test"]
    #|env = {"MODE":"prod"}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(labels) == 2 and len(env) == 1 and len("ok") == 2)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=get(env, "MODE") == "prod" and get(env, "DEBUG", "0") == "0")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark get without default returns None" {
  let src =
    #|env = {"MODE":"prod"}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=get(env, "DEBUG") == None)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=get(env, "MODE") == "prod")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark expression helper call reports unknown function" {
  let src =
    #|workflow(name=unknown_helper("ci"))
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("unknown expression function"))
}

///|
test "workflow engine: starlark len reports invalid operand type" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(1) == 1)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("len() expects string, list, or dict"))
}

///|
test "workflow engine: starlark compatibility supports str and int helper calls" {
  let src =
    #|n = int("2")
    #|workflow(name="ci-" + str(n))
    #|node(id="root", depends_on=[], required=int("1") == 1 and int(True) == 1 and int(False) == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=str(True) == "True" and str(None) == "None")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci-2")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark compatibility supports range enumerate and zip helper calls" {
  let src =
    #|labels = ["build", "test", "lint"]
    #|nums = range(1, 6, 2)
    #|pairs = enumerate(labels)
    #|zipped = zip(labels, nums)
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=nums == [1, 3, 5] and pairs[1][0] == 1 and pairs[1][1] == "test")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=len(zipped) == 3 and zipped[2][0] == "lint" and zipped[2][1] == 5)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark range reports invalid step" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=range(1, 3, 0) == [])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("range() step cannot be 0"))
}

///|
test "workflow engine: starlark enumerate and zip report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=enumerate(1) == [])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=zip(["x"]) == [])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(
    text.contains("enumerate() expects iterable (string, list, or dict)"),
  )
  assert_true(text.contains("zip() expects at least 2 iterable arguments"))
}

///|
test "workflow engine: starlark int reports invalid input" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=int("x") == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("int() expects numeric string"))
}

///|
test "workflow engine: starlark str reports invalid arity" {
  let src =
    #|workflow(name=str("ci", "extra"))
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("str() expects exactly 1 argument"))
}

///|
test "workflow engine: starlark compatibility supports keys and values helper calls" {
  let src =
    #|env = {"MODE":"prod", "DEBUG":"0"}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(keys(env)) == 2 and "MODE" in keys(env) and "DEBUG" in keys(env))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=len(values(env)) == 2 and "prod" in values(env) and "0" in values(env))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark keys and values report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=keys("x") == [])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=values({"k":"v"}, "extra") == [])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("keys() expects dict"))
  assert_true(text.contains("values() expects exactly 1 argument"))
}

///|
test "workflow engine: starlark compatibility supports contains helper call" {
  let src =
    #|labels = ["build", "test"]
    #|env = {"MODE":"prod", "DEBUG":"0"}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=contains(labels, "build") and contains("workflow", "flow"))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=contains(env, "MODE") and not contains(env, "MISSING"))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark contains reports invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=contains("x"))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=contains(1, 1))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("contains() expects exactly 2 arguments"))
  assert_true(
    text.contains("contains() first argument must be string, list, or dict"),
  )
}

///|
test "workflow engine: starlark compatibility supports all and any helper calls" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=all([True, 1, "ok"]) and any([False, 0, "ok"]) and all([]) and not any([]))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=any({"":"x", "k":"v"}) and not all({"":"x"}) and any("x") and all("x") and all(""))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark all and any report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=all(1))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=any("x", "y"))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("all() expects string, list, or dict"))
  assert_true(text.contains("any() expects exactly 1 argument"))
}

///|
test "workflow engine: starlark compatibility supports split and join helper calls" {
  let src =
    #|parts = split("root:build:test", ":")
    #|workflow(name=join(parts, "-"))
    #|node(id="root", depends_on=[], required=parts == ["root", "build", "test"] and split("a--b--c", "--")[1] == "b")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=join(["root", "build"], ":") == "root:build" and join(split("x/y", "/"), ":") == "x:y")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "root-build-test")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark split and join report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=split("a:b") == [])
    #|task(id="root:build", node="root", cmd="build", needs=[], required=join(["a", 1], ":") == "")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("split() expects exactly 2 arguments"))
  assert_true(text.contains("join() items must be string list"))
}

///|
test "workflow engine: starlark compatibility supports min and max helper calls" {
  let src =
    #|numbers = [3, 1, 2]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=min(numbers) == 1 and max(numbers) == 3 and min(5, 2, 9) == 2 and max(5, 2, 9) == 9)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=min(4, 2) == 2 and max([1, 4, 3]) == 4)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark min and max report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=min() == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=max(["x", 1]) == 0)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("min() expects at least 1 argument"))
  assert_true(text.contains("max() expects int arguments or [int]"))
}

///|
test "workflow engine: starlark compatibility supports abs and clamp helper calls" {
  let src =
    #|workflow(name="ci", max_parallel=clamp(abs(-9), 1, 6))
    #|node(id="root", depends_on=[], required=abs(-3) == 3 and abs(0) == 0 and clamp(0, 1, 3) == 1 and clamp(2, 1, 3) == 2 and clamp(9, 1, 3) == 3)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=clamp(abs(-2) + 1, 1, 5) == 3)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 6)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark abs and clamp report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=abs("x") == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=clamp(1, 3, 2) == 0)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("abs() expects int argument"))
  assert_true(text.contains("clamp() requires min <= max"))
}

///|
test "workflow engine: starlark compatibility supports sum and product helper calls" {
  let src =
    #|nums = [1, 2, 3]
    #|workflow(name="ci", max_parallel=sum(nums))
    #|node(id="root", depends_on=[], required=sum(nums) == 6 and sum(1, 2, 3) == 6 and sum([]) == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=product(nums) == 6 and product(2, 3, 4) == 24 and product([]) == 1)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 6)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark sum and product report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=sum() == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[], required=product(["x", 1]) == 0)
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("sum() expects at least 1 argument"))
  assert_true(text.contains("product() expects int arguments or [int]"))
}

///|
test "workflow engine: starlark compatibility supports list comprehensions" {
  let src =
    #|def plus_one(x):
    #|  return x + 1
    #|nums = [1, 2, 3, 4]
    #|mapped = [plus_one(n) for n in nums if n > 2]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(mapped) == 2 and mapped[0] == 4 and mapped[1] == 5)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
}

///|
test "workflow engine: starlark list comprehension reports invalid iterable" {
  let src =
    #|bad = [x for x in 1]
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("list comprehension iterable must be iterable"))
}

///|
test "workflow engine: starlark compatibility supports dict comprehensions" {
  let src =
    #|nums = [1, 2, 3]
    #|mapped = {str(n): n * 10 for n in nums if n >= 2}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(mapped) == 2 and mapped["2"] == 20 and mapped["3"] == 30 and mapped.get("1") == None)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
}

///|
test "workflow engine: starlark dict comprehension reports invalid iterable and key type" {
  let src =
    #|bad_iter = {str(x): x for x in 1}
    #|bad_key = {x: x for x in [1]}
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=len(bad_iter) == 0 and len(bad_key) == 0)
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("dict comprehension iterable must be iterable"))
  assert_true(text.contains("dict comprehension key must evaluate to string"))
}

///|
test "workflow engine: starlark compatibility supports tuple literals" {
  let src =
    #|deps = ("base",)
    #|needs = ("base:prep",)
    #|targets = ("root:build",)
    #|workflow(name=("c", "i")[0] + ("c", "i")[1])
    #|node(id="base", depends_on=())
    #|node(id="root", depends_on=deps, required=("a", "b")[1] == "b" and len(()) == 0)
    #|task(id="base:prep", node="base", cmd="prep", needs=())
    #|task(id="root:build", node="root", cmd="build", needs=needs)
    #|entrypoint(targets=targets)
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci")
  assert_eq(parsed.ir.nodes.length(), 2)
  assert_eq(parsed.ir.nodes[1].depends_on.length(), 1)
  assert_eq(parsed.ir.nodes[1].depends_on[0], "base")
  assert_eq(parsed.ir.tasks.length(), 2)
  assert_eq(parsed.ir.tasks[1].needs.length(), 1)
  assert_eq(parsed.ir.tasks[1].needs[0], "base:prep")
  assert_eq(parsed.ir.entry_targets.length(), 1)
  assert_eq(parsed.ir.entry_targets[0], "root:build")
}

///|
test "workflow engine: starlark compatibility supports method call syntax" {
  let src =
    #|parts = "root:build".split(":")
    #|env = {"MODE":"prod"}
    #|workflow(name="-".join(parts))
    #|node(id="root", depends_on=[], required="Build".lower() == "build" and "x".upper() == "X" and "root:build".startswith("root:") and "root:build".endswith(":build") and "a-a-a".replace("-", ":", 1) == "a:a-a")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=env.get("MODE") == "prod" and len(env.keys()) == 1 and ["a", "b", "a"].count("a") == 2 and "x/y".split("/")[1] == "y" and "  x  ".strip() == "x" and "  x".lstrip() == "x" and "x  ".rstrip() == "x")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "root-build")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark method call reports invalid usage" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required="x".startswith())
    #|task(id="root:build", node="root", cmd="build", needs=[], required=["a"].unknown())
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("startswith() expects exactly 1 argument"))
  assert_true(text.contains("unknown list method: unknown"))
}

///|
test "workflow engine: starlark string method call reports invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required="x".replace("-", ":", -1) == "x")
    #|task(id="root:build", node="root", cmd="build", needs=[], required=" x ".strip(1) == "x")
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("replace() count must be non-negative int"))
  assert_true(text.contains("strip() expects string argument when provided"))
}

///|
test "workflow engine: starlark compatibility supports startswith and endswith helper calls" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=startswith("workflow", "work") and endswith("workflow", "flow"))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=startswith("root:build", "root:") and not endswith("root:build", ":test"))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark startswith and endswith report invalid args" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=startswith("x"))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=endswith(1, "1"))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("startswith() expects exactly 2 arguments"))
  assert_true(text.contains("endswith() expects string arguments"))
}

///|
test "workflow engine: starlark not applies to comparison expression" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=not "x" == "x")
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, false)
}

///|
test "workflow engine: starlark compatibility supports conditional expression" {
  let src =
    #|mode = "prod"
    #|workflow(name=("ci-prod" if mode == "prod" else "ci-dev"))
    #|node(id="root", depends_on=[], required=(True if mode == "prod" else False))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(False if mode == "prod" else True))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.name, "ci-prod")
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, false)
}

///|
test "workflow engine: starlark conditional expression evaluates only selected branch" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[], required=(True if True else missing_ref))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(False if False else True))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark conditional expression requires else clause" {
  let src =
    #|workflow(name=("ci" if True))
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("expected 'else' in conditional expression"))
}

///|
test "workflow engine: starlark compatibility supports unary minus expression" {
  let src =
    #|n = 1
    #|workflow(name="ci", max_parallel=3 + -n)
    #|node(id="root", depends_on=[], required=(-n < 0))
    #|task(id="root:build", node="root", cmd="build", needs=[], required=(-(1 + 1) < 0))
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  assert_eq(parsed.errors.length(), 0)
  assert_eq(parsed.ir.max_parallel, 2)
  assert_eq(parsed.ir.nodes.length(), 1)
  assert_eq(parsed.ir.nodes[0].required, true)
  assert_eq(parsed.ir.tasks.length(), 1)
  assert_eq(parsed.ir.tasks[0].required, true)
}

///|
test "workflow engine: starlark unary minus requires int operand" {
  let src =
    #|workflow(name="ci", max_parallel=-"x")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("'-' requires int operand"))
}

///|
test "workflow engine: starlark semantics rejects unknown keyword argument" {
  let src =
    #|workflow(name="ci", unknown=1)
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|entrypoint(targets=["root:build"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("unknown argument"))
}

///|
test "workflow engine: starlark semantics rejects duplicate keyword argument" {
  let src =
    #|workflow(name="ci", name="prod")
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("duplicate argument"))
}

///|
test "workflow engine: starlark semantics validates list element types" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|node(id="dep", depends_on=["root", 1])
    #|task(id="root:build", node="root", cmd="build", needs=[])
    #|task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
    #|entrypoint(targets=["dep:test"])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("depends_on"))
}

///|
test "workflow engine: starlark compatibility rejects splat arguments" {
  let src =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", *, needs=[])
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("splat arguments"))
}

///|
test "workflow engine: starlark compatibility requires name=expr keyword syntax" {
  let src =
    #|workflow(1+2 = 3)
  let parsed = parse(src)
  let text = parsed.errors.join("\n")
  assert_true(text.contains("keyword argument must have form name=expr"))
}

///|
test "workflow engine: starlark-go errors.star failure subset" {
  // Derived from google/starlark-go/syntax/testdata/errors.star
  let case_keyword_arg =
    #|workflow(1+2 = 3)
  let case_splat =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="build", *, needs=[])
  let case_invalid_escape =
    #|workflow(name="ci")
    #|node(id="root", depends_on=[])
    #|task(id="root:build", node="root", cmd="\x-0", needs=[])
  let case_unclosed_paren =
    #|workflow(name="ci",
  let cases = [
    (case_keyword_arg, "keyword argument must have form name=expr"),
    (case_splat, "splat arguments are not supported"),
    (case_invalid_escape, "invalid escape sequence"),
    (case_unclosed_paren, "expected ')' to close argument list"),
  ]
  for entry in cases {
    let (source, expected) = entry
    let parsed = parse(source)
    let text = parsed.errors.join("\n")
    assert_true(text.contains(expected))
  }
}

///|
test "workflow engine: starlark-go errors.star trailing comma subset" {
  // Equivalent to "f(a,)" style trailing comma acceptance in errors.star
  let case_trailing_comma_a =
    #|workflow(name="ci",)
    #|node(id="root", depends_on=[],)
    #|task(id="root:build", node="root", cmd="build", needs=[],)
    #|entrypoint(targets=["root:build"],)
  let case_trailing_comma_b =
    #|workflow(name='ci',)
    #|node(id='root', depends_on=['dep',],)
    #|task(id='root:build', node='root', cmd=['just', 'test',], needs=[],)
    #|entrypoint(targets=['root:build',],)
  let cases = [case_trailing_comma_a, case_trailing_comma_b]
  for source in cases {
    let parsed = parse(source)
    assert_eq(parsed.errors.length(), 0)
  }
}

///|
test "workflow engine: starlark-go chunked errors subset is executable" {
  let chunked_text = go_errors_subset_chunked()
  let source_marker = expected_go_errors_source_marker()
  assert_true(chunked_text.contains(source_marker))
  let cases = parse_go_chunked_cases(chunked_text)
  assert_eq(cases.length(), 5)
  for entry in cases {
    let (source, expected) = entry
    let parsed = parse(source)
    match expected {
      Some(msg) => assert_true(parsed.errors.join("\n").contains(msg))
      None => assert_eq(parsed.errors.length(), 0)
    }
  }
}

///|
test "workflow engine: execution fixtures validate runtime result contracts" {
  let fixture_text = execution_fixtures()
  let source_marker = expected_execution_fixture_source_marker()
  assert_true(fixture_text.contains(source_marker))
  let cases = parse_execution_fixture_cases(fixture_text)
  assert_eq(cases.length(), 24)

  for case in cases {
    assert_true(case.name.length() > 0)
    assert_true(case.expect_ok is Some(_))
    assert_true(case.expect_state is Some(_))
    let parsed = parse(case.source)
    assert_eq(parsed.errors.length(), 0)

    let runner = mock_task_runner(
      case.scenarios,
      default_ok=case.runner_default_ok.unwrap_or(true),
      default_message=case.runner_default_message.unwrap_or(""),
    )
    let result = execute_ir(parsed.ir, runner.run)

    assert_eq(result.ok, case.expect_ok.unwrap_or(false))
    assert_eq(result.state, case.expect_state.unwrap_or(""))
    assert_eq(result.order.join(","), case.expect_order.join(","))
    assert_eq(result.issues.length(), 0)

    let actual_steps : Array[String] = []
    for step in result.steps {
      actual_steps.push(step.id + ":" + step.status)
    }
    assert_eq(actual_steps.join(","), case.expect_steps.join(","))
  }
}

///|
test "workflow engine: invalid execution fixtures validate ir issue contracts" {
  let fixture_text = invalid_execution_fixtures()
  let source_marker = expected_invalid_execution_fixture_source_marker()
  assert_true(fixture_text.contains(source_marker))
  let cases = parse_execution_fixture_cases(fixture_text)
  assert_eq(cases.length(), 12)

  for case in cases {
    assert_true(case.name.length() > 0)
    assert_true(case.expect_ok is Some(_))
    assert_true(case.expect_state is Some(_))
    let parsed = parse(case.source)
    assert_eq(parsed.errors.length(), 0)

    let runner = mock_task_runner(
      case.scenarios,
      default_ok=case.runner_default_ok.unwrap_or(true),
      default_message=case.runner_default_message.unwrap_or(""),
    )
    let result = execute_ir(parsed.ir, runner.run)

    assert_eq(result.ok, case.expect_ok.unwrap_or(true))
    assert_eq(result.state, case.expect_state.unwrap_or(""))
    assert_eq(result.order.join(","), case.expect_order.join(","))

    let actual_steps : Array[String] = []
    for step in result.steps {
      actual_steps.push(step.id + ":" + step.status)
    }
    assert_eq(actual_steps.join(","), case.expect_steps.join(","))

    let issues_text = result.issues.join("\n")
    for expected in case.expect_issues_contains {
      assert_true(issues_text.contains(expected))
    }
    if case.expect_issues_count is Some(expected_count) {
      assert_eq(result.issues.length(), expected_count)
    }
  }
}
