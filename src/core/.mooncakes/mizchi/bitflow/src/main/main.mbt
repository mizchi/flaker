///|
pub struct CliRunSpec {
  show_help : Bool
  workflow_path : String
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
pub fn parse_main_cli_args(raw_args : Array[String]) -> CliRunSpec {
  let args = drop_program_name(raw_args)
  let errors : Array[String] = []
  let mut show_help = false
  let mut workflow_path = ""
  let mut i = 0
  while i < args.length() {
    let arg = args[i]
    if arg == "-h" || arg == "--help" {
      show_help = true
      i += 1
      continue
    }
    if arg == "check" && workflow_path.length() == 0 {
      i += 1
      continue
    }
    if arg == "--var" {
      if i + 1 >= args.length() {
        errors.push("option --var expects key=value")
        i += 1
      } else {
        i += 2
      }
      continue
    }
    if arg.has_prefix("--var=") {
      i += 1
      continue
    }
    if arg.has_prefix("-") {
      errors.push("unknown option: " + arg)
      i += 1
      continue
    }
    if workflow_path.length() == 0 {
      workflow_path = arg
    } else {
      errors.push("multiple workflow paths: '\{workflow_path}' and '\{arg}'")
    }
    i += 1
  }
  if not(show_help) && workflow_path.length() == 0 {
    errors.push("workflow path is required")
  }
  { show_help, workflow_path, errors }
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
  println("Usage: bitflow [check] <workflow.star> [--var KEY=VALUE]...")
  println("Env override: BITFLOW_VAR_<name>=<value>")
}

///|
fn print_parse_errors(errors : Array[String]) -> Unit {
  for err in errors {
    println("error: " + err)
  }
}

///|
fn main {
  let raw_args = @xsys.get_cli_args()
  let spec = parse_main_cli_args(raw_args)
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
  let parsed = @wf.parse_from_fs_with_cli_env(
    spec.workflow_path,
    adapter,
    drop_program_name(raw_args),
    @xsys.get_env_vars(),
  )
  if parsed.errors.length() > 0 {
    print_parse_errors(parsed.errors)
    @xsys.exit(1)
  }
  println("workflow=\{parsed.ir.name}")
  println("nodes=\{parsed.ir.nodes.length().to_string()}")
  println("tasks=\{parsed.ir.tasks.length().to_string()}")
}

///|
test "main cli: parses check command with workflow path and var flags" {
  let spec = parse_main_cli_args([
    "bitflow", "check", "workflow.star", "--var", "profile=prod", "--var=retries=3",
  ])
  assert_eq(spec.show_help, false)
  assert_eq(spec.workflow_path, "workflow.star")
  assert_eq(spec.errors.length(), 0)
}

///|
test "main cli: reports missing workflow path and malformed var option" {
  let spec = parse_main_cli_args(["bitflow", "--var"])
  let text = spec.errors.join("\n")
  assert_true(text.contains("option --var expects key=value"))
  assert_true(text.contains("workflow path is required"))
}

///|
test "main cli: accepts help flag without workflow path" {
  let spec = parse_main_cli_args(["bitflow", "--help"])
  assert_eq(spec.show_help, true)
  assert_eq(spec.errors.length(), 0)
}

///|
test "main cli: reports unknown option and multiple workflow paths" {
  let spec = parse_main_cli_args([
    "bitflow", "--unknown", "workflow.star", "other.star",
  ])
  let text = spec.errors.join("\n")
  assert_true(text.contains("unknown option"))
  assert_true(text.contains("multiple workflow paths"))
}
