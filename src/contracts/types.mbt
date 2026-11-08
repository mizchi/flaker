///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct StableVariantEntryInput {
  key : String
  value : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct TestMeta {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int32
  fail_count : Int32
  last_run_at : String
  avg_duration_ms : Int32
  previously_failed : Bool
  is_new : Bool
  task_id : String?
  filter : String?
  test_id : String?
  co_failure_boost : Double?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingHistoryRowInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
  status : String
  retry_count : Int32
  duration_ms : Int32
  created_at : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingListedTestInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct FlakyResult {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int32
  fail_count : Int32
  flaky_retry_count : Int32
  is_quarantined : Bool
}

///|
#derive(FromJson, ToJson)
pub(all) struct DetectInput {
  results : Array[TestRunEntry]
  threshold : Double
  min_runs : Int32
}

///|
#derive(FromJson, ToJson)
pub(all) struct TestRunEntry {
  suite : String
  test_name : String
  status : String
  retry_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct DetectOutput {
  flaky_tests : Array[FlakyResult]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct GraphNodeInput {
  id : String
  path : String
  dependencies : Array[String]
  source_patterns : Array[String]
  test_patterns : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct DependencyGraphInput {
  root_dir : String
  nodes : Array[GraphNodeInput]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReverseDepEntry {
  id : String
  dependents : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportDiffStatusInput {
  test_id : String
  base_status : String
  head_status : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportDiffBuckets {
  new_failures : Array[String]
  new_flaky : Array[String]
  resolved_failures : Array[String]
  resolved_flaky : Array[String]
  persistent_flaky : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportTotalsInput {
  total : Int32
  passed : Int32
  failed : Int32
  flaky : Int32
  skipped : Int32
  retries : Int32
  duration_ms : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportAggregateUnstableStatusInput {
  test_id : String
  status : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportAggregateShardInput {
  shard_id : String
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableStatusInput]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportAggregateUnstableBuckets {
  test_id : String
  shard_ids : Array[String]
  statuses : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportAggregateOutput {
  shard_count : Int32
  unstable_count : Int32
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableBuckets]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportSummaryTestInput {
  test_id : String
  suite : String
  status : String
  duration_ms : Int32
  retry_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportFileTotalsOutput {
  suite : String
  totals : ReportTotalsInput
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ReportSummaryOutput {
  totals : ReportTotalsInput
  file_totals : Array[ReportFileTotalsOutput]
  unstable_test_ids : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineTaskOwnershipInput {
  id : String
  specs : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineEntryInput {
  id : String
  task_id : String
  spec : String
  title_pattern : String
  mode : String
  scope : String
  owner : String
  reason : String
  condition : String
  introduced_at : String
  expires_at : String
  tracking_issue : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineIssueOutput {
  severity : String
  code : String
  message : String
  task_id : String?
  spec : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineModeCountsOutput {
  skip : Int32
  allow_flaky : Int32
  allow_failure : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineScopeCountsOutput {
  environment : Int32
  flaky : Int32
  expected_failure : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ResolvedQuarantineEntryOutput {
  id : String
  task_id : String
  spec : String
  title_pattern : String
  mode : String
  scope : String
  owner : String
  reason : String
  condition : String
  introduced_at : String
  expires_at : String
  tracking_issue : String?
  expiry_status : String
  days_until_expiry : Int32?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineSummaryCoreOutput {
  entry_count : Int32
  mode_counts : QuarantineModeCountsOutput
  scope_counts : QuarantineScopeCountsOutput
  entries : Array[ResolvedQuarantineEntryOutput]
  errors : Array[QuarantineIssueOutput]
  warnings : Array[QuarantineIssueOutput]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct QuarantineRuntimeResultInput {
  status : String
  quarantine_mode : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigCheckListedTestInput {
  suite : String
  task_id : String
  filter : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigCheckTaskDefinitionInput {
  task_id : String
  node : String?
  needs : Array[String]
  srcs : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigOwnershipClaimOutput {
  task_id : String
  filter : String?
  test_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigOwnershipEntryOutput {
  spec : String
  kind : String
  owners : Array[ConfigOwnershipClaimOutput]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigCheckIssueOutput {
  code : String
  spec : String
  detail : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigTaskSummaryOutput {
  task_id : String
  node : String?
  spec_count : Int32
  test_count : Int32
  filter_count : Int32
  needs_count : Int32
  src_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigCheckSummaryOutput {
  task_count : Int32
  spec_count : Int32
  duplicate_ownership_count : Int32
  split_ownership_count : Int32
  unmanaged_spec_count : Int32
  error_count : Int32
  warning_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ConfigCheckCoreOutput {
  summary : ConfigCheckSummaryOutput
  ownership : Array[ConfigOwnershipEntryOutput]
  tasks : Array[ConfigTaskSummaryOutput]
  errors : Array[ConfigCheckIssueOutput]
  warnings : Array[ConfigCheckIssueOutput]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct EvalCommitSignalInput {
  commit_sha : String
  run_kind : String
  run_count : Int32
  distinct_tests : Int32
  failure_signals : Int32
  duration_ms : Int32?
  fallback_used : Bool
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingKpiSignalOutput {
  local_commits : Int32
  ci_when_local : Int32
  rate : Double?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingKpiMissesOutput {
  local_pass_but_ci_fail : Int32
  local_fail_but_ci_pass : Int32
  false_negative_rate : Double?
  false_positive_rate : Double?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingKpiConfusionMatrixOutput {
  true_positive : Int32
  false_positive : Int32
  false_negative : Int32
  true_negative : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct SamplingKpiOutput {
  matched_commits : Int32
  local_only_commits : Int32
  ci_only_commits : Int32
  avg_local_sample_size : Double?
  median_local_sample_size : Double?
  p95_local_sample_size : Double?
  avg_ci_test_count : Double?
  avg_sample_ratio : Double?
  avg_saved_minutes : Double?
  fallback_runs : Int32
  fallback_rate : Double?
  pass_signal : SamplingKpiSignalOutput
  fail_signal : SamplingKpiSignalOutput
  misses : SamplingKpiMissesOutput
  confusion_matrix : SamplingKpiConfusionMatrixOutput
}

///|
/// Holdout tests of one commit's local sampled run: tests the sampler held
/// out on purpose, and how many of them failed in CI on the same commit.
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct HoldoutCommitInput {
  commit_sha : String
  holdout_tests : Int32
  holdout_failures : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct HoldoutKpiOutput {
  commits : Int32
  holdout_tests : Int32
  holdout_failures : Int32
  false_negative_rate : Double?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedTargetInput {
  spec : String
  task_id : String
  filter : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedDirectSelectionInput {
  spec : String
  task_id : String
  filter : String?
  matched_paths : Array[String]
  match_reasons : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedTransitiveTaskInput {
  task_id : String
  included_by : Array[String]
  match_reasons : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedReportInput {
  targets : Array[AffectedTargetInput]
  direct_selections : Array[AffectedDirectSelectionInput]
  transitive_tasks : Array[AffectedTransitiveTaskInput]
  unmatched : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedSelectionOutput {
  task_id : String
  spec : String
  filter : String?
  direct : Bool
  included_by : Array[String]
  matched_paths : Array[String]
  match_reasons : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedReportSummaryOutput {
  matched_count : Int32
  selected_count : Int32
  unmatched_count : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct AffectedReportCoreOutput {
  matched : Array[AffectedSelectionOutput]
  selected : Array[AffectedSelectionOutput]
  unmatched : Array[String]
  summary : AffectedReportSummaryOutput
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct StableTestIdentityInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, Debug, FromJson, ToJson)
pub(all) struct ResolvedStableTestIdentityOutput {
  suite : String
  test_name : String
  task_id : String
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String
}
