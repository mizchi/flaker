import { workflowRunSourceSql } from "../run-source.js";

/**
 * The public datasets: views in the DuckDB schema `flaker_v1`, over internal
 * storage tables. Within v1 only column additions are allowed. Every view's
 * columns must equal the properties of its JSON Schema in
 * `src/cli/contracts/flaker-v1-datasets.ts` (pinned by a contract test).
 *
 * Stored timestamps are naive UTC (written from JS Dates), so "now" is UTC too.
 */
export const NOW_UTC = "(now() AT TIME ZONE 'UTC')";

const CORE_VIEWS = `
CREATE SCHEMA IF NOT EXISTS flaker_v1;

CREATE OR REPLACE VIEW flaker_v1.tests AS
SELECT
  tr.test_id AS test_key,
  arg_max(tr.suite, tr.created_at) AS suite,
  arg_max(tr.test_name, tr.created_at) AS test_name,
  arg_max(COALESCE(tr.task_id, tr.suite), tr.created_at) AS task_id,
  arg_max(tr.variant, tr.created_at) AS variant,
  arg_max(tr.suite, tr.created_at) AS file,
  COALESCE(
    arg_max(tr.title_path, tr.created_at) FILTER (WHERE tr.title_path IS NOT NULL),
    to_json([arg_max(tr.test_name, tr.created_at)])
  ) AS title_path,
  MIN(tr.created_at) AS first_seen_at,
  MAX(tr.created_at) AS last_seen_at
FROM test_results tr
WHERE tr.test_id IS NOT NULL
GROUP BY tr.test_id;

CREATE OR REPLACE VIEW flaker_v1.runs AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
run_sizes AS (
  SELECT workflow_run_id, COUNT(DISTINCT test_id)::INTEGER AS n, MAX(created_at) AS at
  FROM test_results
  WHERE test_id IS NOT NULL
  GROUP BY workflow_run_id
)
SELECT
  wr.id AS run_id,
  CASE WHEN wr.source = 'mutation' THEN 'mutation' ELSE ${workflowRunSourceSql("wr")} END AS source,
  wr.workflow_name,
  wr.lane,
  wr.commit_sha,
  wr.branch,
  wr.event,
  CASE
    WHEN lc.is_full IS NOT NULL THEN lc.is_full
    WHEN COALESCE(rs.n, 0) = 0 THEN FALSE
    ELSE rs.n >= cfg.full_run_ratio * (
      SELECT COUNT(DISTINCT tr2.test_id)
      FROM test_results tr2
      JOIN workflow_runs wr2 ON wr2.id = tr2.workflow_run_id
      WHERE tr2.test_id IS NOT NULL
        AND wr2.workflow_name IS NOT DISTINCT FROM wr.workflow_name
        AND tr2.created_at <= rs.at
        AND tr2.created_at > rs.at - to_days(cfg.flaky_window_days)
    )
  END AS is_full,
  wr.created_at
FROM workflow_runs wr
CROSS JOIN cfg
LEFT JOIN run_sizes rs ON rs.workflow_run_id = wr.id
LEFT JOIN flaker_lane_config lc ON lc.lane = wr.lane;

CREATE OR REPLACE VIEW flaker_v1.results AS
SELECT
  tr.workflow_run_id AS run_id,
  tr.test_id AS test_key,
  tr.status,
  tr.retry_count,
  tr.duration_ms,
  tr.created_at
FROM test_results tr
WHERE tr.test_id IS NOT NULL;
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS].join("\n");
