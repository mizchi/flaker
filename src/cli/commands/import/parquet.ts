import { resolve } from "node:path";
import { DuckDBStore } from "../../storage/duckdb.js";
import { loadConfig } from "../../config.js";

export async function runImportParquet(dir: string): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const result = await store.importFromParquetDir(resolve(dir));
    console.log(
      `Imported ${result.workflowRunsImported} workflow runs, ${result.testResultsImported} test results, ${result.commitChangesImported} commit changes, ${result.samplingRunsImported} sampling runs, ${result.samplingRunTestsImported} sampling run tests`,
    );
  } finally {
    await store.close();
  }
}
