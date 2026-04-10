import { resolve } from "node:path";
import type { Command } from "commander";
import { DuckDBStore } from "../storage/duckdb.js";
import { loadConfig } from "../config.js";
import { runImport } from "../commands/import/report.js";
import { runImportParquet } from "../commands/import/parquet.js";

export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Ingest external reports");

  importCmd
    .command("report <file>")
    .description("Import a local test report file")
    .option("--adapter <type>", "Adapter type (vitest, playwright, junit, vrt-migration, vrt-bench, custom)", "playwright")
    .option("--custom-command <cmd>", "Custom adapter command (required with --adapter custom)")
    .option("--commit <sha>", "Commit SHA")
    .option("--branch <branch>", "Branch name")
    .action(async (file: string, opts: { adapter: string; customCommand?: string; commit?: string; branch?: string }) => {
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
        });
        console.log(`Imported ${result.testsImported} test results`);
      } finally {
        await store.close();
      }
    });

  importCmd
    .command("parquet <dir>")
    .description("Import flaker parquet artifacts from a directory")
    .action(async (dir: string) => {
      await runImportParquet(dir);
    });
}
