import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createCoverageAdapter } from "../../adapters/coverage-index.js";
import type { CoverageEdge } from "../../adapters/coverage-types.js";
import type { MetricStore } from "../../storage/types.js";

export interface CollectCoverageOpts {
  store: MetricStore;
  format: string;
  input: string;
  testIdPrefix?: string;
}

export interface CollectCoverageResult {
  testsProcessed: number;
  edgesInserted: number;
  sourceFiles: string[];
}

/**
 * Read coverage input. Supports:
 * - Single JSON file
 * - Directory of JSON files (one per test)
 */
function readCoverageInput(inputPath: string): Array<{ name: string; content: string }> {
  try {
    const stat = statSync(inputPath);
    if (stat.isDirectory()) {
      const files = readdirSync(inputPath)
        .filter((f) => extname(f) === ".json")
        .sort();
      return files.map((f) => ({
        name: f.replace(/\.json$/, ""),
        content: readFileSync(join(inputPath, f), "utf-8"),
      }));
    } else {
      return [{ name: inputPath, content: readFileSync(inputPath, "utf-8") }];
    }
  } catch {
    throw new Error(`Cannot read coverage input: ${inputPath}`);
  }
}

export async function collectCoverage(opts: CollectCoverageOpts): Promise<CollectCoverageResult> {
  const adapter = createCoverageAdapter(opts.format);
  const inputs = readCoverageInput(opts.input);

  const allEdges: CoverageEdge[] = [];
  for (const input of inputs) {
    const edges = adapter.parse(input.content);
    allEdges.push(...edges);
  }

  // Deduplicate edges by (testId, edge)
  const edgeMap = new Map<string, { suite: string; testName: string; edge: string }>();
  for (const ce of allEdges) {
    const testId = opts.testIdPrefix
      ? `${opts.testIdPrefix}:${ce.suite}:${ce.testName}`
      : `${ce.suite}:${ce.testName}`;
    for (const edge of ce.edges) {
      const key = `${testId}\0${edge}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { suite: ce.suite, testName: ce.testName, edge });
      }
    }
  }

  // Insert into DuckDB
  let edgesInserted = 0;
  if (edgeMap.size > 0) {
    const rows = [...edgeMap.values()];
    const testIds = new Set<string>();

    // Batch insert
    for (const row of rows) {
      const testId = opts.testIdPrefix
        ? `${opts.testIdPrefix}:${row.suite}:${row.testName}`
        : `${row.suite}:${row.testName}`;
      testIds.add(testId);
      await opts.store.raw(
        `INSERT OR REPLACE INTO test_coverage (test_id, suite, test_name, edge) VALUES (?, ?, ?, ?)`,
        [testId, row.suite, row.testName, row.edge],
      );
      edgesInserted++;
    }

    return {
      testsProcessed: testIds.size,
      edgesInserted,
      sourceFiles: inputs.map((i) => i.name),
    };
  }

  return { testsProcessed: 0, edgesInserted: 0, sourceFiles: inputs.map((i) => i.name) };
}

export function formatCollectCoverageSummary(result: CollectCoverageResult): string {
  return [
    "# Coverage Collection Summary",
    "",
    `  Tests processed:  ${result.testsProcessed}`,
    `  Edges inserted:   ${result.edgesInserted}`,
    `  Source files:     ${result.sourceFiles.length}`,
  ].join("\n");
}
