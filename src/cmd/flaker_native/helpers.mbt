// ─── CLI arg parsing ───

///|
fn parse_int_arg(args : Array[String], flag : String, default : Int32) -> Int32 {
  for i = 0; i < args.length() - 1; i = i + 1 {
    if args[i] == flag {
      return @string.parse_int(args[i + 1]) catch { _ => default }
    }
  }
  default
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

// ─── SQL helpers ───

///|
/// Escape a string for SQL single-quote context.
fn sql_escape(s : String) -> String {
  s.replace(old="'", new="''")
}

///|
/// Convert Bytes to String (ASCII/Latin-1).
fn bytes_to_string(b : Bytes) -> String {
  let buf = StringBuilder()
  for i = 0; i < b.length(); i = i + 1 {
    buf.write_char(b[i].to_int().unsafe_to_char())
  }
  buf.to_string()
}

// ─── DuckDB helpers ───

///|
fn connect_db(path : String) -> @duckdb.Connection {
  let mut conn : @duckdb.Connection? = None
  let mut err = ""
  @duckdb.connect(path~, on_ready=fn(r) {
    match r {
      Ok(c) => conn = Some(c)
      Err(_) => err = "connection failed"
    }
  })
  match conn {
    Some(c) => c
    None => abort("DuckDB connection failed: \{err}")
  }
}

///|
fn exec_sql(db : @duckdb.Connection, sql : String) -> Unit {
  db.query(sql, on_done=fn(_) {  })
}

///|
fn query_int(db : @duckdb.Connection, sql : String) -> Int32 {
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
/// Query DuckDB and return rows as Array[Array[String]].
fn query_cells(db : @duckdb.Connection, sql : String) -> Array[Array[String]] {
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

///|
fn close_db(db : @duckdb.Connection) -> Unit {
  db.close(on_done=fn(_) {  })
}

// ─── config ───

///|
async fn read_config() -> FlakerConfig {
  let data = @fs.read_file("flaker.toml")
  parse_config(data.text())
}
