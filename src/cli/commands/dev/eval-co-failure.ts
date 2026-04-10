import type { MetricStore } from "../../storage/types.js";
import { CO_FAILURE_QUERY } from "../../storage/schema.js";

export interface CoFailureWindowRow {
  windowDays: number;
  dataPoints: number;
  avgRate: number;
  maxRate: number;
  minRate: number;
  medianRate: number;
  strength: number;
}

export interface CoFailureWindowReport {
  windows: CoFailureWindowRow[];
  recommended: number;
  reasoning: string;
}

const DEFAULT_WINDOWS = [7, 14, 30, 60, 90, 180];

export async function analyzeCoFailureWindows(
  store: MetricStore,
  windowDays?: number[],
  minCoRuns: number = 3,
): Promise<CoFailureWindowReport> {
  const windows = windowDays ?? DEFAULT_WINDOWS;
  const rows: CoFailureWindowRow[] = [];

  for (const days of windows) {
    const result = await store.raw<{
      file_path: string;
      test_id: string;
      suite: string;
      test_name: string;
      co_runs: number;
      co_failures: number;
      co_failure_rate: number;
    }>(CO_FAILURE_QUERY, [String(days), String(minCoRuns)]);

    if (result.length === 0) {
      rows.push({
        windowDays: days,
        dataPoints: 0,
        avgRate: 0,
        maxRate: 0,
        minRate: 0,
        medianRate: 0,
        strength: 0,
      });
      continue;
    }

    const rates = result.map((r) => r.co_failure_rate).sort((a, b) => a - b);
    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
    const medianRate = rates[Math.floor(rates.length / 2)];

    // Strength: weighted combination of data volume and rate magnitude
    // Higher is better: enough data points + meaningful rates
    const volumeFactor = Math.min(result.length / 100, 1.0);
    const rateFactor = avgRate / 100;
    const strength = volumeFactor * 0.6 + rateFactor * 0.4;

    rows.push({
      windowDays: days,
      dataPoints: result.length,
      avgRate: Math.round(avgRate * 100) / 100,
      maxRate: Math.round(rates[rates.length - 1] * 100) / 100,
      minRate: Math.round(rates[0] * 100) / 100,
      medianRate: Math.round(medianRate * 100) / 100,
      strength: Math.round(strength * 1000) / 1000,
    });
  }

  // Find recommended window: highest strength with at least 10 data points
  const viable = rows.filter((r) => r.dataPoints >= 10);
  const best = viable.length > 0
    ? viable.reduce((a, b) => (a.strength >= b.strength ? a : b))
    : rows[rows.length - 1];

  let reasoning: string;
  if (best.dataPoints < 10) {
    reasoning = "データ不足: どの窓サイズでも 10 件未満。collect でデータを蓄積してください。";
  } else if (best.windowDays <= 14) {
    reasoning = "短期窓が最適: 直近のパターンを重視。データの鮮度が重要なプロジェクト向き。";
  } else if (best.windowDays <= 60) {
    reasoning = "中期窓が最適: データ量と鮮度のバランスが良い。";
  } else {
    reasoning = "長期窓が最適: 多くのデータポイントを集めてパターンを捉える。頻度の低いテスト向き。";
  }

  return {
    windows: rows,
    recommended: best.windowDays,
    reasoning,
  };
}

export function formatCoFailureWindowReport(report: CoFailureWindowReport): string {
  const lines = [
    "# Co-failure Window Sensitivity Analysis",
    "",
    "| Window (days) | Data Points | Avg Rate | Max Rate | Median | Strength |",
    "|--------------|-------------|----------|----------|--------|----------|",
  ];

  for (const w of report.windows) {
    const marker = w.windowDays === report.recommended ? " ★" : "";
    lines.push(
      `| ${String(w.windowDays).padEnd(12)} | ${String(w.dataPoints).padEnd(11)} | ${String(w.avgRate + "%").padEnd(8)} | ${String(w.maxRate + "%").padEnd(8)} | ${String(w.medianRate + "%").padEnd(6)} | ${String(w.strength).padEnd(8)} |${marker}`,
    );
  }

  lines.push(
    "",
    `## Recommended: --co-failure-days ${report.recommended}`,
    "",
    report.reasoning,
    "",
    "★ = recommended window",
  );

  return lines.join("\n");
}
