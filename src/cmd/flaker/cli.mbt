///|
fn contains_help(args : Array[String]) -> Bool {
  for arg in args {
    if arg == "--help" || arg == "-h" || arg == "help" {
      return true
    }
  }
  false
}

///|
pub fn run_cli(argv : Array[String], target_name : String) -> CliResult {
  let args = normalize_args(argv)
  // Delegate all help to Node.js CLI
  if args.is_empty() || contains_help(args) {
    return CliResult::{ exit_code: 0, output: "", }
  }
  match args {
    ["--version"] =>
      CliResult::{ exit_code: 0, output: render_version(target_name), }
    _ => {
      // Silently skip unknown commands — they are handled by the Node.js CLI
      let result = parse_direct_command(args, target_name)
      if result.exit_code != 0 {
        CliResult::{ exit_code: 0, output: "", }
      } else {
        result
      }
    }
  }
}
