///|
async fn main {
  let args = @env.args()
  if args.length() < 2 {
    print_help()
    return
  }
  match args[1] {
    "collect" => cmd_collect(args)
    _ => print_help()
  }
}

///|
fn print_help() -> Unit {
  println("flaker-native — MoonBit native CLI")
  println("")
  println("Commands:")
  println("  collect [--last <days>]   Fetch workflow runs from GitHub")
}

///|
async fn cmd_collect(_args : Array[String]) -> Unit {
  // Read config
  let config_data = @fs.read_file("flaker.toml")
  let config_text = config_data.text()
  let config = parse_config(config_text)
  println("Repo: \{config.owner}/\{config.name}")
  println("Adapter: \{config.adapter_type}, artifact: \{config.artifact_name}")

  // Get token
  let token = match @env.get_env_var("GITHUB_TOKEN") {
    Some(t) => t
    None => {
      println("Error: GITHUB_TOKEN not set")
      return
    }
  }

  // Fetch runs
  let client = @github_client.GitHubClient::new(token)
  defer client.close()
  let runs = @github_actions.list_workflow_runs(
    client,
    config.owner,
    config.name,
    per_page=5,
  )
  println("\nWorkflow runs: \{runs.total_count} total")
  for run in runs.workflow_runs {
    let sha = run.head_sha.substring(end=7)
    println("  [\{run.conclusion}] \{sha} \{run.event} (\{run.head_branch})")
  }

  println("\nDone!")
}
