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

-- The latest stored row per test wins; ties on created_at go to the higher id.
CREATE OR REPLACE VIEW flaker_v1.tests AS
WITH ranked AS (
  SELECT tr.*,
    ROW_NUMBER() OVER (
      PARTITION BY tr.test_id ORDER BY tr.created_at DESC NULLS LAST, tr.id DESC
    ) AS rn,
    ROW_NUMBER() OVER (
      PARTITION BY tr.test_id, (tr.title_path IS NULL) ORDER BY tr.created_at DESC NULLS LAST, tr.id DESC
    ) AS title_rn
  FROM test_results tr
  WHERE tr.test_id IS NOT NULL
)
SELECT
  test_id AS test_key,
  any_value(suite) FILTER (WHERE rn = 1) AS suite,
  any_value(test_name) FILTER (WHERE rn = 1) AS test_name,
  any_value(COALESCE(task_id, suite)) FILTER (WHERE rn = 1) AS task_id,
  any_value(variant) FILTER (WHERE rn = 1) AS variant,
  any_value(suite) FILTER (WHERE rn = 1) AS file,
  COALESCE(
    any_value(title_path) FILTER (WHERE title_path IS NOT NULL AND title_rn = 1),
    to_json([any_value(test_name) FILTER (WHERE rn = 1)])
  ) AS title_path,
  MIN(created_at) AS first_seen_at,
  MAX(created_at) AS last_seen_at
FROM ranked
GROUP BY test_id;

-- is_full: a lane with \`full\` set decides. Otherwise a run is full when it
-- ran >= full_run_ratio of the tests in the largest run of the same workflow
-- within the flaky window up to it (itself included). The largest run, not
-- the union of test ids, so renamed or deleted tests do not shrink the ratio.
CREATE OR REPLACE VIEW flaker_v1.runs AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
run_sizes AS (
  SELECT tr.workflow_run_id, COUNT(DISTINCT tr.test_id)::INTEGER AS n, MAX(tr.created_at) AS at
  FROM test_results tr
  WHERE tr.test_id IS NOT NULL
  GROUP BY tr.workflow_run_id
),
sized AS (
  SELECT rs.*, wr.workflow_name
  FROM run_sizes rs JOIN workflow_runs wr ON wr.id = rs.workflow_run_id
),
largest AS (
  SELECT cur.workflow_run_id, MAX(prev.n) AS max_n
  FROM sized cur
  CROSS JOIN cfg
  JOIN sized prev
    ON prev.workflow_name IS NOT DISTINCT FROM cur.workflow_name
   AND prev.at <= cur.at
   AND prev.at > cur.at - to_days(cfg.flaky_window_days)
  GROUP BY cur.workflow_run_id
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
    ELSE rs.n >= cfg.full_run_ratio * lg.max_n
  END AS is_full,
  wr.created_at
FROM workflow_runs wr
CROSS JOIN cfg
LEFT JOIN run_sizes rs ON rs.workflow_run_id = wr.id
LEFT JOIN largest lg ON lg.workflow_run_id = wr.id
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

const FAILURE_SQL = (alias: string) =>
  `(${alias}.status IN ('failed', 'flaky') OR (${alias}.retry_count > 0 AND ${alias}.status = 'passed'))`;

const HISTORY_VIEWS = `
CREATE OR REPLACE VIEW flaker_v1.flaky AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
recent AS (
  SELECT tr.test_id, tr.commit_sha, tr.status, tr.retry_count
  FROM test_results tr CROSS JOIN cfg
  WHERE tr.test_id IS NOT NULL
    AND tr.created_at > ${NOW_UTC} - to_days(cfg.flaky_window_days)
),
flips AS (
  SELECT test_id, COUNT(*) FILTER (WHERE statuses > 1)::INTEGER AS flip_commits
  FROM (
    SELECT test_id, commit_sha,
      COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) AS statuses
    FROM recent
    GROUP BY test_id, commit_sha
  )
  GROUP BY test_id
),
agg AS (
  SELECT
    r.test_id,
    COUNT(*)::INTEGER AS runs,
    COUNT(*) FILTER (WHERE ${FAILURE_SQL("r")})::INTEGER AS failures,
    COUNT(*) FILTER (WHERE r.status = 'flaky' OR (r.retry_count > 0 AND r.status = 'passed'))::INTEGER AS retried
  FROM recent r
  GROUP BY r.test_id
)
SELECT
  agg.test_id AS test_key,
  cfg.flaky_window_days AS window_days,
  agg.runs,
  agg.failures,
  ROUND(agg.failures * 1.0 / agg.runs, 4)::DOUBLE AS flaky_rate,
  (agg.failures * 1.0 / agg.runs >= cfg.flaky_threshold_ratio
    AND (agg.retried > 0 OR COALESCE(flips.flip_commits, 0) > 0)) AS is_flaky,
  ${NOW_UTC} AS computed_at
