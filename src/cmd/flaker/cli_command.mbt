///|
fn join_lines(lines : Array[String]) -> String {
  let buf = StringBuilder()
  for i in 0..<lines.length() {
    if i > 0 {
      buf.write_string("\n")
    }
    buf.write_string(lines[i])
  }
  buf.to_string()
}

///|
fn command_about(target_name : String) -> String {
  join_lines([
    "Target: \{target_name}",
    "Experimental direct MoonBit CLI for flaker core commands.",
    "  Migrating host/integration features incrementally.",
    "Use the npm CLI for GitHub, DuckDB, and artifact ingestion.",
  ])
}

///|
fn command_version(target_name : String) -> String {
  "0.1.0 (\{target_name})"
}

///|
fn command_spec(target_name : String) -> @argparse.Command {
  @argparse.Command(
    "flaker",
    about=command_about(target_name),
    version=command_version(target_name),
    arg_required_else_help=true,
  )
}

///|
fn render_version(target_name : String) -> String {
  "flaker core CLI \{command_version(target_name)}"
}

///|
fn parse_direct_command(
  args : Array[String],
  target_name : String,
) -> CliResult {
  let _ = command_spec(target_name).parse(argv=args, env={}) catch {
    err => return CliResult::{ exit_code: 1, output: err.to_string(), }
  }
  CliResult::{ exit_code: 0, output: "", }
}
