import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".jj"],
    passWithNoTests: true,
    globalSetup: ["./tests/setup/parquet-fixtures.ts"],
    // Parallel tests hit heavy DuckDB + MoonBit core code paths; the default
    // 5s timeout is too tight under full-suite contention. 60s is comfortable
    // headroom without masking genuine hangs.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Heavy DuckDB + MoonBit core contention under full parallelism causes
    // cascading timeouts. Cap workers to 4 to keep the suite deterministic.
    pool: "forks",
    maxWorkers: 4,
    minWorkers: 1,
  },
});
