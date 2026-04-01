///|
fn path_dirname(path : String) -> String {
  match path.rev_find("/") {
    Some(0) => "/"
    Some(idx) => String::unsafe_substring(path, start=0, end=idx)
    None => "."
  }
}

///|
fn path_normalize(path : String) -> String {
  let is_abs = path.has_prefix("/")
  let parts : Array[String] = []
  for view in path.split("/") {
    let part = view.to_string()
    if part.length() == 0 || part == "." {
      continue
    }
    if part == ".." {
      if parts.length() > 0 && parts[parts.length() - 1] != ".." {
        parts.pop() |> ignore
      } else if not(is_abs) {
        parts.push(part)
      }
      continue
    }
    parts.push(part)
  }
  let body = parts.join("/")
  if is_abs {
    if body.length() == 0 {
      "/"
    } else {
      "/" + body
    }
  } else if body.length() == 0 {
    "."
  } else {
    body
  }
}

///|
fn resolve_load_path(base_path : String, raw_path : String) -> String {
  if raw_path.has_prefix("/") {
    path_normalize(raw_path)
  } else {
    let base_dir = path_dirname(base_path)
    if base_dir == "." {
      path_normalize(raw_path)
    } else {
      path_normalize(base_dir + "/" + raw_path)
    }
  }
}

///|
fn workspace_root_from_path(path : String) -> String {
  if path.has_prefix("/") {
    path_dirname(path)
  } else {
    "."
  }
}

///|
fn is_within_workspace_root(workspace_root : String, path : String) -> Bool {
  let root = path_normalize(workspace_root)
  let target = path_normalize(path)
  if root == "." {
    return not(target.has_prefix("..")) && not(target.has_prefix("/"))
  }
  if root == "/" {
    return target.has_prefix("/")
  }
  target == root || target.has_prefix(root + "/")
}

///|
priv struct LoadCallSpec {
  path : String
  imports : Map[String, String]
}

///|
priv struct LoadModuleExports {
  function_defs : Map[String, StarlarkCall]
  values : Map[String, Bool]
}

///|
fn call_string_arg(call : StarlarkCall, key : String) -> String? {
  for arg in call.args {
    if arg.name == key {
      match arg.value {
        Str(value) => return Some(value)
        _ => return None
      }
    }
  }
  None
}

///|
fn append_exported_symbol(
  call : StarlarkCall,
  function_defs : Map[String, StarlarkCall],
  values : Map[String, Bool],
) -> Unit {
  if call.name == "__def__" {
    if call_string_arg(call, "name") is Some(fn_name) {
      function_defs[fn_name] = call
    }
    return
  }
  if call.name == "__assign__" {
    if call_string_arg(call, "name") is Some(name) {
      values[name] = true
    }
  }
}

///|
fn def_alias_call(base : StarlarkCall, local_name : String) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  let mut replaced = false
  for arg in base.args {
    if arg.name == "name" {
      args.push({
        name: "name",
        value: Str(local_name),
        line: arg.line,
        column: arg.column,
      })
      replaced = true
    } else {
      args.push(arg)
    }
  }
  if not(replaced) {
    args.push({
      name: "name",
      value: Str(local_name),
      line: base.line,
      column: base.column,
    })
  }
  { name: base.name, args, line: base.line, column: base.column }
}

///|
fn value_alias_call(
  local_name : String,
  symbol_name : String,
  line : Int,
  column : Int,
) -> StarlarkCall {
  {
    name: "__assign__",
    args: [
      { name: "name", value: Str(local_name), line, column },
      { name: "value", value: Ref(symbol_name), line, column },
    ],
    line,
    column,
  }
}

///|
fn append_load_import_alias_calls(
  imports : Map[String, String],
  loaded_path : String,
  module_exports : LoadModuleExports,
  load_call : StarlarkCall,
  calls : Array[StarlarkCall],
  function_defs : Map[String, StarlarkCall],
  values : Map[String, Bool],
  errors : Array[String],
) -> Unit {
  if module_exports.function_defs.length() == 0 &&
    module_exports.values.length() == 0 {
    return
  }
  for local_name, symbol_name in imports {
    match module_exports.function_defs.get(symbol_name) {
      Some(base_def) =>
        if local_name == symbol_name {
          function_defs[local_name] = base_def
        } else {
          let alias_call = def_alias_call(base_def, local_name)
          calls.push(alias_call)
          append_exported_symbol(alias_call, function_defs, values)
        }
      None =>
        if module_exports.values.get(symbol_name).unwrap_or(false) {
          values[local_name] = true
          if local_name != symbol_name {
            let alias_call = value_alias_call(
              local_name,
              symbol_name,
              load_call.line,
              load_call.column,
            )
            calls.push(alias_call)
            append_exported_symbol(alias_call, function_defs, values)
          }
        } else {
          semantic_error(
            errors,
            load_call.line,
            load_call.column,
            "loaded symbol '\{symbol_name}' not found in \{loaded_path}",
          )
        }
    }
  }
}

