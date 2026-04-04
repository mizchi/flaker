///|
async fn main {
  let args = @env.args()
  if args.length() < 2 {
    print_help()
    return
  }
  match args[1] {
    "collect" => cmd_collect(args)
    _ => print_help()
  }
}

///|
fn print_help() -> Unit {
  println("flaker-native — MoonBit native CLI")
  println("")
  println("Commands:")
  println("  collect [--last <days>]   Fetch workflow runs from GitHub")
}

///|
async fn cmd_collect(_args : Array[String]) -> Unit {
  let config_data = @fs.read_file("flaker.toml")
  let config_text = config_data.text()
  let config = parse_config(config_text)
  println("Repo: \{config.owner}/\{config.name}")

  let token = match @env.get_env_var("GITHUB_TOKEN") {
    Some(t) => t
    None => {
      println("Error: GITHUB_TOKEN not set")
      return
    }
  }

  // Connect to DuckDB
  println("Connecting to DuckDB...")
  let db = connect_db(config.storage_path)

  // Initialize schema
  exec_sql(db, schema_ddl)
  println("Schema initialized")

  // Fetch workflow runs
  let client = @github_client.GitHubClient::new(token)
  defer client.close()
  let runs = @github_actions.list_workflow_runs(
    client,
    config.owner,
    config.name,
    per_page=100,
  )
  println("Fetched \{runs.workflow_runs.length()} runs")

  let mut imported = 0
  let repo = "\{config.owner}/\{config.name}"
  for run in runs.workflow_runs {
    let run_id = run.id.to_int()
    if run_exists(db, run_id) {
      continue
    }
    let sql = new_insert_run_sql(run_id, repo, run)
    exec_sql(db, sql)
    imported = imported + 1
  }
  println("Imported \{imported} new workflow runs")

  let count = query_int(
    db,
    "SELECT COUNT(*)::INTEGER FROM workflow_runs",
  )
  println("Total in DB: \{count}")

  close_db(db)
  println("Done!")
}

// ─── SQL ───

///|
fn new_insert_run_sql(
  run_id : Int,
  repo : String,
  run : @github_actions.WorkflowRun,
) -> String {
  let b = StringBuilder::new()
  b.write_string("INSERT INTO workflow_runs (id, repo, branch, commit_sha, event, source, status, created_at) VALUES (")
  b.write_string(run_id.to_string())
  b.write_string(", '")
  b.write_string(repo)
  b.write_string("', '")
  b.write_string(run.head_branch)
  b.write_string("', '")
  b.write_string(run.head_sha)
  b.write_string("', '")
  b.write_string(run.event)
  b.write_string("', 'ci', '")
  b.write_string(run.conclusion)
  b.write_string("', '")
  b.write_string(run.created_at)
  b.write_string("') ON CONFLICT (id) DO NOTHING")
  b.to_string()
}

///|
let schema_ddl : String = #|CREATE TABLE IF NOT EXISTS workflow_runs (
  #|  id BIGINT PRIMARY KEY,
  #|  repo VARCHAR NOT NULL,
  #|  branch VARCHAR,
  #|  commit_sha VARCHAR NOT NULL,
  #|  event VARCHAR,
  #|  source VARCHAR DEFAULT 'ci',
  #|  status VARCHAR,
  #|  created_at TIMESTAMP,
  #|  duration_ms INTEGER
  #|);
  #|CREATE SEQUENCE IF NOT EXISTS test_results_id_seq START 1;

// ─── DuckDB helpers ───

///|
fn connect_db(path : String) -> @duckdb.Connection {
  let mut conn : @duckdb.Connection? = None
  @duckdb.connect(path=path, on_ready=fn(r) {
    match r {
      Ok(c) => conn = Some(c)
      Err(_) => ()
    }
  })
  conn.unwrap()
}

///|
fn exec_sql(db : @duckdb.Connection, sql : String) -> Unit {
  db.query(sql, on_done=fn(_r) {  })
}

///|
fn query_int(db : @duckdb.Connection, sql : String) -> Int {
  let mut val = 0
  db.query(sql, on_done=fn(r) {
    match r {
      Ok(qr) =>
        if qr.row_count() > 0 {
          match qr.get_int(0, 0) {
            Some(n) => val = n
            None => ()
          }
        }
      Err(_) => ()
    }
  })
  val
}

///|
fn run_exists(db : @duckdb.Connection, run_id : Int) -> Bool {
  query_int(
    db,
    "SELECT COUNT(*)::INTEGER FROM workflow_runs WHERE id = \{run_id}",
  ) > 0
}

///|
fn close_db(db : @duckdb.Connection) -> Unit {
  db.close(on_done=fn(_) {  })
}
