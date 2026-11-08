// Explicit trait extensions preserve the public method API.

///|
pub extend AffectedDirectSelectionInput with @debug.Debug::{to_repr}

///|
pub extend AffectedDirectSelectionInput with @json.FromJson::{from_json}

///|
pub extend AffectedDirectSelectionInput with @json.ToJson::{to_json}

///|
pub extend AffectedDirectSelectionInput with Eq::{not_equal, equal}

///|
pub extend AffectedDirectSelectionInput with Show::{to_string, output}

///|
pub extend AffectedReportCoreOutput with @debug.Debug::{to_repr}

///|
pub extend AffectedReportCoreOutput with @json.FromJson::{from_json}

///|
pub extend AffectedReportCoreOutput with @json.ToJson::{to_json}

///|
pub extend AffectedReportCoreOutput with Eq::{not_equal, equal}

///|
pub extend AffectedReportCoreOutput with Show::{to_string, output}

///|
pub extend AffectedReportInput with @debug.Debug::{to_repr}

///|
pub extend AffectedReportInput with @json.FromJson::{from_json}

///|
pub extend AffectedReportInput with @json.ToJson::{to_json}

///|
pub extend AffectedReportInput with Eq::{not_equal, equal}

///|
pub extend AffectedReportInput with Show::{to_string, output}

///|
pub extend AffectedReportSummaryOutput with @debug.Debug::{to_repr}

///|
pub extend AffectedReportSummaryOutput with @json.FromJson::{from_json}

///|
pub extend AffectedReportSummaryOutput with @json.ToJson::{to_json}

///|
pub extend AffectedReportSummaryOutput with Eq::{not_equal, equal}

///|
pub extend AffectedReportSummaryOutput with Show::{to_string, output}

///|
pub extend AffectedSelectionOutput with @debug.Debug::{to_repr}

///|
pub extend AffectedSelectionOutput with @json.FromJson::{from_json}

///|
pub extend AffectedSelectionOutput with @json.ToJson::{to_json}

///|
pub extend AffectedSelectionOutput with Eq::{not_equal, equal}

///|
pub extend AffectedSelectionOutput with Show::{to_string, output}

///|
pub extend AffectedTargetInput with @debug.Debug::{to_repr}

///|
pub extend AffectedTargetInput with @json.FromJson::{from_json}

///|
pub extend AffectedTargetInput with @json.ToJson::{to_json}

///|
pub extend AffectedTargetInput with Eq::{not_equal, equal}

///|
pub extend AffectedTargetInput with Show::{to_string, output}

///|
pub extend AffectedTransitiveTaskInput with @debug.Debug::{to_repr}

///|
pub extend AffectedTransitiveTaskInput with @json.FromJson::{from_json}

///|
pub extend AffectedTransitiveTaskInput with @json.ToJson::{to_json}

///|
pub extend AffectedTransitiveTaskInput with Eq::{not_equal, equal}

///|
pub extend AffectedTransitiveTaskInput with Show::{to_string, output}

///|
pub extend ConfigCheckCoreOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigCheckCoreOutput with @json.FromJson::{from_json}

///|
pub extend ConfigCheckCoreOutput with @json.ToJson::{to_json}

///|
pub extend ConfigCheckCoreOutput with Eq::{not_equal, equal}

///|
pub extend ConfigCheckCoreOutput with Show::{to_string, output}

///|
pub extend ConfigCheckIssueOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigCheckIssueOutput with @json.FromJson::{from_json}

///|
pub extend ConfigCheckIssueOutput with @json.ToJson::{to_json}

///|
pub extend ConfigCheckIssueOutput with Eq::{not_equal, equal}

///|
pub extend ConfigCheckIssueOutput with Show::{to_string, output}

///|
pub extend ConfigCheckListedTestInput with @debug.Debug::{to_repr}

///|
pub extend ConfigCheckListedTestInput with @json.FromJson::{from_json}

///|
pub extend ConfigCheckListedTestInput with @json.ToJson::{to_json}

///|
pub extend ConfigCheckListedTestInput with Eq::{not_equal, equal}

///|
pub extend ConfigCheckListedTestInput with Show::{to_string, output}

///|
pub extend ConfigCheckSummaryOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigCheckSummaryOutput with @json.FromJson::{from_json}

