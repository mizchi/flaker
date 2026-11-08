///|
/// Show flaky test rankings from DuckDB.
async fn cmd_flaky(args : Array[String]) -> Unit {
  let config = read_config()
  let top = parse_int_arg(args, "--top", 20)
  let db = connect_db(config.storage_path)

  let rows = query_cells(
    db,
    "SELECT suite, test_name, COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE status IN ('failed', 'flaky'))::INTEGER, ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) FROM test_results GROUP BY suite, test_name HAVING COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) > 0 ORDER BY 5 DESC LIMIT \{top}",
  )

  if rows.length() == 0 {
    println("No flaky tests found.")
  } else {
    println("# Flaky Tests (top \{top})")
    println("")
    for row in rows {
      println("  \{row[4]}%  \{row[0]} > \{row[1]}  (\{row[3]}/\{row[2]})")
    }
  }

  close_db(db)
}
