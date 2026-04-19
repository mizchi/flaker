import type { FlakerConfig } from "../../config.js";
import type { GateName } from "../../gate.js";
import { profileNameFromGateName } from "../../gate.js";
import { resolveProfile } from "../../profile-compat.js";
import { workflowRunSourceSql } from "../../run-source.js";
import type { MetricStore } from "../../storage/types.js";
import { computeKpi } from "../analyze/kpi.js";
import { buildGateReview, type GateReviewStatus } from "./review.js";

export interface GateHistoryEntry {
  date: string;
  totalRuns: number;
  passRate: number | null;
  failureRate: number | null;
  samplePercentage: number | null;
  promotionStatus: GateReviewStatus | null;
}

export interface GateHistoryReport {
  gate: GateName;
  backingProfile: string;
  windowDays: number;
  entries: GateHistoryEntry[];
}

function sourceForGate(gate: GateName): "ci" | "local" {
  return gate === "iteration" ? "local" : "ci";
}

export async function runGateHistory(input: {
  store: MetricStore;
  gate: GateName;
  config: FlakerConfig;
  windowDays?: number;
}): Promise<GateHistoryReport> {
  const windowDays = input.windowDays ?? 14;
  const backingProfile = profileNameFromGateName(input.gate);
  const workflowSourceExpr = workflowRunSourceSql("wr");
  const source = sourceForGate(input.gate);

  const rows = await input.store.raw<{
    day: string;
    total_runs: number;
    passed_results: number;
    failed_results: number;
    total_results: number;
    avg_sample_ratio: number | null;
  }>(`
    WITH run_days AS (
      SELECT
        DATE_TRUNC('day', wr.created_at)::DATE::VARCHAR AS day,
        COUNT(DISTINCT wr.id)::INTEGER AS total_runs,
        COUNT(*) FILTER (WHERE tr.status = 'passed' AND tr.retry_count = 0)::INTEGER AS passed_results,
        COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky') OR (tr.status = 'passed' AND tr.retry_count > 0))::INTEGER AS failed_results,
        COUNT(tr.id)::INTEGER AS total_results
      FROM workflow_runs wr
      LEFT JOIN test_results tr ON tr.workflow_run_id = wr.id
      WHERE ${workflowSourceExpr} = '${source}'
        AND wr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
      GROUP BY day
    ),
    sample_days AS (
      SELECT
        DATE_TRUNC('day', created_at)::DATE::VARCHAR AS day,
        ROUND(AVG(sample_ratio), 1)::DOUBLE AS avg_sample_ratio
      FROM sampling_runs
      WHERE command_kind = 'run'
        AND created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
      GROUP BY day
    )
    SELECT
      rd.day,
      rd.total_runs,
      rd.passed_results,
      rd.failed_results,
      rd.total_results,
      sd.avg_sample_ratio
    FROM run_days rd
    LEFT JOIN sample_days sd USING (day)
    ORDER BY rd.day
  `);

  const profile = resolveProfile(backingProfile, input.config.profile, input.config.sampling);
  const kpi = await computeKpi(input.store, { windowDays });
  const currentReview = buildGateReview({ gate: input.gate, profile, kpi });

  const entries: GateHistoryEntry[] = rows.map((row, index) => {
    const totalResults = row.total_results;
    return {
      date: row.day,
      totalRuns: row.total_runs,
      passRate: totalResults > 0 ? Number((row.passed_results / totalResults).toFixed(4)) : null,
      failureRate: totalResults > 0 ? Number((row.failed_results / totalResults).toFixed(4)) : null,
      samplePercentage: row.avg_sample_ratio,
      promotionStatus: index === rows.length - 1 ? currentReview.promotionReadiness.status : null,
    };
  });

  return {
    gate: input.gate,
    backingProfile,
    windowDays,
    entries,
  };
}

export function formatGateHistory(report: GateHistoryReport): string {
  if (report.entries.length === 0) {
    return `Gate History: ${report.gate}\nNo history data found.`;
  }

  const lines = [
    `Gate History: ${report.gate}`,
    `Backing profile: ${report.backingProfile}`,
    `Window: last ${report.windowDays} days`,
    "",
  ];

  for (const entry of report.entries) {
    lines.push(
      `${entry.date} runs=${entry.totalRuns}`
      + ` pass=${entry.passRate != null ? `${Number((entry.passRate * 100).toFixed(1))}%` : "N/A"}`
      + ` fail=${entry.failureRate != null ? `${Number((entry.failureRate * 100).toFixed(1))}%` : "N/A"}`
      + ` sample=${entry.samplePercentage != null ? `${entry.samplePercentage}%` : "N/A"}`
      + ` status=${entry.promotionStatus ?? "n/a"}`,
    );
  }

  return lines.join("\n");
}
