import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runImport } from "../../src/cli/commands/import/report.js";
import { tmpdir } from "node:os";

describe("import command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("imports Playwright JSON report", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/playwright-report.json");
    const result = await runImport({
      store,
      filePath: fixture,
      adapterType: "playwright",
      commitSha: "abc123",
      branch: "main",
      repo: "mizchi/crater",
    });
    expect(result.testsImported).toBe(4);

    const rows = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
    expect(rows[0].cnt).toBe(4);
  });

  it("imports JUnit XML report", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/junit-report.xml");
    const result = await runImport({
      store,
      filePath: fixture,
      adapterType: "junit",
      commitSha: "def456",
      branch: "main",
      repo: "mizchi/crater",
    });
    expect(result.testsImported).toBe(5);
  });

  it("imports Vitest JSON report", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "flaker-import-vitest-"));
    const fixture = resolve(dir, "vitest-report.json");
    writeFileSync(fixture, JSON.stringify({
      testResults: [
        {
          name: "tests/commands/sample.test.ts",
          assertionResults: [
            {
              ancestorTitles: ["sample command"],
              fullName: "sample command random returns correct count",
              status: "passed",
              title: "random returns correct count",
              duration: 42.5,
              failureMessages: [],
            },
            {
              ancestorTitles: ["sample command"],
              fullName: "sample command weighted fails",
              status: "failed",
              title: "weighted fails",
              duration: 100,
              failureMessages: ["Expected 5 but got 3"],
            },
          ],
        },
      ],
    }), "utf-8");

    try {
      const result = await runImport({
        store,
        filePath: fixture,
        adapterType: "vitest",
        commitSha: "vitest123",
        branch: "main",
        repo: "mizchi/flaker",
      });
      expect(result.testsImported).toBe(2);

      const rows = await store.raw<{ suite: string; status: string }>(
        "SELECT suite, status FROM test_results ORDER BY test_name",
      );
      expect(rows).toEqual([
        { suite: "tests/commands/sample.test.ts", status: "passed" },
        { suite: "tests/commands/sample.test.ts", status: "failed" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports built-in vrt migration reports", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/vrt-migration-report.json");
    const result = await runImport({
      store,
      filePath: fixture,
      adapterType: "vrt-migration",
      commitSha: "vrt456",
      branch: "main",
      repo: "mizchi/vrt-harness",
    });

    expect(result.testsImported).toBe(3);
    const rows = await store.raw<{ suite: string; status: string }>(
      "SELECT suite, status FROM test_results ORDER BY test_name",
    );
    expect(rows).toEqual([
      { suite: "fixtures/migration/reset-css/after.html", status: "failed" },
      { suite: "fixtures/migration/reset-css/after.html", status: "passed" },
      { suite: "fixtures/migration/reset-css/after.html", status: "passed" },
    ]);
  });

  it("imports built-in vrt bench reports", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/vrt-bench-report.json");
    const result = await runImport({
      store,
      filePath: fixture,
      adapterType: "vrt-bench",
      commitSha: "bench789",
      branch: "main",
      repo: "mizchi/vrt-harness",
    });

    expect(result.testsImported).toBe(3);
    const rows = await store.raw<{ suite: string; status: string }>(
      "SELECT suite, status FROM test_results ORDER BY test_name",
    );
    expect(rows).toEqual([
      { suite: "fixtures/css-challenge/dashboard.html", status: "passed" },
      { suite: "fixtures/css-challenge/dashboard.html", status: "failed" },
      { suite: "fixtures/css-challenge/dashboard.html", status: "passed" },
    ]);
  });

  it("creates synthetic workflow run", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/playwright-report.json");
    await runImport({
      store,
      filePath: fixture,
      adapterType: "playwright",
      commitSha: "abc123",
      branch: "main",
      repo: "mizchi/crater",
    });
    const runs = await store.raw<{ event: string }>("SELECT event FROM workflow_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0].event).toBe("local-import");
  });

  const customFixture = resolve(
    import.meta.dirname,
    "../../../vrt-harness/test-results/migration/migration-report.json",
  );
  const customAdapterScript = resolve(
    import.meta.dirname,
    "../../../vrt-harness/src/flaker-vrt-report-adapter.ts",
  );
  const customAdapterFixtureAvailable =
    existsSync(customFixture) && existsSync(customAdapterScript);
  const maybeIt = customAdapterFixtureAvailable ? it : it.skip;

  maybeIt("imports custom-adapted JSON via custom adapter command", async () => {
    const adapterCommand = [
      "node",
      "--experimental-strip-types",
      customAdapterScript,
      "--scenario-id",
      "migration/tailwind-to-vanilla",
      "--backend",
      "chromium",
    ].join(" ");

    const result = await runImport({
      store,
      filePath: customFixture,
      adapterType: "custom",
      customCommand: adapterCommand,
      commitSha: "vrt123",
      branch: "main",
      repo: "mizchi/vrt-harness",
    });

    expect(result.testsImported).toBeGreaterThan(0);
    const rows = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
    expect(rows[0].cnt).toBe(result.testsImported);
  });

  it("requires a custom command when adapterType is custom", async () => {
    const fixture = resolve(import.meta.dirname, "../fixtures/playwright-report.json");

    await expect(() =>
      runImport({
        store,
        filePath: fixture,
        adapterType: "custom",
        commitSha: "custom123",
        branch: "main",
        repo: "mizchi/vrt-harness",
      }),
    ).rejects.toThrow(/Custom adapter requires a command/);
  });
});
