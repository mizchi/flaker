test "write fixture parquet files for DuckDB interop test" {
  // Write test_results.parquet
  let tr_rows = [
    TestResultRow::{
      workflow_run_id: 1L,
      test_id: Some("tid-1"),
      task_id: Some("task-1"),
      suite: "tests/login.spec.ts",
      test_name: "login works",
      status: "passed",
      duration_ms: 150,
      retry_count: 0,
      commit_sha: "abc123",
      created_at_ms: 1712100000000L,
    },
    TestResultRow::{
      workflow_run_id: 1L,
      test_id: None,
      task_id: None,
      suite: "tests/signup.spec.ts",
      test_name: "signup works",
      status: "failed",
      duration_ms: 200,
      retry_count: 1,
      commit_sha: "abc123",
      created_at_ms: 1712100000000L,
    },
  ]
  let tr_bytes = write_test_results_parquet!(tr_rows)
  @parquet.write_file!("/tmp/flaker-test-results.parquet", @parquet.read_bytes!(tr_bytes))

  // Write commit_changes.parquet
  let cc_rows = [
    CommitChangeRow::{
      commit_sha: "abc123",
      file_path: "src/foo.ts",
      change_type: Some("modified"),
      additions: 10,
      deletions: 5,
    },
    CommitChangeRow::{
      commit_sha: "abc123",
      file_path: "src/bar.ts",
      change_type: Some("added"),
      additions: 20,
      deletions: 0,
    },
  ]
  let cc_bytes = write_commit_changes_parquet!(cc_rows)
  @parquet.write_file!("/tmp/flaker-commit-changes.parquet", @parquet.read_bytes!(cc_bytes))

  // Write workflow_runs.parquet
  let wr_rows = [
    WorkflowRunRow::{
      id: 42L,
      repo: "test/repo",
      branch: Some("main"),
      commit_sha: "abc123",
      event: Some("push"),
      status: Some("completed"),
      created_at_ms: 1712100000000L,
      duration_ms: 60000,
    },
  ]
  let wr_bytes = write_workflow_runs_parquet!(wr_rows)
  @parquet.write_file!("/tmp/flaker-workflow-runs.parquet", @parquet.read_bytes!(wr_bytes))
}
