///| Select tests to run based on history.
async fn cmd_sample(args : Array[String]) -> Unit {
  let config = read_config()
  let count = parse_int_arg(args, "--count", 0)
  let percentage = parse_int_arg(args, "--percentage", 30)
  let strategy = parse_string_arg(args, "--strategy", "weighted")
  let seed = 42UL
  let db = connect_db(config.storage_path)

  let meta = build_test_meta(db)
  if meta.length() == 0 {
    println("No test data. Run 'flaker-native collect' first.")
    close_db(db)
    return
  }

  let sample_count = if count > 0 {
    count
  } else {
    (meta.length() * percentage + 99) / 100
  }

  let sampled = match strategy {
    "random" => @sampler.sample_random(meta, count=sample_count, seed~)
    "hybrid" =>
      @sampler.sample_hybrid(
        meta,
        affected_suites=[],
        count=sample_count,
        seed~,
      )
    _ => @sampler.sample_weighted(meta, count=sample_count, seed~)
  }

  println("# Sampling: \{strategy}")
  println("  Selected \{sampled.length()} / \{meta.length()} tests")
  println("")
  for t in sampled {
    println("\{t.suite} > \{t.test_name}")
  }

  close_db(db)
}

///|
fn parse_string_arg(
  args : Array[String],
  flag : String,
  default : String,
) -> String {
  for i = 0; i < args.length() - 1; i = i + 1 {
    if args[i] == flag {
      return args[i + 1]
    }
  }
  default
}

///| Build TestMeta array from DuckDB.
fn build_test_meta(db : @duckdb.Connection) -> Array[@types.TestMeta] {
  // col 0: suite, 1: test_name, 2: total_runs, 3: fail_count, 4: flaky_rate,
  //     5: last_run_at, 6: avg_duration_ms
  let rows = query_cells(
    db,
    "SELECT suite, test_name, COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE status IN ('failed', 'flaky'))::INTEGER, ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 2), MAX(created_at)::VARCHAR, COALESCE(AVG(duration_ms), 0)::INTEGER FROM test_results GROUP BY suite, test_name",
  )
  let meta : Array[@types.TestMeta] = []
  for row in rows {
    let total_runs = try { @strconv.parse_int(row[2]) } catch { _ => 0 }
    let fail_count = try { @strconv.parse_int(row[3]) } catch { _ => 0 }
    let flaky_rate = try { @strconv.parse_double(row[4]) } catch { _ => 0.0 }
    let avg_duration = try { @strconv.parse_int(row[6]) } catch { _ => 0 }
    meta.push({
      suite: row[0],
      test_name: row[1],
      flaky_rate,
      total_runs,
      fail_count,
      last_run_at: row[5],
      avg_duration_ms: avg_duration,
      previously_failed: fail_count > 0,
      is_new: total_runs <= 1,
      task_id: None,
      filter: None,
      test_id: None,
      co_failure_boost: None,
    })
  }
  meta
}
