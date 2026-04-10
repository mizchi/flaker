import { basename } from "node:path";
import type { Command } from "commander";
import { runInit } from "../commands/setup/init.js";
import { detectRepoInfo } from "../core/git.js";

const VALID_ADAPTERS = ["playwright", "vitest", "jest", "junit"] as const;
const VALID_RUNNERS = ["vitest", "playwright", "jest", "actrun"] as const;

export async function setupInitAction(opts: { owner?: string; name?: string; adapter?: string; runner?: string }): Promise<void> {
  if (opts.adapter && !VALID_ADAPTERS.includes(opts.adapter as typeof VALID_ADAPTERS[number])) {
    console.error(`Error: unknown adapter "${opts.adapter}". Valid: ${VALID_ADAPTERS.join(", ")}`);
    process.exit(1);
  }
  if (opts.runner && !VALID_RUNNERS.includes(opts.runner as typeof VALID_RUNNERS[number])) {
    console.error(`Error: unknown runner "${opts.runner}". Valid: ${VALID_RUNNERS.join(", ")}`);
    process.exit(1);
  }
  const cwd = process.cwd();
  const detected = detectRepoInfo(cwd);
  const owner = opts.owner ?? detected?.owner ?? "local";
  const name = opts.name ?? detected?.name ?? basename(cwd);
  runInit(cwd, { owner, name, adapter: opts.adapter, runner: opts.runner });
  if (!detected && !opts.owner) {
    console.log(`Initialized flaker.toml (${owner}/${name}) — no git remote found, using defaults`);
  } else {
    console.log(`Initialized flaker.toml (${owner}/${name})`);
  }
}

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Project scaffolding");

  setup
    .command("init")
    .description("Create flaker.toml (auto-detects owner/name from git remote)")
    .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
    .option("--name <name>", "Repository name (auto-detected from git remote)")
    .option("--adapter <type>", `Test result adapter: ${VALID_ADAPTERS.join("|")}`)
    .option("--runner <type>", `Test runner: ${VALID_RUNNERS.join("|")}`)
    .action(setupInitAction);
}
