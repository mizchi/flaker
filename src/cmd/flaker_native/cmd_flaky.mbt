///| Show flaky test rankings from DuckDB.
async fn cmd_flaky(args : Array[String]) -> Unit {
  let config = read_config()
  let top = parse_int_arg(args, "--top", 20)
  let db = connect_db(config.storage_path)

  // col 0: suite, 1: test_name, 2: total_runs, 3: fail_count, 4: flaky_rate
  let rows = query_cells(
    db,
    "SELECT suite, test_name, COUNT(*)::INTEGER AS total_runs, COUNT(*) FILTER (WHERE status IN ('failed', 'flaky'))::INTEGER AS fail_count, ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) AS flaky_rate FROM test_results GROUP BY suite, test_name HAVING fail_count > 0 ORDER BY flaky_rate DESC LIMIT \{top}",
  )

  if rows.length() == 0 {
    println("No flaky tests found.")
    close_db(db)
    return
  }

  println("# Flaky Tests (top \{top})")
  println("")
  for row in rows {
    let suite = row[0]
    let name = row[1]
    let runs = row[2]
    let fails = row[3]
    let rate = row[4]
    println("  \{rate}%  \{suite} > \{name}  (\{fails}/\{runs})")
  }

  close_db(db)
}

///| Query DuckDB and return rows as Array[Array[String]] (cell values).
fn query_cells(
  db : @duckdb.Connection,
  sql : String,
) -> Array[Array[String]] {
  let rows : Array[Array[String]] = []
  db.query(sql, on_done=fn(r) {
    match r {
      Ok(qr) => {
        let cols = qr.column_count()
        for row = 0; row < qr.row_count(); row = row + 1 {
          let cells : Array[String] = []
          for col = 0; col < cols; col = col + 1 {
            cells.push(qr.cell(row, col).unwrap_or(""))
          }
          rows.push(cells)
        }
      }
      Err(_) => ()
    }
  })
  rows
}