///|
pub extend ConfigCheckSummaryOutput with @json.ToJson::{to_json}

///|
pub extend ConfigCheckSummaryOutput with Eq::{not_equal, equal}

///|
pub extend ConfigCheckSummaryOutput with Show::{to_string, output}

///|
pub extend ConfigCheckTaskDefinitionInput with @debug.Debug::{to_repr}

///|
pub extend ConfigCheckTaskDefinitionInput with @json.FromJson::{from_json}

///|
pub extend ConfigCheckTaskDefinitionInput with @json.ToJson::{to_json}

///|
pub extend ConfigCheckTaskDefinitionInput with Eq::{not_equal, equal}

///|
pub extend ConfigCheckTaskDefinitionInput with Show::{to_string, output}

///|
pub extend ConfigOwnershipClaimOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigOwnershipClaimOutput with @json.FromJson::{from_json}

///|
pub extend ConfigOwnershipClaimOutput with @json.ToJson::{to_json}

///|
pub extend ConfigOwnershipClaimOutput with Eq::{not_equal, equal}

///|
pub extend ConfigOwnershipClaimOutput with Show::{to_string, output}

///|
pub extend ConfigOwnershipEntryOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigOwnershipEntryOutput with @json.FromJson::{from_json}

///|
pub extend ConfigOwnershipEntryOutput with @json.ToJson::{to_json}

///|
pub extend ConfigOwnershipEntryOutput with Eq::{not_equal, equal}

///|
pub extend ConfigOwnershipEntryOutput with Show::{to_string, output}

///|
pub extend ConfigTaskSummaryOutput with @debug.Debug::{to_repr}

///|
pub extend ConfigTaskSummaryOutput with @json.FromJson::{from_json}

///|
pub extend ConfigTaskSummaryOutput with @json.ToJson::{to_json}

///|
pub extend ConfigTaskSummaryOutput with Eq::{not_equal, equal}

///|
pub extend ConfigTaskSummaryOutput with Show::{to_string, output}

///|
pub extend DependencyGraphInput with @debug.Debug::{to_repr}

///|
pub extend DependencyGraphInput with @json.FromJson::{from_json}

///|
pub extend DependencyGraphInput with @json.ToJson::{to_json}

///|
pub extend DependencyGraphInput with Eq::{not_equal, equal}

///|
pub extend DependencyGraphInput with Show::{to_string, output}

///|
pub extend DetectInput with @json.FromJson::{from_json}

///|
pub extend DetectInput with @json.ToJson::{to_json}

///|
pub extend DetectOutput with @debug.Debug::{to_repr}

///|
pub extend DetectOutput with @json.FromJson::{from_json}

///|
pub extend DetectOutput with @json.ToJson::{to_json}

///|
pub extend DetectOutput with Eq::{not_equal, equal}

///|
pub extend DetectOutput with Show::{to_string, output}

///|
pub extend EvalCommitSignalInput with @debug.Debug::{to_repr}

///|
pub extend EvalCommitSignalInput with @json.FromJson::{from_json}

///|
pub extend EvalCommitSignalInput with @json.ToJson::{to_json}

///|
pub extend EvalCommitSignalInput with Eq::{not_equal, equal}

///|
pub extend EvalCommitSignalInput with Show::{to_string, output}

///|
pub extend FlakyResult with @debug.Debug::{to_repr}

///|
pub extend FlakyResult with @json.FromJson::{from_json}

///|
pub extend FlakyResult with @json.ToJson::{to_json}

///|
pub extend FlakyResult with Eq::{not_equal, equal}

///|
pub extend FlakyResult with Show::{to_string, output}

///|
pub extend GraphNodeInput with @debug.Debug::{to_repr}

///|
pub extend GraphNodeInput with @json.FromJson::{from_json}

///|
pub extend GraphNodeInput with @json.ToJson::{to_json}

///|
pub extend GraphNodeInput with Eq::{not_equal, equal}

///|
pub extend GraphNodeInput with Show::{to_string, output}

///|
pub extend HoldoutCommitInput with @debug.Debug::{to_repr}

///|
pub extend HoldoutCommitInput with @json.FromJson::{from_json}

///|
pub extend HoldoutCommitInput with @json.ToJson::{to_json}

///|
pub extend HoldoutCommitInput with Eq::{not_equal, equal}

