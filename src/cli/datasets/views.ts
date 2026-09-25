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
    -- Results without timestamps have no window to compare against: not full.
    ELSE COALESCE(rs.n >= cfg.full_run_ratio * lg.max_n, FALSE)
  END AS is_full,
  wr.created_at
FROM workflow_runs wr
CROSS JOIN cfg
LEFT JOIN run_sizes rs ON rs.workflow_run_id = wr.id
LEFT JOIN largest lg ON lg.workflow_run_id = wr.id
LEFT JOIN flaker_lane_config lc ON lc.lane = wr.lane
UNION ALL
-- A mutation trial runs the whole suite on the mutated tree. Its run_id is
-- negative so it never collides with a workflow run's.
SELECT
  -mt.run_id AS run_id,
  'mutation' AS source,
  'flaker calibrate --mutate' AS workflow_name,
  NULL AS lane,
  mt.commit_sha,
  NULL AS branch,
  'mutation' AS event,
  TRUE AS is_full,
  mt.created_at
FROM mutation_trials mt;

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

/** Results that are not from a mutation trial (mutations are synthetic, not history). */
const REAL_RESULTS_SQL = `
  SELECT tr.*
  FROM test_results tr
  LEFT JOIN workflow_runs wr ON wr.id = tr.workflow_run_id
  WHERE tr.test_id IS NOT NULL AND wr.source IS DISTINCT FROM 'mutation'`;

const HISTORY_VIEWS = `
-- flaky: failures counts every result that failed at least once. flaky_rate
-- counts only flake evidence: a retried pass, a 'flaky' status, or a failure
-- on a commit where the same test also passed. A plain regression therefore
-- has flaky_rate 0 and is not flaky, so it cannot hide its own failures from
-- selector ground truth.
--
-- The definition lives in the table macro flaker_flaky_window, over the
-- window_days up to \`until\` (and, with ci_only, CI runs only). The view is
-- that macro at the configured window and now; commands that take a window
-- flag or a fixed "now" call the macro, so every output reads one definition.
CREATE OR REPLACE MACRO flaker_flaky_window(window_days, until, ci_only := false) AS TABLE
WITH cfg AS (SELECT * FROM flaker_dataset_config WHERE id = 1),
recent AS (
  SELECT r.test_id, r.commit_sha, r.status, r.retry_count
  FROM (${REAL_RESULTS_SQL}
    AND (NOT ci_only OR ${workflowRunSourceSql("wr")} = 'ci')) r
  WHERE r.created_at > until - to_days(window_days) AND r.created_at <= until
),
flip_commits AS (
  SELECT test_id, commit_sha
  FROM recent
  WHERE status IN ('passed', 'failed')
  GROUP BY test_id, commit_sha
  HAVING COUNT(DISTINCT status) > 1
),
agg AS (
  SELECT
    r.test_id,
    COUNT(*)::INTEGER AS runs,
    COUNT(*) FILTER (WHERE ${FAILURE_SQL("r")})::INTEGER AS failures,
    COUNT(*) FILTER (
      WHERE r.status = 'flaky'
        OR (r.retry_count > 0 AND r.status = 'passed')
        OR (r.status = 'failed' AND fc.commit_sha IS NOT NULL)
    )::INTEGER AS evidence
  FROM recent r
  LEFT JOIN flip_commits fc ON fc.test_id = r.test_id AND fc.commit_sha = r.commit_sha
  GROUP BY r.test_id
)
SELECT
  agg.test_id AS test_key,
  window_days::INTEGER AS window_days,
  agg.runs,
  agg.failures,
  ROUND(agg.evidence * 1.0 / agg.runs, 4)::DOUBLE AS flaky_rate,
  (agg.evidence > 0 AND agg.evidence * 1.0 / agg.runs >= cfg.flaky_threshold_ratio) AS is_flaky,
  until::TIMESTAMP AS computed_at
FROM agg
CROSS JOIN cfg;

CREATE OR REPLACE VIEW flaker_v1.flaky AS
SELECT * FROM flaker_flaky_window(
  (SELECT flaky_window_days FROM flaker_dataset_config WHERE id = 1), ${NOW_UTC});

CREATE OR REPLACE VIEW flaker_v1.quarantine AS
SELECT
  test_id AS test_key,
  reason,
  created_at AS since,
  CASE WHEN reason LIKE 'plan:%' THEN 'auto' ELSE 'manual' END AS source
FROM quarantined_test_identities;

-- co_failures: per (changed file, test) over the commits in the window that
-- changed the file and have a result for the test. changes counts those
-- commits; co_failures counts the ones where the test failed at least once.
-- A single failing result on a commit is enough, and every file the commit
-- changed gets the co-failure.
CREATE OR REPLACE MACRO flaker_co_failures_window(window_days, until) AS TABLE
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
  window_days::INTEGER AS window_days
FROM commit_changes cc
JOIN (${REAL_RESULTS_SQL}) tr ON tr.commit_sha = cc.commit_sha
WHERE tr.created_at > until - to_days(window_days) AND tr.created_at <= until
GROUP BY cc.file_path, tr.test_id
HAVING COUNT(DISTINCT cc.commit_sha) FILTER (WHERE ${FAILURE_SQL("tr")}) > 0;

CREATE OR REPLACE VIEW flaker_v1.co_failures AS
SELECT * FROM flaker_co_failures_window(
  (SELECT co_failure_window_days FROM flaker_dataset_config WHERE id = 1), ${NOW_UTC});
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

-- Internal (not flaker_v1): failures in full real runs that count as ground
-- truth, one row per (commit, test); ci_run_id is the first such run.
CREATE OR REPLACE VIEW selector_ground_truth AS
SELECT MIN(r.run_id) AS ci_run_id, ru.commit_sha, r.test_key
FROM flaker_v1.results r
JOIN flaker_v1.runs ru ON ru.run_id = r.run_id
WHERE ru.is_full
  AND ru.source <> 'mutation'
  AND r.status = 'failed'
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.flaky WHERE is_flaky)
  AND r.test_key NOT IN (SELECT test_key FROM flaker_v1.quarantine)
GROUP BY ru.commit_sha, r.test_key;

-- misses: the selector's own misses, on the same evidence calibration uses.
-- Only real selector runs are scored, against real full runs; mutation
-- records are scored against their trials by calibrate --mutate. One selector
-- run per (selector, head_sha) counts, the latest, so re-running the selector
-- on a commit does not repeat a miss. A verdict the record quarantined is not
-- a miss: the selector could never have picked that test.
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
JOIN (
  SELECT selector_run_id FROM (
    SELECT selector_run_id,
      row_number() OVER (PARTITION BY selector, head_sha ORDER BY created_at DESC, selector_run_id DESC) AS rn
    FROM selector_runs
    WHERE source = 'real' AND head_sha IS NOT NULL
  ) WHERE rn = 1
) latest ON latest.selector_run_id = v.selector_run_id
JOIN selector_ground_truth gt ON gt.commit_sha = v.head_sha AND gt.test_key = v.test_key
WHERE v.test_key IS NOT NULL AND NOT v.selected AND v.source = 'real' AND v.reason <> 'quarantined';
`;

export const FLAKER_V1_VIEWS_SQL = [CORE_VIEWS, HISTORY_VIEWS, SELECTOR_VIEWS].join("\n");
