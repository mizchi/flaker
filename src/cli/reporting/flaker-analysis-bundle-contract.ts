import type { FailureCluster } from "../failure-clusters.js";
import type { FlakerContext } from "../commands/analyze/context.js";
import type { EvalReport } from "../commands/analyze/eval.js";
import type { FlakerKpi } from "../commands/analyze/kpi.js";
import type { ReasoningReport } from "../commands/analyze/reason.js";
import type { InsightsResult } from "../commands/analyze/insights.js";
import type { WorkflowRunSource } from "../run-source.js";
import type { QuarantineManifestEntry } from "../quarantine-manifest.js";

export type FlakerAnalysisBundleArtifactKind =
  | "stdout"
  | "stderr"
  | "trace"
  | "screenshot"
  | "video"
  | "report"
  | "archive"
  | "log"
  | "other";

export interface FlakerAnalysisBundleArtifactRef {
  path: string;
  fileName: string;
  kind: FlakerAnalysisBundleArtifactKind;
  contentType: string | null;
}

export interface FlakerAnalysisBundleFailureLocation {
  file: string;
  line: number;
  column: number | null;
  functionName: string | null;
  raw: string;
}

export interface FlakerAnalysisBundleWorkflowArtifactRef {
  workflowRunId: number;
  repo: string | null;
  source: WorkflowRunSource;
  adapterType: string;
  adapterConfig: string;
  artifactName: string;
  artifactId: number | null;
  localArchivePath: string | null;
  entryNames: string[];
  downloadCommand: string | null;
}

export interface FlakerAnalysisBundleRelatedWorkflowArtifact
  extends FlakerAnalysisBundleWorkflowArtifactRef {
  matchedEntries: string[];
  matchedArtifacts: FlakerAnalysisBundleArtifactRef[];
}

export interface FlakerAnalysisBundleRecentFailure {
  testId: string;
  taskId: string;
  suite: string;
  testName: string;
  filter: string | null;
  status: string;
  errorMessage: string | null;
  failureLocation: FlakerAnalysisBundleFailureLocation | null;
  stdout: string | null;
  stderr: string | null;
  artifactPaths: string[];
  artifacts: FlakerAnalysisBundleArtifactRef[];
  workflowRunId: number;
  workflowArtifacts: FlakerAnalysisBundleWorkflowArtifactRef[];
  relatedWorkflowArtifacts: FlakerAnalysisBundleRelatedWorkflowArtifact[];
  retryCount: number;
  durationMs: number | null;
  variant: Record<string, string> | null;
  quarantine: QuarantineManifestEntry | null;
  commitSha: string;
  source: WorkflowRunSource;
  branch: string | null;
  event: string | null;
  createdAt: string;
}

export interface FlakerAnalysisBundleSampleError {
  fingerprint: string;
  message: string;
  count: number;
  sources: WorkflowRunSource[];
  lastSeenAt: string;
}

export interface FlakerAnalysisBundleHistoryEntry {
  commitSha: string;
  status: string;
  retryCount: number;
  durationMs: number | null;
  errorMessage: string | null;
  failureLocation: FlakerAnalysisBundleFailureLocation | null;
  stdout: string | null;
  stderr: string | null;
  artifactPaths: string[];
  artifacts: FlakerAnalysisBundleArtifactRef[];
  workflowRunId: number;
  workflowArtifacts: FlakerAnalysisBundleWorkflowArtifactRef[];
  relatedWorkflowArtifacts: FlakerAnalysisBundleRelatedWorkflowArtifact[];
  source: WorkflowRunSource;
  branch: string | null;
  event: string | null;
  variant: Record<string, string> | null;
  quarantine: QuarantineManifestEntry | null;
  createdAt: string;
}

export interface FlakerAnalysisBundleFailureEvidence {
  testId: string;
  taskId: string;
  suite: string;
  testName: string;
  filter: string | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  failureSignals: number;
  passCount: number;
  failureRate: number;
  firstSeenAt: string;
  lastFailureAt: string | null;
  isQuarantined: boolean;
  sources: WorkflowRunSource[];
  variantsSeen: Record<string, string>[];
  activeQuarantines: QuarantineManifestEntry[];
  sampleErrors: FlakerAnalysisBundleSampleError[];
  recentHistory: FlakerAnalysisBundleHistoryEntry[];
}

export interface FlakerAnalysisBundle {
  schemaVersion: 1;
  generatedAt: string;
  windowDays: number;
  data: {
    workflowRuns: {
      total: number;
      ci: number;
      local: number;
    };
    testResults: {
      total: number;
      uniqueTests: number;
      uniqueCommits: number;
    };
    recentFailures: FlakerAnalysisBundleRecentFailure[];
    failureEvidence: FlakerAnalysisBundleFailureEvidence[];
  };
  analysis: {
    context: FlakerContext;
    kpi: FlakerKpi;
    eval: EvalReport;
    reason: ReasoningReport;
    insights: InsightsResult;
    clusters: FailureCluster[];
  };
}
