///| Write test_results rows as Parquet bytes.
///  Columns: workflow_run_id (Int64), test_id (String?), task_id (String?),
///  suite (String), test_name (String), status (String), duration_ms (Int32),
///  retry_count (Int32), commit_sha (String), created_at_ms (Int64)
pub fn write_test_results_parquet(
  rows : Array[TestResultRow],
) -> Bytes!@parquet.ParquetError {
  let columns = [
    @parquet.new_column("workflow_run_id", Int64, Required),
    @parquet.new_column("test_id", String, Optional),
    @parquet.new_column("task_id", String, Optional),
    @parquet.new_column("suite", String, Required),
    @parquet.new_column("test_name", String, Required),
    @parquet.new_column("status", String, Required),
    @parquet.new_column("duration_ms", Int32, Required),
    @parquet.new_column("retry_count", Int32, Required),
    @parquet.new_column("commit_sha", String, Required),
    @parquet.new_column("created_at_ms", Int64, Required),
  ]
  let pq_rows : Array[Array[@parquet.Value]] = []
  for row in rows {
    pq_rows.push([
      @parquet.Value::Int64(row.workflow_run_id),
      match row.test_id {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      match row.task_id {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      @parquet.Value::String(row.suite),
      @parquet.Value::String(row.test_name),
      @parquet.Value::String(row.status),
      @parquet.Value::Int32(row.duration_ms),
      @parquet.Value::Int32(row.retry_count),
      @parquet.Value::String(row.commit_sha),
      @parquet.Value::Int64(row.created_at_ms),
    ])
  }
  let file = @parquet.new_parquet_file(columns, pq_rows, Some("flaker"))
  @parquet.write_bytes!(file)
}

///| Write commit_changes rows as Parquet bytes.
pub fn write_commit_changes_parquet(
  rows : Array[CommitChangeRow],
) -> Bytes!@parquet.ParquetError {
  let columns = [
    @parquet.new_column("commit_sha", String, Required),
    @parquet.new_column("file_path", String, Required),
    @parquet.new_column("change_type", String, Optional),
    @parquet.new_column("additions", Int32, Required),
    @parquet.new_column("deletions", Int32, Required),
  ]
  let pq_rows : Array[Array[@parquet.Value]] = []
  for row in rows {
    pq_rows.push([
      @parquet.Value::String(row.commit_sha),
      @parquet.Value::String(row.file_path),
      match row.change_type {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      @parquet.Value::Int32(row.additions),
      @parquet.Value::Int32(row.deletions),
    ])
  }
  let file = @parquet.new_parquet_file(columns, pq_rows, Some("flaker"))
  @parquet.write_bytes!(file)
}

///| Write workflow_runs rows as Parquet bytes.
pub fn write_workflow_runs_parquet(
  rows : Array[WorkflowRunRow],
) -> Bytes!@parquet.ParquetError {
  let columns = [
    @parquet.new_column("id", Int64, Required),
    @parquet.new_column("repo", String, Required),
    @parquet.new_column("branch", String, Optional),
    @parquet.new_column("commit_sha", String, Required),
    @parquet.new_column("event", String, Optional),
    @parquet.new_column("status", String, Optional),
    @parquet.new_column("created_at_ms", Int64, Required),
    @parquet.new_column("duration_ms", Int32, Required),
  ]
  let pq_rows : Array[Array[@parquet.Value]] = []
  for row in rows {
    pq_rows.push([
      @parquet.Value::Int64(row.id),
      @parquet.Value::String(row.repo),
      match row.branch {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      @parquet.Value::String(row.commit_sha),
      match row.event {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      match row.status {
        Some(v) => @parquet.Value::String(v)
        None => @parquet.Value::Null
      },
      @parquet.Value::Int64(row.created_at_ms),
      @parquet.Value::Int32(row.duration_ms),
    ])
  }
  let file = @parquet.new_parquet_file(columns, pq_rows, Some("flaker"))
  @parquet.write_bytes!(file)
}
