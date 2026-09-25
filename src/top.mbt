///| Public re-export surface for `mizchi/flaker`.

///|

///| Core data contracts are also available directly from

///| `mizchi/flaker/contracts` when a stricter boundary is preferred.

///|
/// Shared data contracts
pub using @contracts {
  type StableVariantEntryInput,
  type TestMeta,
  type SamplingHistoryRowInput,
  type SamplingListedTestInput,
  type FlakyResult,
  type DetectInput,
  type TestRunEntry,
  type DetectOutput,
  type GraphNodeInput,
  type DependencyGraphInput,
  type ReverseDepEntry,
  type ReportDiffStatusInput,
  type ReportDiffBuckets,
  type ReportTotalsInput,
  type ReportAggregateUnstableStatusInput,
  type ReportAggregateShardInput,
  type ReportAggregateUnstableBuckets,
  type ReportAggregateOutput,
  type ReportSummaryTestInput,
  type ReportFileTotalsOutput,
  type ReportSummaryOutput,
  type QuarantineTaskOwnershipInput,
  type QuarantineEntryInput,
  type QuarantineIssueOutput,
  type QuarantineModeCountsOutput,
  type QuarantineScopeCountsOutput,
  type ResolvedQuarantineEntryOutput,
  type QuarantineSummaryCoreOutput,
  type QuarantineRuntimeResultInput,
  type ConfigCheckListedTestInput,
  type ConfigCheckTaskDefinitionInput,
  type ConfigOwnershipClaimOutput,
  type ConfigOwnershipEntryOutput,
  type ConfigCheckIssueOutput,
  type ConfigTaskSummaryOutput,
  type ConfigCheckSummaryOutput,
  type ConfigCheckCoreOutput,
  type EvalCommitSignalInput,
  type SamplingKpiSignalOutput,
  type SamplingKpiMissesOutput,
  type SamplingKpiConfusionMatrixOutput,
  type SamplingKpiOutput,
  type HoldoutCommitInput,
  type HoldoutKpiOutput,
  type AffectedTargetInput,
  type AffectedDirectSelectionInput,
  type AffectedTransitiveTaskInput,
  type AffectedReportInput,
  type AffectedSelectionOutput,
  type AffectedReportSummaryOutput,
  type AffectedReportCoreOutput,
  type StableTestIdentityInput,
  type ResolvedStableTestIdentityOutput,
}

///|
/// Flaky-test detection
pub using @flaky_detector {detect_flaky}

///|
/// Sampling metadata and strategies
pub using @sampling {
  build_sampling_meta,
  sample_random,
  sample_weighted,
  sample_hybrid,
}

///|
/// Affected selection and explain helpers
pub using @affected {resolve_affected}

///|
pub using @affected_explain {
  dedupe_affected_targets,
  build_affected_report,
  build_affected_report_from_input,
}

///|
/// Stable test identity
pub using @identity {create_stable_test_id, resolve_test_identity}

///|
/// Generic dependency-graph helpers
pub using @graph {
  find_affected_nodes,
  expand_transitive,
  build_reverse_deps,
  topological_sort,
  get_affected_test_patterns,
}

///|
/// Report reducers
pub using @report_summary {summarize_report}

///|
pub using @report_diff {classify_report_diff}

///|
pub using @report_aggregate {aggregate_report}

///|
/// Quarantine policy
pub using @quarantine {
  summarize_quarantine,
  find_matching_quarantine,
  is_blocking_failure,
  compute_quarantine_exit_code,
}

///|
/// Config ownership analysis
pub using @config {run_config_check}

///|
/// Evaluation metrics
pub using @eval {build_sampling_kpi, build_holdout_kpi}
