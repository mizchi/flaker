export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id            BIGINT PRIMARY KEY,
  repo          VARCHAR NOT NULL,
  branch        VARCHAR,
  commit_sha    VARCHAR NOT NULL,
  event         VARCHAR,
  status        VARCHAR,
  created_at    TIMESTAMP,
  duration_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS test_results (
  id              INTEGER PRIMARY KEY,
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  status          VARCHAR NOT NULL,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error_message   VARCHAR,
  commit_sha      VARCHAR NOT NULL,
  variant         JSON,
  created_at      TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS test_results_id_seq START 1;
`;

export const FLAKY_QUERY = `
WITH recent AS (
  SELECT * FROM test_results
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
)
SELECT
  suite, test_name, variant,
  COUNT(*)::INTEGER AS total_runs,
  COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
  COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed')::INTEGER AS flaky_retry_count,
  ROUND((COUNT(*) FILTER (WHERE status = 'failed') + COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed')) * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate,
  MAX(created_at) FILTER (WHERE status = 'failed') AS last_flaky_at,
  MIN(created_at) AS first_seen_at
FROM recent
GROUP BY suite, test_name, variant
HAVING flaky_rate > 0
ORDER BY flaky_rate DESC
`;
