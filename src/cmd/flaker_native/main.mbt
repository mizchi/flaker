///|
async fn main {
  let args = @env.args()
  if args.length() < 2 {
    print_help()
    return
  }
  match args[1] {
    "collect" => cmd_collect(args)
    "calibrate" => cmd_calibrate(args)
    "flaky" => cmd_flaky(args)
    "sample" => cmd_sample(args)
    _ => print_help()
  }
}

///|
fn print_help() -> Unit {
  println("flaker-native — MoonBit native CLI for flaker")
  println("")
  println("Commands:")
  println("  collect [--last <days>]      Fetch CI data from GitHub")
  println("  calibrate                    Analyze project and recommend config")
  println("  flaky [--top <n>]            Show flaky test rankings")
  println("  sample [--count <n>]         Select tests to run")
  println("                               [--strategy random|weighted|hybrid]")
}

///|
fn parse_int_arg(args : Array[String], flag : String, default : Int) -> Int {
  for i = 0; i < args.length() - 1; i = i + 1 {
    if args[i] == flag {
      return try { @strconv.parse_int(args[i + 1]) } catch { _ => default }
    }
  }
  default
}

// ─── collect ───

///|
async fn cmd_collect(args : Array[String]) -> Unit {
  let config = read_config()
  let last_days = parse_int_arg(args, "--last", 30)
  let token = match @env.get_env_var("GITHUB_TOKEN") {
    Some(t) => t
    None => {
      println("Error: GITHUB_TOKEN not set")
      return
    }
  }

  let db = connect_db(config.storage_path)
  exec_sql(db, full_schema_ddl)

  let client = @github_client.GitHubClient::new(token)
  defer client.close()

  // Date filter
  let created = if last_days > 0 {
    // Approximate: just pass the filter to GitHub
    let _ = last_days
    None // TODO: compute ISO date when @time is available
  } else {
    None
  }

  let runs = @github_actions.list_workflow_runs(
    client,
    config.owner,
    config.name,
    per_page=100,
    created?,
  )

  let mut runs_imported = 0
  let mut tests_imported = 0
  let repo = "\{config.owner}/\{config.name}"

  for run in runs.workflow_runs {
    let run_id = run.id.to_int64()
    if run_exists(db, run_id) {
      continue
    }
    exec_sql(db, new_insert_run_sql(run_id, repo, run))
    runs_imported = runs_imported + 1

    let count = try {
      process_run_artifact(client, db, config, run)
    } catch {
      _ => 0
    }
    tests_imported = tests_imported + count
    if count > 0 {
      let sha = run.head_sha.substring(end=7)
      println("  \{sha}: \{count} tests")
    }
  }

  let total_runs = query_int(db, "SELECT COUNT(*)::INTEGER FROM workflow_runs")
  let total_tests = query_int(db, "SELECT COUNT(*)::INTEGER FROM test_results")
  println("Collected \{runs_imported} new runs (\{tests_imported} tests)")
  println("Total: \{total_runs} runs, \{total_tests} tests in DB")
  close_db(db)
}

// ─── calibrate ───

///|
async fn cmd_calibrate(_args : Array[String]) -> Unit {
  let config = read_config()
  let db = connect_db(config.storage_path)

  let test_count = query_int(
    db,
    "SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results",
  )
  let commit_count = query_int(
    db,
    "SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM test_results WHERE commit_sha IS NOT NULL",
  )
  let flaky_count = query_int(
    db,
    "SELECT COUNT(DISTINCT key)::INTEGER FROM (SELECT suite || '::' || test_name AS key, SUM(CASE WHEN status IN ('failed', 'flaky') THEN 1 ELSE 0 END) AS fails FROM test_results GROUP BY key HAVING fails > 0) sub",
  )
  let flaky_rate = if test_count > 0 {
    flaky_count.to_double() / test_count.to_double()
  } else {
    0.0
  }

  println("# Project Profile")
  println("")
  println("  Tests:          \{test_count}")
  println("  Commits:        \{commit_count}")
  println("  Flaky tests:    \{flaky_count}")
  let pct = (flaky_rate * 1000.0).to_int().to_double() / 10.0
  println("  Flaky rate:     \{pct}%")
  println("")

  // Strategy recommendation
  let strategy = if test_count < 50 {
    "random"
  } else if flaky_rate < 0.20 {
    "hybrid"
  } else {
    "weighted"
  }
  let percentage = if test_count < 100 {
    50
  } else if test_count < 500 {
    30
  } else {
    20
  }
  println("  Recommended:")
  println("    strategy    = \{strategy}")
  println("    percentage  = \{percentage}")
  println("    holdout     = 0.1")

  close_db(db)
}

// ─── config ───

///|
async fn read_config() -> FlakerConfig {
  let data = @fs.read_file("flaker.toml")
  parse_config(data.text())
}

// ─── SQL ───

///|
fn new_insert_run_sql(
  run_id : Int64,
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
let full_schema_ddl : String =
  #|CREATE TABLE IF NOT EXISTS workflow_runs (
  #|  id BIGINT PRIMARY KEY, repo VARCHAR NOT NULL, branch VARCHAR,
  #|  commit_sha VARCHAR NOT NULL, event VARCHAR, source VARCHAR DEFAULT 'ci',
  #|  status VARCHAR, created_at TIMESTAMP, duration_ms INTEGER
  #|);
  #|CREATE TABLE IF NOT EXISTS test_results (
  #|  id INTEGER PRIMARY KEY, workflow_run_id BIGINT REFERENCES workflow_runs(id),
  #|  test_id VARCHAR, task_id VARCHAR, suite VARCHAR NOT NULL, test_name VARCHAR NOT NULL,
  #|  filter_text VARCHAR, status VARCHAR NOT NULL, duration_ms INTEGER,
  #|  retry_count INTEGER DEFAULT 0, error_message VARCHAR,
  #|  commit_sha VARCHAR NOT NULL, variant JSON, quarantine JSON, created_at TIMESTAMP
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
  db.query(sql, on_done=fn(_) {  })
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
fn run_exists(db : @duckdb.Connection, run_id : Int64) -> Bool {
  query_int(
    db,
    "SELECT COUNT(*)::INTEGER FROM workflow_runs WHERE id = \{run_id}",
  ) > 0
}

///|
fn close_db(db : @duckdb.Connection) -> Unit {
  db.close(on_done=fn(_) {  })
}
