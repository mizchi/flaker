-- SCHEMA_DDL of flaker 0.13.0 (git show v0.13.0:src/cli/storage/schema.ts), for migration tests.
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
  test_id         VARCHAR,
  task_id         VARCHAR,
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  filter_text     VARCHAR,
  status          VARCHAR NOT NULL,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error_message   VARCHAR,
  failure_location JSON,
  stdout_text     VARCHAR,
  stderr_text     VARCHAR,
  artifact_paths  JSON,
  artifacts       JSON,
  commit_sha      VARCHAR NOT NULL,
  variant         JSON,
  quarantine      JSON,
  created_at      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collected_artifacts (
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  adapter_type    VARCHAR NOT NULL,
  artifact_name   VARCHAR NOT NULL,
  adapter_config  VARCHAR NOT NULL DEFAULT '',
  artifact_id     BIGINT,
  local_archive_path VARCHAR,
  artifact_entries JSON,
  collected_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_run_id, adapter_type, artifact_name, adapter_config)
);

ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS artifact_id BIGINT;
ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS local_archive_path VARCHAR;
ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS artifact_entries JSON;

CREATE SEQUENCE IF NOT EXISTS test_results_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sampling_runs_id_seq START 1;

CREATE TABLE IF NOT EXISTS quarantined_tests (
  suite       VARCHAR NOT NULL,
  test_name   VARCHAR NOT NULL,
  reason      VARCHAR NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suite, test_name)
);

ALTER TABLE test_results ADD COLUMN IF NOT EXISTS test_id VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS task_id VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS filter_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS quarantine JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS failure_location JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS stdout_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS stderr_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS artifact_paths JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS artifacts JSON;

CREATE TABLE IF NOT EXISTS quarantined_test_identities (
  test_id      VARCHAR PRIMARY KEY,
  task_id      VARCHAR NOT NULL,
  suite        VARCHAR NOT NULL,
  test_name    VARCHAR NOT NULL,
  filter_text  VARCHAR,
  reason       VARCHAR NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sampling_runs (
  id                        BIGINT PRIMARY KEY,
  commit_sha                VARCHAR,
  command_kind              VARCHAR NOT NULL,
  strategy                  VARCHAR NOT NULL,
  requested_count           INTEGER,
  requested_percentage      DOUBLE,
  seed                      BIGINT,
  changed_files             JSON,
  candidate_count           INTEGER NOT NULL,
  selected_count            INTEGER NOT NULL,
  sample_ratio              DOUBLE,
  estimated_saved_tests     INTEGER,
  estimated_saved_minutes   DOUBLE,
  fallback_reason           VARCHAR,
  duration_ms               INTEGER,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sampling_run_tests (
  sampling_run_id BIGINT REFERENCES sampling_runs(id),
  ordinal         INTEGER NOT NULL,
  test_id         VARCHAR,
  task_id         VARCHAR,
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  filter_text     VARCHAR,
  is_holdout      BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (sampling_run_id, ordinal)
);

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'ci';
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_name VARCHAR;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lane VARCHAR;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS tags JSON;

CREATE TABLE IF NOT EXISTS commit_changes (
  commit_sha  VARCHAR NOT NULL,
  file_path   VARCHAR NOT NULL,
  change_type VARCHAR,
  additions   INTEGER DEFAULT 0,
  deletions   INTEGER DEFAULT 0,
  PRIMARY KEY (commit_sha, file_path)
);

CREATE TABLE IF NOT EXISTS test_coverage (
  test_id    VARCHAR NOT NULL,
  suite      VARCHAR NOT NULL,
  test_name  VARCHAR NOT NULL,
  edge       VARCHAR NOT NULL,
  PRIMARY KEY (test_id, edge)
);
