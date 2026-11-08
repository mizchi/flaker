///|
fn basename(path : String) -> String {
  let normalized = path.replace_all(old="\\", new="/")
  match normalized.rev_split_once("/") {
    Some((_, base)) => base.to_owned()
    None => path
  }
}

///|
fn strip_js_extension(name : String) -> String {
  match name.strip_suffix(".js") {
    Some(base) if !base.is_empty() => base.to_owned()
    _ => name
  }
}

///|
fn normalize_process_argv(argv : Array[String]) -> Array[String] {
  match argv {
    [node, script, .. rest] if node.contains("node") && script.has_suffix(".js") => {
      let normalized : Array[String] = [strip_js_extension(basename(script))]
      for arg in rest {
        normalized.push(arg)
      }
      normalized
    }
    _ => argv
  }
}

///|
fn drop_program_name(argv : Array[String]) -> Array[String] {
  match argv {
    [_, .. rest] => rest.to_owned()
    [] => []
  }
}

///|
fn normalize_args(argv : Array[String]) -> Array[String] {
  match drop_program_name(normalize_process_argv(argv)) {
    ["help"] => ["--help"]
    ["version"] => ["--version"]
    args => args
  }
}
