///|
pub struct AnalyzeCliSpec {
  show_help : Bool
  workflow_path : String
  changed_paths : Array[String]
  errors : Array[String]
}

///|
fn drop_program_name(raw_args : Array[String]) -> Array[String] {
  if raw_args.length() <= 1 {
    return []
  }
  let args : Array[String] = []
  for i in 1..<raw_args.length() {
    args.push(raw_args[i])
  }
  args
}

///|
pub fn parse_analyze_cli_args(raw_args : Array[String]) -> AnalyzeCliSpec {
  let args = drop_program_name(raw_args)
  let errors : Array[String] = []
  let mut show_help = false
  let mut workflow_path = ""
  let changed_paths : Array[String] = []
  for arg in args {
    if arg == "-h" || arg == "--help" {
      show_help = true
      continue
    }
    if arg.has_prefix("-") {
      errors.push("unknown option: " + arg)
      continue
    }
    if workflow_path.length() == 0 {
      workflow_path = arg
    } else {
      changed_paths.push(arg)
    }
  }
  if not(show_help) {
    if workflow_path.length() == 0 {
      errors.push("workflow path is required")
    }
    if changed_paths.length() == 0 {
      errors.push("at least one changed path is required")
    }
  }
  { show_help, workflow_path, changed_paths, errors }
}

///|
fn host_fs_adapter() -> @wf.FsAdapter {
  @wf.FsAdapter::new(
    fn(path : String) {
      try @xfs.read_file_to_string(path) catch {
        _ => None
      } noraise {
        text => Some(text)
      }
    },
    fn(path : String, content : String) {
      try @xfs.write_string_to_file(path, content) catch {
        _ => false
      } noraise {
        _ => true
      }
    },
    fn(path : String) { @xfs.path_exists(path) },
    fn() -> Array[String] { [] },
  )
}

///|
fn print_usage() -> Unit {
  println("Usage: moon run src/examples -- <workflow.star> <changed-path>...")
}

///|
fn print_parse_errors(errors : Array[String]) -> Unit {
  for err in errors {
    println("error: " + err)
  }
}

///|
fn run_success_with_log(task : @wf.FlowTask) -> (Bool, String) {
  println("run: \{task.id} (\{task.cmd})")
  (true, "ok")
}

///|
fn main {
  let raw_args = @xsys.get_cli_args()
  let spec = parse_analyze_cli_args(raw_args)
  if spec.show_help {
    print_usage()
    return
  }
  if spec.errors.length() > 0 {
    print_parse_errors(spec.errors)
    print_usage()
    @xsys.exit(2)
  }

  let adapter = @wf.WorkflowAdapter::new(
    host_fs_adapter(),
    @wf.CommandAdapter::none(),
  )
  let parsed = @wf.parse_from_fs(spec.workflow_path, adapter)
  if parsed.errors.length() > 0 {
    print_parse_errors(parsed.errors)
    @xsys.exit(1)
  }

  let targets = @wf.entry_targets_for_changed_paths(
    parsed.ir,
    spec.changed_paths,
  )
  let changed_text = spec.changed_paths.join(",")
  let targets_text = targets.join(",")
  println("workflow=\{parsed.ir.name}")
  println("changed=\{changed_text}")
  println("targets=\{targets_text}")
  if targets.length() == 0 {
    println("no affected auto targets")
    return
  }

  let result = @wf.execute_ir_for_changed_paths(
    parsed.ir,
    spec.changed_paths,
    run_success_with_log,
  )
  let order_text = result.order.join(",")
  let issues_text = result.issues.join(" | ")
  println("state=\{result.state}")
  println("order=\{order_text}")
  if result.issues.length() > 0 {
    println("issues=\{issues_text}")
  }
}