///|
pub extend HoldoutCommitInput with Show::{to_string, output}

///|
pub extend HoldoutKpiOutput with @debug.Debug::{to_repr}

///|
pub extend HoldoutKpiOutput with @json.FromJson::{from_json}

///|
pub extend HoldoutKpiOutput with @json.ToJson::{to_json}

///|
pub extend HoldoutKpiOutput with Eq::{not_equal, equal}

///|
pub extend HoldoutKpiOutput with Show::{to_string, output}

///|
pub extend QuarantineEntryInput with @debug.Debug::{to_repr}

///|
pub extend QuarantineEntryInput with @json.FromJson::{from_json}

///|
pub extend QuarantineEntryInput with @json.ToJson::{to_json}

///|
pub extend QuarantineEntryInput with Eq::{not_equal, equal}

///|
pub extend QuarantineEntryInput with Show::{to_string, output}

///|
pub extend QuarantineIssueOutput with @debug.Debug::{to_repr}

///|
pub extend QuarantineIssueOutput with @json.FromJson::{from_json}

///|
pub extend QuarantineIssueOutput with @json.ToJson::{to_json}

///|
pub extend QuarantineIssueOutput with Eq::{not_equal, equal}

///|
pub extend QuarantineIssueOutput with Show::{to_string, output}

///|
pub extend QuarantineModeCountsOutput with @debug.Debug::{to_repr}

///|
pub extend QuarantineModeCountsOutput with @json.FromJson::{from_json}

///|
pub extend QuarantineModeCountsOutput with @json.ToJson::{to_json}

///|
pub extend QuarantineModeCountsOutput with Eq::{not_equal, equal}

///|
pub extend QuarantineModeCountsOutput with Show::{to_string, output}

///|
pub extend QuarantineRuntimeResultInput with @debug.Debug::{to_repr}

///|
pub extend QuarantineRuntimeResultInput with @json.FromJson::{from_json}

///|
pub extend QuarantineRuntimeResultInput with @json.ToJson::{to_json}

///|
pub extend QuarantineRuntimeResultInput with Eq::{not_equal, equal}

///|
pub extend QuarantineRuntimeResultInput with Show::{to_string, output}

///|
pub extend QuarantineScopeCountsOutput with @debug.Debug::{to_repr}

///|
pub extend QuarantineScopeCountsOutput with @json.FromJson::{from_json}

///|
pub extend QuarantineScopeCountsOutput with @json.ToJson::{to_json}

///|
pub extend QuarantineScopeCountsOutput with Eq::{not_equal, equal}

///|
pub extend QuarantineScopeCountsOutput with Show::{to_string, output}

///|
pub extend QuarantineSummaryCoreOutput with @debug.Debug::{to_repr}

///|
pub extend QuarantineSummaryCoreOutput with @json.FromJson::{from_json}

///|
pub extend QuarantineSummaryCoreOutput with @json.ToJson::{to_json}

///|
pub extend QuarantineSummaryCoreOutput with Eq::{not_equal, equal}

///|
pub extend QuarantineSummaryCoreOutput with Show::{to_string, output}

///|
pub extend QuarantineTaskOwnershipInput with @debug.Debug::{to_repr}

///|
pub extend QuarantineTaskOwnershipInput with @json.FromJson::{from_json}

///|
pub extend QuarantineTaskOwnershipInput with @json.ToJson::{to_json}

///|
pub extend QuarantineTaskOwnershipInput with Eq::{not_equal, equal}

///|
pub extend QuarantineTaskOwnershipInput with Show::{to_string, output}

///|
pub extend ReportAggregateOutput with @debug.Debug::{to_repr}

///|
pub extend ReportAggregateOutput with @json.FromJson::{from_json}

///|
pub extend ReportAggregateOutput with @json.ToJson::{to_json}

///|
pub extend ReportAggregateOutput with Eq::{not_equal, equal}

///|
pub extend ReportAggregateOutput with Show::{to_string, output}

///|
pub extend ReportAggregateShardInput with @debug.Debug::{to_repr}

///|
pub extend ReportAggregateShardInput with @json.FromJson::{from_json}

///|
pub extend ReportAggregateShardInput with @json.ToJson::{to_json}

///|
pub extend ReportAggregateShardInput with Eq::{not_equal, equal}

