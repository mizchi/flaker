import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vrtMigrationAdapter } from "../../src/cli/adapters/vrt-migration.js";

const fixtureJson = readFileSync(
  join(import.meta.dirname, "../fixtures/vrt-migration-report.json"),
  "utf-8",
);
const fixtureJsonV1 = readFileSync(
  join(import.meta.dirname, "../fixtures/vrt-migration-report-v1.json"),
  "utf-8",
);

describe("vrtMigrationAdapter", () => {
  it('has name "vrt-migration"', () => {
    expect(vrtMigrationAdapter.name).toBe("vrt-migration");
  });

  it("converts migration report JSON into stable test case results", () => {
    const results = vrtMigrationAdapter.parse(fixtureJson);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      suite: "fixtures/migration/reset-css/after.html",
      testName: "viewport:mobile",
      taskId: "migration/reset-css",
      status: "passed",
      durationMs: 0,
      retryCount: 0,
      variant: {
        backend: "chromium",
        viewport: "mobile",
        width: "375",
        height: "900",
      },
    });
    expect(results[0].testId).toBeTruthy();

    expect(results[1]).toMatchObject({
      testName: "viewport:tablet",
      status: "passed",
      errorMessage: "known spacing diff",
    });

    expect(results[2]).toMatchObject({
      testName: "viewport:desktop",
      status: "failed",
    });
    expect(results[2].errorMessage).toContain("3200px diff");
    expect(results[2].errorMessage).toContain("layout-shift");
    expect(results[2].errorMessage).toContain("geometry changes");
  });

  it("supports schemaVersion 1 reports while keeping suite stable across scenarios", () => {
    const results = vrtMigrationAdapter.parse(fixtureJsonV1);

    expect(results).toHaveLength(3);

    expect(results[0]).toMatchObject({
      suite: "regression/preview-vs-hrc/papplica.app",
      testName: "viewport:desktop",
      taskId: "regression/preview-vs-hrc/papplica.app",
      status: "passed",
      variant: {
        backend: "chromium",
        viewport: "desktop",
        width: "1440",
        height: "900",
      },
    });

    expect(results[1]).toMatchObject({
      suite: "regression/preview-vs-hrc/papplica.app",
      testName: "viewport:desktop / scenario:interaction-hero-hover",
      taskId: "regression/preview-vs-hrc/papplica.app",
      status: "passed",
      variant: {
        backend: "chromium",
        viewport: "desktop",
        width: "1440",
        height: "900",
        scenario: "interaction-hero-hover",
      },
    });

    expect(results[2]).toMatchObject({
      suite: "regression/preview-vs-hrc/papplica.app",
      testName: "viewport:desktop / scenario:interaction-contact-name",
      taskId: "regression/preview-vs-hrc/papplica.app",
      status: "failed",
      variant: {
        backend: "chromium",
        viewport: "desktop",
        width: "1440",
        height: "900",
        scenario: "interaction-contact-name",
      },
    });
    expect(results[2].errorMessage).toContain("1200px diff");
  });

  it("rejects unsupported schemaVersion reports", () => {
    const unsupported = JSON.stringify({
      schema: "studio-vrt-flaker",
      schemaVersion: 2,
      dir: "regression/preview-vs-hrc",
      results: [],
    });

    expect(() => vrtMigrationAdapter.parse(unsupported)).toThrow(
      "Unsupported VRT schemaVersion: 2",
    );
  });
});
