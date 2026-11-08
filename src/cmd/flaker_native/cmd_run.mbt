///|
/// Main entry: detect config → sample → run tests → report.
async fn cmd_run(args : Array[String]) -> Unit {
  // 1. Check flaker.toml
  let config = read_config() catch {
    _ => {
      println("No flaker.toml found. Run setup first:")
      println("")
      println("  flaker calibrate")
      println("")
      println("This analyzes your project and recommends sampling config.")
      return
    }
  }

  let db = connect_db(config.storage_path)
  exec_sql(db, full_schema_ddl)

  // 2. Check data exists
  let test_count = query_int(db, "SELECT COUNT(*)::INTEGER FROM test_results")
  if test_count == 0 {
    println("No test data yet. Collect CI results first:")
    println("")
    println("  export GITHUB_TOKEN=ghp_...")
    println("  flaker collect")
    println("")
    println("This fetches test results from GitHub Actions.")
    close_db(db)
    return
  }

  // 3. Parse options
  let percentage = parse_int_arg(args, "--percentage", 30)
  let strategy = parse_string_arg(args, "--strategy", "hybrid")

  // 4. Detect changed files
  let changed = shell_lines("git diff --name-only HEAD 2>/dev/null")
  let staged = shell_lines("git diff --name-only --cached 2>/dev/null")
  let all_changed : Array[String] = []
  for f in changed {
    if f.length() > 0 {
      all_changed.push(f)
    }
  }
  for f in staged {
    if f.length() > 0 && !array_contains(all_changed, f) {
      all_changed.push(f)
    }
  }

  // 5. Sample tests
  let meta = build_test_meta(db)
  let sample_count = (meta.length() * percentage + 99) / 100
  let seed = 42UL

  let affected_suites : Array[String] = []
  if all_changed.length() > 0 {
    // Simple heuristic: match changed file basenames to suite paths
    for m in meta {
      let suite = m.suite
      for f in all_changed {
        if suite.contains(f) || f.contains(basename(suite)) {
          if !array_contains(affected_suites, suite) {
            affected_suites.push(suite)
          }
        }
      }
    }
  }

  let sampled = match strategy {
    "random" => @sampler.sample_random(meta, count=sample_count, seed~)
    "hybrid" =>
      @sampler.sample_hybrid(meta, affected_suites~, count=sample_count, seed~)
    _ => @sampler.sample_weighted(meta, count=sample_count, seed~)
  }

  // 6. Print plan
  if all_changed.length() > 0 {
    println("# Changed files: \{all_changed.length()}")
    for f in all_changed {
      println("  \{f}")
    }
    println("")
  }
  println(
    "# Sampling: \{strategy}  (\{sampled.length()}/\{meta.length()} tests, \{percentage}%)",
  )
  println("")

  // 7. Build test file list (deduplicate suites)
  let suite_set : Map[String, Bool] = Map([])
  for t in sampled {
    suite_set.set(t.suite, true)
  }
  let suites : Array[String] = []
  for entry in suite_set {
    suites.push(entry.0)
  }

  // 8. Build and run test command
  let runner_cmd = get_runner_command(config)
  let cmd = StringBuilder()
  cmd.write_string(runner_cmd)
  // Pass test files as arguments (vitest accepts file paths)
  for s in suites {
    let short = shorten_suite(s)
    cmd.write_string(" ")
    cmd.write_string(short)
  }
  let full_cmd = cmd.to_string()
  println("$ \{full_cmd}")
  println("─".repeat(60))
  println("")

  let exit_code = shell_exec(full_cmd)

  // 9. Report
  println("")
  println("─".repeat(60))
  if exit_code == 0 {
    println("# Result: PASS")
  } else {
    println("# Result: FAIL (exit \{exit_code})")
  }

  let broken_count = query_int(
    db, "SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results WHERE status IN ('failed', 'flaky') GROUP BY suite || '::' || test_name HAVING COUNT(*) = (SELECT COUNT(*) FROM test_results tr2 WHERE tr2.suite = test_results.suite AND tr2.test_name = test_results.test_name)",
  )
  let flaky_count = query_int(
    db, "SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM (SELECT suite, test_name, COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) AS fails, COUNT(*) AS total FROM test_results GROUP BY suite, test_name HAVING fails > 0 AND fails < total) sub",
  )
  if broken_count > 0 || flaky_count > 0 {
    println("  Known issues: \{broken_count} broken, \{flaky_count} flaky")
  }

  println(
    "  Saved ~\{meta.length() - sampled.length()} test runs (\{100 - percentage}% reduction)",
  )

  close_db(db)
}

///|
/// Get runner command from config, fallback to vitest.
fn get_runner_command(config : FlakerConfig) -> String {
  // TODO: read [runner].command from config
  match config.adapter_type {
    "vitest" => "pnpm exec vitest run"
    "playwright" => "pnpm exec playwright test"
    "junit" => "mvn test"
    _ => "pnpm exec vitest run"
  }
}

///|
/// Extract filename from path.
fn basename(path : String) -> String {
  let idx = rfind(path, "/")
  if idx >= 0 {
    path[idx + 1:].to_owned()
  } else {
    path
  }
}

///|
/// Check if array contains a string.
fn array_contains(arr : Array[String], s : String) -> Bool {
  for item in arr {
    if item == s {
      return true
    }
  }
  false
}
