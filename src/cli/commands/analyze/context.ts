import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { MetricStore } from "../../storage/types.js";

export interface FlakerContext {
  environment: {
    testCount: number;
    uniqueSuites: number;
    commitHistory: number;
    commitsWithChanges: number;
    resolverConfigured: boolean;
    coverageDataAvailable: boolean;
    coFailureDataPoints: number;
    tunedAlpha: number | null;
    oldestDataDays: number | null;
    newestDataDays: number | null;
  };
  strategies: {
    [name: string]: {
      requires: string[];
      characteristics: string[];
    };
  };
}

export async function buildContext(
  store: MetricStore,
  opts: {
    storagePath: string;
    resolverConfigured: boolean;
    /** Reference time for the data-age range. Defaults to `new Date()`. */
    now?: Date;
  },
): Promise<FlakerContext> {
  const now = opts.now ?? new Date();
  const nowLiteral = now.toISOString().replace("T", " ").replace("Z", "");
  const modelsDir = resolve(dirname(opts.storagePath), "models");
  let tunedAlpha: number | null = null;
  try {
    const tuningPath = resolve(modelsDir, "tuning.json");
    if (existsSync(tuningPath)) {
      const { readFileSync } = await import("node:fs");
      tunedAlpha = JSON.parse(readFileSync(tuningPath, "utf8")).alpha ?? null;
    }
  } catch {}

  const [testCount] = await store.raw<{ cnt: number }>(
    "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
  );
  const [suiteCount] = await store.raw<{ cnt: number }>(
    "SELECT COUNT(DISTINCT suite)::INTEGER AS cnt FROM test_results",
  );
  const [commitCount] = await store.raw<{ cnt: number }>(
    "SELECT COUNT(DISTINCT commit_sha)::INTEGER AS cnt FROM test_results",
  );
  const [changesCount] = await store.raw<{ cnt: number }>(
    "SELECT COUNT(DISTINCT commit_sha)::INTEGER AS cnt FROM commit_changes",
  );
  const [coFailureCount] = await store.raw<{ cnt: number }>(
    `SELECT COUNT(*)::INTEGER AS cnt FROM (
       SELECT cc.file_path, tr.test_id
       FROM commit_changes cc
       JOIN test_results tr ON cc.commit_sha = tr.commit_sha
       WHERE tr.status IN ('failed', 'flaky') OR (tr.retry_count > 0 AND tr.status = 'passed')
       GROUP BY cc.file_path, tr.test_id
       HAVING COUNT(*) >= 2
     )`,
  );

  const [testCoverageCount] = await store.raw<{ cnt: number }>(
    "SELECT COUNT(DISTINCT test_id)::INTEGER AS cnt FROM test_coverage",
  );

  let oldestDays: number | null = null;
  let newestDays: number | null = null;
  try {
    const [dateRange] = await store.raw<{ oldest: number; newest: number }>(
      `SELECT
        DATEDIFF('day', MIN(created_at), '${nowLiteral}'::TIMESTAMP)::INTEGER AS oldest,
        DATEDIFF('day', MAX(created_at), '${nowLiteral}'::TIMESTAMP)::INTEGER AS newest
       FROM test_results
       WHERE created_at IS NOT NULL`,
    );
    if (dateRange) {
      oldestDays = dateRange.oldest;
      newestDays = dateRange.newest;
    }
  } catch {}

  return {
    environment: {
      testCount: testCount.cnt,
      uniqueSuites: suiteCount.cnt,
      commitHistory: commitCount.cnt,
      commitsWithChanges: changesCount.cnt,
      resolverConfigured: opts.resolverConfigured,
      coverageDataAvailable: testCoverageCount.cnt > 0,
      coFailureDataPoints: coFailureCount.cnt,
      tunedAlpha,
      oldestDataDays: oldestDays,
      newestDataDays: newestDays,
    },
    strategies: {
      weighted: {
        requires: [],
        characteristics: [
          "Prioritizes tests with higher flaky rates",
          "Better than uniform sampling when flaky tests exist",
          "No dependency on changed files",
        ],
      },
      "weighted+co-failure": {
        requires: ["commit_changes data (auto-collected)"],
        characteristics: [
          "Adds co-failure correlation to weighted scoring",
          "Requires --changed flag with list of changed files",
          "Improvement depends on co-failure data quality",
        ],
      },
      hybrid: {
        requires: ["resolver configuration in flaker.toml"],
        characteristics: [
          "Deterministic priority tiers: affected → co-failure → previously_failed → new → weighted",
          "Highest recall in benchmarks (92-94% at 20% sample)",
          "Requires dependency resolver (workspace/glob/bitflow)",
          "Most effective with --changed flag",
        ],
      },
    },
  };
}

export function formatContext(ctx: FlakerContext): string {
  const env = ctx.environment;
  const lines = [
    "# Flaker Context",
    "",
    "## Environment",
    `  Test results:          ${env.testCount}`,
    `  Unique suites:         ${env.uniqueSuites}`,
    `  Commit history:        ${env.commitHistory}`,
    `  Commits with changes:  ${env.commitsWithChanges}`,
    `  Co-failure data points: ${env.coFailureDataPoints}`,
    `  Resolver configured:   ${env.resolverConfigured}`,
    `  Coverage data:         ${env.coverageDataAvailable}`,
    `  Tuned alpha:           ${env.tunedAlpha ?? "not tuned"}`,
    `  Data range:            ${env.oldestDataDays != null ? `${env.oldestDataDays}d ago — ${env.newestDataDays}d ago` : "no data"}`,
    "",
    "## Available Strategies",
  ];

  for (const [name, info] of Object.entries(ctx.strategies)) {
    const available = info.requires.length === 0 ||
      info.requires.every((r) => !r.includes("not yet"));
    lines.push(``, `### ${name} ${available ? "" : "(unavailable)"}`);
    if (info.requires.length > 0) {
      lines.push(`  Requires: ${info.requires.join(", ")}`);
    }
    for (const c of info.characteristics) {
      lines.push(`  - ${c}`);
    }
  }

  return lines.join("\n");
}
