///|
pub(all) struct StableVariantEntryInput {
  key : String
  value : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct TestMeta {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  last_run_at : String
  avg_duration_ms : Int
  previously_failed : Bool
  is_new : Bool
  task_id : String?
  filter : String?
  test_id : String?
  co_failure_boost : Double
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingHistoryRowInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
  status : String
  retry_count : Int
  duration_ms : Int
  created_at : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingListedTestInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FlakyResult {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  flaky_retry_count : Int
  is_quarantined : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct DetectInput {
  results : Array[TestRunEntry]
  threshold : Double
  min_runs : Int
} derive(FromJson, ToJson)

///|
pub(all) struct TestRunEntry {
  suite : String
  test_name : String
  status : String
  retry_count : Int
} derive(FromJson, ToJson)

///|
pub(all) struct DetectOutput {
  flaky_tests : Array[FlakyResult]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct GraphNodeInput {
  id : String
  path : String
  dependencies : Array[String]
  source_patterns : Array[String]
  test_patterns : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct DependencyGraphInput {
  root_dir : String
  nodes : Array[GraphNodeInput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReverseDepEntry {
  id : String
  dependents : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportDiffStatusInput {
  test_id : String
  base_status : String
  head_status : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportDiffBuckets {
  new_failures : Array[String]
  new_flaky : Array[String]
  resolved_failures : Array[String]
  resolved_flaky : Array[String]
  persistent_flaky : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportTotalsInput {
  total : Int
  passed : Int
  failed : Int
  flaky : Int
  skipped : Int
  retries : Int
  duration_ms : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateUnstableStatusInput {
  test_id : String
  status : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateShardInput {
  shard_id : String
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableStatusInput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateUnstableBuckets {
  test_id : String
  shard_ids : Array[String]
  statuses : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateOutput {
  shard_count : Int
  unstable_count : Int
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableBuckets]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportSummaryTestInput {
  test_id : String
  suite : String
  status : String
  duration_ms : Int
  retry_count : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportFileTotalsOutput {
  suite : String
  totals : ReportTotalsInput
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportSummaryOutput {
  totals : ReportTotalsInput
  file_totals : Array[ReportFileTotalsOutput]
  unstable_test_ids : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineTaskOwnershipInput {
  id : String
  specs : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
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
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineIssueOutput {
  severity : String
  code : String
  message : String
  task_id : String?
  spec : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineModeCountsOutput {
  skip : Int
  allow_flaky : Int
  allow_failure : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineScopeCountsOutput {
  environment : Int
  flaky : Int
  expected_failure : Int
} derive(Eq, Show, FromJson, ToJson)

///|
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
  days_until_expiry : Int?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineSummaryCoreOutput {
  entry_count : Int
  mode_counts : QuarantineModeCountsOutput
  scope_counts : QuarantineScopeCountsOutput
  entries : Array[ResolvedQuarantineEntryOutput]
  errors : Array[QuarantineIssueOutput]
  warnings : Array[QuarantineIssueOutput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct QuarantineRuntimeResultInput {
  status : String
  quarantine_mode : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigCheckListedTestInput {
  suite : String
  task_id : String
  filter : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigCheckTaskDefinitionInput {
  task_id : String
  node : String?
  needs : Array[String]
  srcs : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigOwnershipClaimOutput {
  task_id : String
  filter : String?
  test_count : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigOwnershipEntryOutput {
  spec : String
  kind : String
  owners : Array[ConfigOwnershipClaimOutput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigCheckIssueOutput {
  code : String
  spec : String
  detail : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigTaskSummaryOutput {
  task_id : String
  node : String?
  spec_count : Int
  test_count : Int
  filter_count : Int
  needs_count : Int
  src_count : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigCheckSummaryOutput {
  task_count : Int
  spec_count : Int
  duplicate_ownership_count : Int
  split_ownership_count : Int
  unmanaged_spec_count : Int
  error_count : Int
  warning_count : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ConfigCheckCoreOutput {
  summary : ConfigCheckSummaryOutput
  ownership : Array[ConfigOwnershipEntryOutput]
  tasks : Array[ConfigTaskSummaryOutput]
  errors : Array[ConfigCheckIssueOutput]
  warnings : Array[ConfigCheckIssueOutput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct EvalCommitSignalInput {
  commit_sha : String
  run_kind : String
  run_count : Int
  distinct_tests : Int
  failure_signals : Int
  duration_ms : Int?
  fallback_used : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingKpiSignalOutput {
  local_commits : Int
  ci_when_local : Int
  rate : Double?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingKpiMissesOutput {
  local_pass_but_ci_fail : Int
  local_fail_but_ci_pass : Int
  false_negative_rate : Double?
  false_positive_rate : Double?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingKpiConfusionMatrixOutput {
  true_positive : Int
  false_positive : Int
  false_negative : Int
  true_negative : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct SamplingKpiOutput {
  matched_commits : Int
  local_only_commits : Int
  ci_only_commits : Int
  avg_local_sample_size : Double?
  median_local_sample_size : Double?
  p95_local_sample_size : Double?
  avg_ci_test_count : Double?
  avg_sample_ratio : Double?
  avg_saved_minutes : Double?
  fallback_runs : Int
  fallback_rate : Double?
  pass_signal : SamplingKpiSignalOutput
  fail_signal : SamplingKpiSignalOutput
  misses : SamplingKpiMissesOutput
  confusion_matrix : SamplingKpiConfusionMatrixOutput
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedTargetInput {
  spec : String
  task_id : String
  filter : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedDirectSelectionInput {
  spec : String
  task_id : String
  filter : String?
  matched_paths : Array[String]
  match_reasons : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedTransitiveTaskInput {
  task_id : String
  included_by : Array[String]
  match_reasons : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedReportInput {
  targets : Array[AffectedTargetInput]
  direct_selections : Array[AffectedDirectSelectionInput]
  transitive_tasks : Array[AffectedTransitiveTaskInput]
  unmatched : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedSelectionOutput {
  task_id : String
  spec : String
  filter : String?
  direct : Bool
  included_by : Array[String]
  matched_paths : Array[String]
  match_reasons : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedReportSummaryOutput {
  matched_count : Int
  selected_count : Int
  unmatched_count : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct AffectedReportCoreOutput {
  matched : Array[AffectedSelectionOutput]
  selected : Array[AffectedSelectionOutput]
  unmatched : Array[String]
  summary : AffectedReportSummaryOutput
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct StableTestIdentityInput {
  suite : String
  test_name : String
  task_id : String?
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String?
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ResolvedStableTestIdentityOutput {
  suite : String
  test_name : String
  task_id : String
  filter : String?
  variant : Array[StableVariantEntryInput]?
  test_id : String
} derive(Eq, Show, FromJson, ToJson)