///|
fn load_spec_from_call(
  call : StarlarkCall,
  errors : Array[String],
) -> LoadCallSpec? {
  let args = arg_map(call, errors)
  validate_call_shape(call, args, errors)
  guard args.get("path") is Some(target) else { return None }
  let path = match target.value {
    Str(path) => path
    _ => {
      semantic_error(
        errors,
        target.line,
        target.column,
        "load.path must be string",
      )
      return None
    }
  }
  let imports : Map[String, String] = {}
  match args.get("imports") {
    Some(arg) =>
      match arg.value {
        Dict(entries) =>
          for local_name, symbol_value in entries {
            match symbol_value {
              Str(symbol_name) => imports[local_name] = symbol_name
              _ =>
                semantic_error(
                  errors,
                  arg.line,
                  arg.column,
                  "load.imports values must be string",
                )
            }
          }
        _ =>
          semantic_error(
            errors,
            arg.line,
            arg.column,
            "load.imports must be dict",
          )
      }
    None => ()
  }
  Some({ path, imports })
}

///|
fn collect_calls_from_fs(
  path : String,
  workspace_root : String,
  read_text : (String) -> String?,
  calls : Array[StarlarkCall],
  errors : Array[String],
  visiting : Map[String, Bool],
  loaded : Map[String, Bool],
  module_exports_by_path : Map[String, LoadModuleExports],
  stack : Array[String],
) -> Unit {
  let normalized = path_normalize(path)
  if loaded.get(normalized).unwrap_or(false) {
    return
  }
  if visiting.get(normalized).unwrap_or(false) {
    let chain = if stack.length() == 0 {
      normalized
    } else {
      stack.join(" -> ") + " -> " + normalized
    }
    errors.push("load cycle detected: " + chain)
    return
  }
  visiting[normalized] = true
  stack.push(normalized)

  match read_text(normalized) {
    Some(text) => {
      let syntax = parse_syntax(text)
      let function_defs : Map[String, StarlarkCall] = {}
      let values : Map[String, Bool] = {}
      for err in syntax.errors {
        errors.push(normalized + ": " + err)
      }
      for call in syntax.calls {
        if call.name == "load" {
          match load_spec_from_call(call, errors) {
            Some(spec) => {
              let resolved = resolve_load_path(normalized, spec.path)
              if not(is_within_workspace_root(workspace_root, resolved)) {
                errors.push("load path escapes workspace root: " + resolved)
                continue
              }
              collect_calls_from_fs(
                resolved, workspace_root, read_text, calls, errors, visiting, loaded,
                module_exports_by_path, stack,
              )
              if spec.imports.length() == 0 {
                continue
              }
              match module_exports_by_path.get(resolved) {
                Some(module_exports) =>
                  append_load_import_alias_calls(
                    spec.imports,
                    resolved,
                    module_exports,
                    call,
                    calls,
                    function_defs,
                    values,
                    errors,
                  )
                None => ()
              }
            }
            None => ()
          }
        } else {
          calls.push(call)
          append_exported_symbol(call, function_defs, values)
        }
      }
      module_exports_by_path[normalized] = { function_defs, values }
    }
    None => errors.push("failed to read loaded file: " + normalized)
  }

  stack.pop() |> ignore
  visiting[normalized] = false
  loaded[normalized] = true
}

///|
fn parse_from_fs_impl(
  path : String,
  exists : (String) -> Bool,
  read_text : (String) -> String?,
) -> StarlarkParseResult {
  parse_from_fs_with_inputs_impl(path, exists, read_text, {})
}

///|
fn parse_from_fs_with_inputs_impl(
  path : String,
  exists : (String) -> Bool,
  read_text : (String) -> String?,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  let normalized = path_normalize(path)
  let workspace_root = workspace_root_from_path(normalized)
  if exists(normalized) == false {
    return {
      workflow: {
        name: "default",
        max_parallel: 1,
        nodes: [],
        tasks: [],
        entry_targets: [],
      },
      errors: ["failed to read workflow file: " + path],
    }
  }

  let calls : Array[StarlarkCall] = []
  let load_errors : Array[String] = []
  let visiting : Map[String, Bool] = {}
  let loaded : Map[String, Bool] = {}
  let module_exports_by_path : Map[String, LoadModuleExports] = {}
  let stack : Array[String] = []
  collect_calls_from_fs(
    normalized, workspace_root, read_text, calls, load_errors, visiting, loaded,
    module_exports_by_path, stack,
  )
  parse_calls_impl(calls, load_errors, external_inputs)
}

///|
pub fn parse_from_fs(
  path : String,
  exists : (String) -> Bool,
  read_text : (String) -> String?,
) -> StarlarkParseResult {
  parse_from_fs_impl(path, exists, read_text)
}

///|
pub fn parse_from_fs_with_inputs(
  path : String,
  exists : (String) -> Bool,
  read_text : (String) -> String?,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  parse_from_fs_with_inputs_impl(path, exists, read_text, external_inputs)
}
