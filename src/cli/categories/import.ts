import { resolve } from "node:path";
import type { Command } from "commander";
import { DuckDBStore } from "../storage/duckdb.js";
import { loadConfig } from "../config.js";
import { runImport } from "../commands/import/report.js";
import { runImportParquet } from "../commands/import/parquet.js";
import { runCollectCi, formatCollectSummary } from "../commands/collect/ci.js";
import { parseWorkflowRunSource } from "../run-source.js";
import { parseTagOption, WorkflowFilterError } from "../workflow-filter.js";
import { parsePositiveIntOption } from "../commands/exec/sampling-options.js";

export function detectAdapter(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".xml")) return "junit";
  if (lower.endsWith(".parquet")) return "parquet";
  if (lower.endsWith(".json")) return "playwright";
  return undefined;
}

export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Ingest external reports")
    .argument("[file]", "File to import (extension auto-detects adapter: .xml→junit, .parquet→parquet, .json→playwright)")
    .option("--adapter <type>", "Adapter type override (vitest, playwright, junit, parquet, vrt-migration, vrt-bench, custom)")
    .option("--custom-command <cmd>", "Custom adapter command (required with --adapter custom)")
    .option("--commit <sha>", "Commit SHA")
    .option("--branch <branch>", "Branch name")
    .option("--source <source>", "Workflow run source: ci or local", "local")
    .option("--workflow-name <name>", "Workflow name to attach to the imported run (used by `explain cluster --workflow`)")
    .option("--lane <lane>", "Lane label to attach to the imported run (e.g. sampled, cohort, interaction; used by `explain cluster --lane`)")
    .option("--tag <k=v...>", "Repeatable key=value tags attached to the imported run (used by `explain cluster --tag`)", collectTagOption, [] as string[])
    .option("--ci", "Collect test-result artifacts from recent GitHub Actions runs (needs GITHUB_TOKEN)")
    .option("--days <n>", "With --ci: how many days of runs to collect", "30")
    .option("--branch-filter <branch>", "With --ci: only collect runs on this branch")
    .action(async (
      file: string | undefined,
      opts: {
        adapter?: string; customCommand?: string; commit?: string; branch?: string; source?: string;
        workflowName?: string; lane?: string; tag?: string[];
        ci?: boolean; days: string; branchFilter?: string;
      },
    ) => {
      const ciOnlyFlagUsed =
        importCmd.getOptionValueSource("days") === "cli" || opts.branchFilter != null;
      if (!opts.ci && ciOnlyFlagUsed) {
        process.stderr.write("error: --days and --branch-filter require --ci\n");
        process.exit(2);
      }
      if (opts.ci) {
        if (file) {
          process.stderr.write("error: --ci does not take a file\n");
          process.exit(2);
        }
        const days = parsePositiveIntOption("--days", opts.days);
        if (days == null) {
          process.exitCode = 2;
          return;
        }
        const config = loadConfig(process.cwd());
        const store = new DuckDBStore(resolve(config.storage.path));
        await store.initialize();
        try {
          const { result, exitCode } = await runCollectCi({
            store,
            config,
            cwd: process.cwd(),
            days,
            branch: opts.branchFilter,
          });
          console.log(formatCollectSummary(result));
          process.exitCode = exitCode;
        } finally {
          await store.close();
        }
        return;
      }
      if (!file) {
        importCmd.help();
        return;
      }
      const inferredAdapter = opts.adapter ?? detectAdapter(file);
      if (!inferredAdapter) {
        process.stderr.write(
          `error: cannot infer adapter from extension of "${file}". Use --adapter <type>.\n`,
        );
        process.exit(2);
      }
      if (inferredAdapter === "parquet") {
        await runImportParquet(file);
        return;
      }
      let tags: Record<string, string> | undefined;
      try {
        tags = parseTagOption(opts.tag);
      } catch (err) {
        if (err instanceof WorkflowFilterError) {
          process.stderr.write(`error: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const result = await runImport({
          store,
          filePath: resolve(file),
          adapterType: inferredAdapter,
          customCommand: opts.customCommand,
          commitSha: opts.commit,
          branch: opts.branch,
          repo: `${config.repo.owner}/${config.repo.name}`,
          source: parseWorkflowRunSource(opts.source),
          workflowName: opts.workflowName,
          lane: opts.lane,
          tags,
        });
        console.log(`Imported ${result.testsImported} test results`);
      } finally {
        await store.close();
      }
    });

}

function collectTagOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