FROM agg
CROSS JOIN cfg
LEFT JOIN flips ON flips.test_id = agg.test_id;

CREATE OR REPLACE VIEW flaker_v1.quarantine AS
SELECT
  test_id AS test_key,
  reason,
  created_at AS since,
  CASE WHEN reason LIKE 'plan:%' THEN 'auto' ELSE 'manual' END AS source
FROM quarantined_test_identities;

CREATE OR REPLACE VIEW flaker_v1.co_failures AS
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1)
SELECT
  cc.file_path AS changed_file,
  tr.test_id AS test_key,
  COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")})::INTEGER AS co_failures,
  COUNT(DISTINCT cc.commit_sha)::INTEGER AS changes,
  ROUND(
    COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")}) * 1.0
      / COUNT(DISTINCT cc.commit_sha),
    4
  )::DOUBLE AS strength,
  cfg.co_failure_window_days AS window_days
FROM commit_changes cc
JOIN test_results tr ON tr.commit_sha = cc.commit_sha
CROSS JOIN cfg
WHERE tr.test_id IS NOT NULL
  AND tr.created_at > ${NOW_UTC} - to_days(cfg.co_failure_window_days)
GROUP BY cc.file_path, tr.test_id, cfg.co_failure_window_days
HAVING COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")}) > 0;
`;

const SELECTOR_VIEWS = `
CREATE OR REPLACE VIEW flaker_v1.selector_verdicts AS
SELECT
  sr.selector_run_id,
  sr.selector,
  sr.selector_version,
  sr.head_sha,
  sr.base_sha,
  sr.context_digest,
  sr.source,
  st.test_key,
  st.file,
  st.title_path,
  st.project,
  st.score,
  st.confidence,
  st.reason,
  st.selected,
  sr.created_at
FROM selector_runs sr
JOIN selector_run_tests st ON st.selector_run_id = sr.selector_run_id;

CREATE OR REPLACE VIEW flaker_v1.gate_calibration AS
SELECT selector, calibrated_at, cutoff, unsure_below, unsure_margin,
  records, real_failures, recall_lb95, decision, rationale
FROM gate_calibrations;

-- Internal (not flaker_v1): failures in full runs that count as ground truth.
CREATE OR REPLACE VIEW selector_ground_truth AS
SELECT DISTINCT r.run_id AS ci_run_id, ru.commit_sha, r.test_key
FROM flaker_v1.results r
JOIN flaker_v1.runs ru ON ru.run_id = r.run_id
WHERE ru.is_full
  AND ru.source <> 'mutation'
  AND r.status = 'failed'
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.flaky WHERE is_flaky)
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.quarantine);

CREATE OR REPLACE VIEW flaker_v1.misses AS
SELECT DISTINCT
  v.selector_run_id,
  v.test_key,
  v.head_sha,
  gt.ci_run_id,
  v.reason,
  COALESCE(
    (SELECT to_json(list(cc.file_path ORDER BY cc.file_path))
     FROM commit_changes cc WHERE cc.commit_sha = v.head_sha),
    '[]'::JSON
  ) AS changed_files
FROM flaker_v1.selector_verdicts v
JOIN selector_ground_truth gt ON gt.commit_sha = v.head_sha AND gt.test_key = v.test_key
WHERE v.test_key IS NOT NULL AND NOT v.selected;
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS, HISTORY_VIEWS, SELECTOR_VIEWS].join("\n");
