///|
fn main {
  ()
}

///|
pub fn detect_flaky_json(input_json : String) -> String {
  let input : @types.DetectInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let output = @flaky_detector.detect_flaky(input)
  output.to_json().stringify()
}

///|
pub fn sample_random_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_random(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_weighted_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_weighted(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_hybrid_json(meta_json : String, affected_json : String, count : Int, seed : Int) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(try! @json.parse(meta_json))
  let affected : Array[String] = try! @json.from_json(try! @json.parse(affected_json))
  let result = @sampler.sample_hybrid(meta, affected_suites=affected, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn resolve_affected_json(
  workflow_text : String,
  changed_paths_json : String,
) -> String {
  let changed : Array[String] = try! @json.from_json(
    try! @json.parse(changed_paths_json),
  )
  let result = @affected.resolve_affected(workflow_text, changed)
  result.to_json().stringify()
}

///|
pub fn create_stable_test_id_json(input_json : String) -> String {
  let input : @types.StableTestIdentityInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let result = @identity_core.create_stable_test_id(input)
  result.to_json().stringify()
}

///|
pub fn resolve_test_identity_json(input_json : String) -> String {
  let input : @types.StableTestIdentityInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let result = @identity_core.resolve_test_identity(input)
  result.to_json().stringify()
}

///|
pub fn dedupe_affected_targets_json(targets_json : String) -> String {
  let targets : Array[@types.AffectedTargetInput] = try! @json.from_json(
    try! @json.parse(targets_json),
  )
  let result = @affected_explain.dedupe_affected_targets(targets)
  result.to_json().stringify()
}

///|
pub fn build_affected_report_json(
  targets_json : String,
  direct_selections_json : String,
  transitive_tasks_json : String,
  unmatched_json : String,
) -> String {
  let targets : Array[@types.AffectedTargetInput] = try! @json.from_json(
    try! @json.parse(targets_json),
  )
  let direct_selections : Array[@types.AffectedDirectSelectionInput] = try! @json.from_json(
    try! @json.parse(direct_selections_json),
  )
  let transitive_tasks : Array[@types.AffectedTransitiveTaskInput] = try! @json.from_json(
    try! @json.parse(transitive_tasks_json),
  )
  let unmatched : Array[String] = try! @json.from_json(
    try! @json.parse(unmatched_json),
  )
  let result = @affected_explain.build_affected_report(
    targets,
    direct_selections,
    transitive_tasks,
    unmatched,
  )
  result.to_json().stringify()
}

///|
pub fn find_affected_nodes_json(
  graph_json : String,
  changed_files_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let changed : Array[String] = try! @json.from_json(
    try! @json.parse(changed_files_json),
  )
  let result = @graph_core.find_affected_nodes(graph, changed)
  result.to_json().stringify()
}

///|
pub fn expand_transitive_json(
  graph_json : String,
  initial_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let initial : Array[String] = try! @json.from_json(
    try! @json.parse(initial_json),
  )
  let result = @graph_core.expand_transitive(graph, initial)
  result.to_json().stringify()
}

///|
pub fn build_reverse_deps_json(graph_json : String) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let result = @graph_core.build_reverse_deps(graph)
  result.to_json().stringify()
}

///|
pub fn topological_sort_json(graph_json : String) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let result = @graph_core.topological_sort(graph)
  result.to_json().stringify()
}

///|
pub fn get_affected_test_patterns_json(
  graph_json : String,
  affected_ids_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let affected_ids : Array[String] = try! @json.from_json(
    try! @json.parse(affected_ids_json),
  )
  let result = @graph_core.get_affected_test_patterns(graph, affected_ids)
  result.to_json().stringify()
}

///|
pub fn classify_report_diff_json(inputs_json : String) -> String {
  let inputs : Array[@types.ReportDiffStatusInput] = try! @json.from_json(
    try! @json.parse(inputs_json),
  )
  let result = @report_diff_core.classify_report_diff(inputs)
  result.to_json().stringify()
}

///|
pub fn aggregate_report_json(shards_json : String) -> String {
  let shards : Array[@types.ReportAggregateShardInput] = try! @json.from_json(
    try! @json.parse(shards_json),
  )
  let result = @report_aggregate_core.aggregate_report(shards)
  result.to_json().stringify()
}

///|
pub fn summarize_report_json(tests_json : String) -> String {
  let tests : Array[@types.ReportSummaryTestInput] = try! @json.from_json(
    try! @json.parse(tests_json),
  )
  let result = @report_summary_core.summarize_report(tests)
  result.to_json().stringify()
}

///|
pub fn summarize_quarantine_json(
  entries_json : String,
  tasks_json : String,
  existing_specs_json : String,
  now_date : String,
  expires_soon_days : Int,
) -> String {
  let entries : Array[@types.QuarantineEntryInput] = try! @json.from_json(
    try! @json.parse(entries_json),
  )
  let tasks : Array[@types.QuarantineTaskOwnershipInput] = try! @json.from_json(
    try! @json.parse(tasks_json),
  )
  let existing_specs : Array[String] = try! @json.from_json(
    try! @json.parse(existing_specs_json),
  )
  let result = @quarantine_core.summarize_quarantine(
    entries,
    tasks,
    existing_specs,
    now_date,
    expires_soon_days,
  )
  result.to_json().stringify()
}

///|
pub fn find_matching_quarantine_json(
  entries_json : String,
  task_id : String,
  spec : String,
  title : String,
) -> String {
  let entries : Array[@types.QuarantineEntryInput] = try! @json.from_json(
    try! @json.parse(entries_json),
  )
  let result = @quarantine_core.find_matching_quarantine(entries, task_id, spec, title)
  result.to_json().stringify()
}

///|
pub fn is_blocking_failure_json(result_json : String) -> String {
  let result : @types.QuarantineRuntimeResultInput = try! @json.from_json(
    try! @json.parse(result_json),
  )
  let blocking = @quarantine_core.is_blocking_failure(result)
  blocking.to_json().stringify()
}

///|
pub fn compute_quarantine_exit_code_json(
  results_json : String,
  fallback_exit_code : Int,
) -> String {
  let results : Array[@types.QuarantineRuntimeResultInput] = try! @json.from_json(
    try! @json.parse(results_json),
  )
  let exit_code = @quarantine_core.compute_quarantine_exit_code(
    results,
    fallback_exit_code,
  )
  exit_code.to_json().stringify()
}

///|
pub fn run_config_check_json(
  listed_tests_json : String,
  discovered_specs_json : String,
  task_definitions_json : String,
) -> String {
  let listed_tests : Array[@types.ConfigCheckListedTestInput] = try! @json.from_json(
    try! @json.parse(listed_tests_json),
  )
  let discovered_specs : Array[String] = try! @json.from_json(
    try! @json.parse(discovered_specs_json),
  )
  let task_definitions : Array[@types.ConfigCheckTaskDefinitionInput] = try! @json.from_json(
    try! @json.parse(task_definitions_json),
  )
  let result = @config_check_core.run_config_check(
    listed_tests,
    discovered_specs,
    task_definitions,
  )
  result.to_json().stringify()
}

///|
pub fn build_sampling_kpi_json(rows_json : String) -> String {
  let rows : Array[@types.EvalCommitSignalInput] = try! @json.from_json(
    try! @json.parse(rows_json),
  )
  let result = @eval_core.build_sampling_kpi(rows)
  result.to_json().stringify()
}