///|
pub extend ReportAggregateShardInput with Show::{to_string, output}

///|
pub extend ReportAggregateUnstableBuckets with @debug.Debug::{to_repr}

///|
pub extend ReportAggregateUnstableBuckets with @json.FromJson::{from_json}

///|
pub extend ReportAggregateUnstableBuckets with @json.ToJson::{to_json}

///|
pub extend ReportAggregateUnstableBuckets with Eq::{not_equal, equal}

///|
pub extend ReportAggregateUnstableBuckets with Show::{to_string, output}

///|
pub extend ReportAggregateUnstableStatusInput with @debug.Debug::{to_repr}

///|
pub extend ReportAggregateUnstableStatusInput with @json.FromJson::{from_json}

///|
pub extend ReportAggregateUnstableStatusInput with @json.ToJson::{to_json}

///|
pub extend ReportAggregateUnstableStatusInput with Eq::{not_equal, equal}

///|
pub extend ReportAggregateUnstableStatusInput with Show::{to_string, output}

///|
pub extend ReportDiffBuckets with @debug.Debug::{to_repr}

///|
pub extend ReportDiffBuckets with @json.FromJson::{from_json}

///|
pub extend ReportDiffBuckets with @json.ToJson::{to_json}

///|
pub extend ReportDiffBuckets with Eq::{not_equal, equal}

///|
pub extend ReportDiffBuckets with Show::{to_string, output}

///|
pub extend ReportDiffStatusInput with @debug.Debug::{to_repr}

///|
pub extend ReportDiffStatusInput with @json.FromJson::{from_json}

///|
pub extend ReportDiffStatusInput with @json.ToJson::{to_json}

///|
pub extend ReportDiffStatusInput with Eq::{not_equal, equal}

///|
pub extend ReportDiffStatusInput with Show::{to_string, output}

///|
pub extend ReportFileTotalsOutput with @debug.Debug::{to_repr}

///|
pub extend ReportFileTotalsOutput with @json.FromJson::{from_json}

///|
pub extend ReportFileTotalsOutput with @json.ToJson::{to_json}

///|
pub extend ReportFileTotalsOutput with Eq::{not_equal, equal}

///|
pub extend ReportFileTotalsOutput with Show::{to_string, output}

///|
pub extend ReportSummaryOutput with @debug.Debug::{to_repr}

///|
pub extend ReportSummaryOutput with @json.FromJson::{from_json}

///|
pub extend ReportSummaryOutput with @json.ToJson::{to_json}

///|
pub extend ReportSummaryOutput with Eq::{not_equal, equal}

///|
pub extend ReportSummaryOutput with Show::{to_string, output}

///|
pub extend ReportSummaryTestInput with @debug.Debug::{to_repr}

///|
pub extend ReportSummaryTestInput with @json.FromJson::{from_json}

///|
pub extend ReportSummaryTestInput with @json.ToJson::{to_json}

///|
pub extend ReportSummaryTestInput with Eq::{not_equal, equal}

///|
pub extend ReportSummaryTestInput with Show::{to_string, output}

///|
pub extend ReportTotalsInput with @debug.Debug::{to_repr}

///|
pub extend ReportTotalsInput with @json.FromJson::{from_json}

///|
pub extend ReportTotalsInput with @json.ToJson::{to_json}

///|
pub extend ReportTotalsInput with Eq::{not_equal, equal}

///|
pub extend ReportTotalsInput with Show::{to_string, output}

///|
pub extend ResolvedQuarantineEntryOutput with @debug.Debug::{to_repr}

///|
pub extend ResolvedQuarantineEntryOutput with @json.FromJson::{from_json}

///|
pub extend ResolvedQuarantineEntryOutput with @json.ToJson::{to_json}

///|
pub extend ResolvedQuarantineEntryOutput with Eq::{not_equal, equal}

///|
pub extend ResolvedQuarantineEntryOutput with Show::{to_string, output}

///|
pub extend ResolvedStableTestIdentityOutput with @debug.Debug::{to_repr}

///|
pub extend ResolvedStableTestIdentityOutput with @json.FromJson::{from_json}

///|
pub extend ResolvedStableTestIdentityOutput with @json.ToJson::{to_json}

///|
pub extend ResolvedStableTestIdentityOutput with Eq::{not_equal, equal}

