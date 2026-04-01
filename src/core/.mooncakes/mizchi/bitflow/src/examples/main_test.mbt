///|
test "examples cli: parses workflow and changed paths" {
  let spec = parse_analyze_cli_args([
    "bitflow-examples", "workflow.star", "packages/lib-a/src/index.ts", "packages/app/src/main.ts",
  ])
  assert_eq(spec.show_help, false)
  assert_eq(spec.errors.length(), 0)
  assert_eq(spec.workflow_path, "workflow.star")
  assert_eq(spec.changed_paths.length(), 2)
}

///|
test "examples cli: reports missing required args" {
  let spec = parse_analyze_cli_args(["bitflow-examples"])
  assert_eq(spec.show_help, false)
  let text = spec.errors.join("\n")
  assert_true(text.contains("workflow path is required"))
  assert_true(text.contains("at least one changed path is required"))
}

///|
test "examples cli: accepts help" {
  let spec = parse_analyze_cli_args(["bitflow-examples", "--help"])
  assert_eq(spec.show_help, true)
  assert_eq(spec.errors.length(), 0)
}
