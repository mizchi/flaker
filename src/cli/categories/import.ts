import { resolve } from "node:path";
import type { Command } from "commander";
import { DuckDBStore } from "../storage/duckdb.js";
import { loadConfig } from "../config.js";
import { runImport } from "../commands/import/report.js";
import { runImportParquet } from "../commands/import/parquet.js";
import { parseWorkflowRunSource } from "../run-source.js";
import { deprecate } from "../deprecation.js";

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
    .action(async (file: string | undefined, opts: { adapter?: string; customCommand?: string; commit?: string; branch?: string; source?: string }) => {
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
        });
        console.log(`Imported ${result.testsImported} test results`);
      } finally {
        await store.close();
      }
    });

  deprecate(
    importCmd
      .command("report <file>")
      .description("Import a local test report file")
      .option("--adapter <type>", "Adapter type (vitest, playwright, junit, vrt-migration, vrt-bench, custom)", "playwright")
      .option("--custom-command <cmd>", "Custom adapter command (required with --adapter custom)")
      .option("--commit <sha>", "Commit SHA")
      .option("--branch <branch>", "Branch name")
      .option("--source <source>", "Workflow run source: ci or local", "local")
      .action(async (file: string, opts: { adapter: string; customCommand?: string; commit?: string; branch?: string; source?: string }) => {
        const config = loadConfig(process.cwd());
        const store = new DuckDBStore(resolve(config.storage.path));
        await store.initialize();
        try {
          const result = await runImport({
            store,
            filePath: resolve(file),
            adapterType: opts.adapter,
            customCommand: opts.customCommand,
            commitSha: opts.commit,
            branch: opts.branch,
            repo: `${config.repo.owner}/${config.repo.name}`,
            source: parseWorkflowRunSource(opts.source),
          });
          console.log(`Imported ${result.testsImported} test results`);
        } finally {
          await store.close();
        }
      }),
    { since: "0.7.0", remove: "0.8.0", canonical: "flaker import" },
  );

  deprecate(
    importCmd
      .command("parquet <dir>")
      .description("Import flaker parquet artifacts from a directory")
      .action(async (dir: string) => {
        await runImportParquet(dir);
      }),
    { since: "0.7.0", remove: "0.8.0", canonical: "flaker import" },
  );
}