///|
pub extend ResolvedStableTestIdentityOutput with Show::{to_string, output}

///|
pub extend ReverseDepEntry with @debug.Debug::{to_repr}

///|
pub extend ReverseDepEntry with @json.FromJson::{from_json}

///|
pub extend ReverseDepEntry with @json.ToJson::{to_json}

///|
pub extend ReverseDepEntry with Eq::{not_equal, equal}

///|
pub extend ReverseDepEntry with Show::{to_string, output}

///|
pub extend SamplingHistoryRowInput with @debug.Debug::{to_repr}

///|
pub extend SamplingHistoryRowInput with @json.FromJson::{from_json}

///|
pub extend SamplingHistoryRowInput with @json.ToJson::{to_json}

///|
pub extend SamplingHistoryRowInput with Eq::{not_equal, equal}

///|
pub extend SamplingHistoryRowInput with Show::{to_string, output}

///|
pub extend SamplingKpiConfusionMatrixOutput with @debug.Debug::{to_repr}

///|
pub extend SamplingKpiConfusionMatrixOutput with @json.FromJson::{from_json}

///|
pub extend SamplingKpiConfusionMatrixOutput with @json.ToJson::{to_json}

///|
pub extend SamplingKpiConfusionMatrixOutput with Eq::{not_equal, equal}

///|
pub extend SamplingKpiConfusionMatrixOutput with Show::{to_string, output}

///|
pub extend SamplingKpiMissesOutput with @debug.Debug::{to_repr}

///|
pub extend SamplingKpiMissesOutput with @json.FromJson::{from_json}

///|
pub extend SamplingKpiMissesOutput with @json.ToJson::{to_json}

///|
pub extend SamplingKpiMissesOutput with Eq::{not_equal, equal}

///|
pub extend SamplingKpiMissesOutput with Show::{to_string, output}

///|
pub extend SamplingKpiOutput with @debug.Debug::{to_repr}

///|
pub extend SamplingKpiOutput with @json.FromJson::{from_json}

///|
pub extend SamplingKpiOutput with @json.ToJson::{to_json}

///|
pub extend SamplingKpiOutput with Eq::{not_equal, equal}

///|
pub extend SamplingKpiOutput with Show::{to_string, output}

///|
pub extend SamplingKpiSignalOutput with @debug.Debug::{to_repr}

///|
pub extend SamplingKpiSignalOutput with @json.FromJson::{from_json}

///|
pub extend SamplingKpiSignalOutput with @json.ToJson::{to_json}

///|
pub extend SamplingKpiSignalOutput with Eq::{not_equal, equal}

///|
pub extend SamplingKpiSignalOutput with Show::{to_string, output}

///|
pub extend SamplingListedTestInput with @debug.Debug::{to_repr}

///|
pub extend SamplingListedTestInput with @json.FromJson::{from_json}

///|
pub extend SamplingListedTestInput with @json.ToJson::{to_json}

///|
pub extend SamplingListedTestInput with Eq::{not_equal, equal}

///|
pub extend SamplingListedTestInput with Show::{to_string, output}

///|
pub extend StableTestIdentityInput with @debug.Debug::{to_repr}

///|
pub extend StableTestIdentityInput with @json.FromJson::{from_json}

///|
pub extend StableTestIdentityInput with @json.ToJson::{to_json}

///|
pub extend StableTestIdentityInput with Eq::{not_equal, equal}

///|
pub extend StableTestIdentityInput with Show::{to_string, output}

///|
pub extend StableVariantEntryInput with @debug.Debug::{to_repr}

///|
pub extend StableVariantEntryInput with @json.FromJson::{from_json}

///|
pub extend StableVariantEntryInput with @json.ToJson::{to_json}

///|
pub extend StableVariantEntryInput with Eq::{not_equal, equal}

///|
pub extend StableVariantEntryInput with Show::{to_string, output}

///|
pub extend TestMeta with @debug.Debug::{to_repr}

///|
pub extend TestMeta with @json.FromJson::{from_json}

///|
pub extend TestMeta with @json.ToJson::{to_json}

///|
pub extend TestMeta with Eq::{not_equal, equal}

///|
pub extend TestMeta with Show::{to_string, output}

///|
pub extend TestRunEntry with @json.FromJson::{from_json}

///|
pub extend TestRunEntry with @json.ToJson::{to_json}
