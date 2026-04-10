import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Vitest global setup that ensures the /tmp/flaker-*.parquet fixture files
 * exist before the DuckDB↔mizchi/parquet interop test runs.
 *
 * These files are written by the MoonBit test
 * `src/parquet_export/write_fixture_test.mbt`, which is not triggered by
 * `pnpm test` on its own. Without this setup step a clean checkout would
 * fail `tests/parquet/duckdb-interop.test.ts`.
 *
 * Tolerant behavior:
 *
 * 1. If the fixture files already exist, do nothing.
 * 2. If `moon` is not on PATH (e.g. fallback-mode CI lanes that deliberately
 *    run without the MoonBit toolchain), skip silently — individual tests
 *    that need the fixtures will fail with their own clear error, and CI
 *    lanes that filter to non-parquet tests won't be affected.
 * 3. If `moon test` runs but fails for another reason, throw so the problem
 *    surfaces during local development.
 */
export default async function setup(): Promise<void> {
  const fixtures = [
    "/tmp/flaker-test-results.parquet",
    "/tmp/flaker-commit-changes.parquet",
    "/tmp/flaker-workflow-runs.parquet",
  ];

  if (fixtures.every((p) => existsSync(p))) {
    return;
  }

  // Check whether `moon` is available at all. If not, skip silently.
  try {
    execSync("moon version", { stdio: "ignore" });
  } catch {
    return;
  }

  try {
    execSync("moon test -p mizchi/flaker/parquet_export", {
      stdio: "ignore",
      cwd: new URL("../..", import.meta.url),
    });
  } catch (err) {
    throw new Error(
      `Failed to generate parquet fixtures via 'moon test -p mizchi/flaker/parquet_export': ${String(err)}`,
    );
  }

  const missing = fixtures.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `Parquet fixtures still missing after moon test: ${missing.join(", ")}`,
    );
  }
}
