///|
/// Select tests to run based on history.
async fn cmd_sample(args : Array[String]) -> Unit {
  let config = read_config()
  let count = parse_int_arg(args, "--count", 0)
  let percentage = parse_int_arg(args, "--percentage", 30)
  let strategy = parse_string_arg(args, "--strategy", "weighted")
  let seed = 42UL

  // Validate strategy
  match strategy {
    "random" | "weighted" | "hybrid" => ()
    _ => {
      println(
        "Error: unknown strategy '\{strategy}'. Use: random, weighted, hybrid",
      )
      return
    }
  }

  let db = connect_db(config.storage_path)

  let meta = build_test_meta(db)
  if meta.length() == 0 {
    println("No test data. Run 'flaker collect' first.")
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

  println(
    "# Sampling: \{strategy}  (\{sampled.length()}/\{meta.length()} tests, \{percentage}%)",
  )
  println("")
  for t in sampled {
    let suite = shorten_suite(t.suite)
    let rate = t.flaky_rate
    let tag = if rate >= 100.0 {
      " [BROKEN]"
    } else if rate > 0.0 {
      " [flaky \{format_rate(rate)}%]"
    } else {
      ""
    }
    println("  \{suite} > \{t.test_name}\{tag}")
  }

  close_db(db)
}

///|
/// Remove CI workspace prefix from suite path, keep relative path.
fn shorten_suite(suite : String) -> String {
  let markers = ["tests/", "src/", "test/", "spec/"]
  for marker in markers {
    let idx = rfind(suite, marker)
    if idx >= 0 {
      return suite[idx:].to_owned()
    }
  }
  suite
}

///|
/// Find last occurrence of needle in haystack. Returns -1 if not found.
fn rfind(haystack : String, needle : String) -> Int32 {
  let hlen = haystack.length()
  let nlen = needle.length()
  if nlen > hlen {
    return -1
  }
  for i = hlen - nlen; i >= 0; i = i - 1 {
    if haystack[i:i + nlen].to_owned() == needle {
      return i
    }
  }
  -1
}

///|
/// Format rate with one decimal place.
fn format_rate(rate : Double) -> String {
  let r = (rate * 10.0).to_int().to_double() / 10.0
  r.to_string()
}

///|
/// Build TestMeta array from DuckDB.
fn build_test_meta(db : @duckdb.Connection) -> Array[@types.TestMeta] {
  let rows = query_cells(
    db, "SELECT suite, test_name, COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE status IN ('failed', 'flaky'))::INTEGER, ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 2), MAX(created_at)::VARCHAR, COALESCE(AVG(duration_ms), 0)::INTEGER FROM test_results GROUP BY suite, test_name",
  )
  let meta : Array[@types.TestMeta] = []
  for row in rows {
    let total_runs = @string.parse_int(row[2]) catch { _ => 0 }
    let fail_count = @string.parse_int(row[3]) catch { _ => 0 }
    let flaky_rate = @string.parse_double(row[4]) catch { _ => 0.0 }
    let avg_duration = @string.parse_int(row[6]) catch { _ => 0 }
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
