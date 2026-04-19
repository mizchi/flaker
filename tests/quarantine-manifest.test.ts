import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  formatQuarantineManifestReport,
  isManifestQuarantined,
  loadQuarantineBridge,
  loadQuarantineManifest,
  validateQuarantineManifest,
  type QuarantineManifestEntry,
} from "../src/cli/quarantine-manifest.js";

function writeManifest(
  dir: string,
  entries: QuarantineManifestEntry[],
): string {
  const manifestPath = join(dir, "flaker.quarantine.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({ entries }, null, 2),
  );
  return manifestPath;
}

describe("quarantine manifest", () => {
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await loadQuarantineBridge();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads and validates a repo-tracked manifest", () => {
    const cwd = mkdtempSync(join(tmpdir(), "flaker-quarantine-"));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "paint-vrt.spec.ts"), "");

    const manifestPath = writeManifest(cwd, [
      {
        id: "paint-vrt-local-assets",
        taskId: "paint-vrt",
        spec: "tests/paint-vrt.spec.ts",
        titlePattern: "optional snapshot asset",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "optional asset is absent on local runs",
        condition: "missing local snapshot asset",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
    ]);

    const manifest = loadQuarantineManifest({
      cwd,
      manifestPath,
    });
    const report = validateQuarantineManifest({
      cwd,
      manifest,
      manifestPath,
      knownTaskIds: ["paint-vrt"],
      now: new Date("2026-04-02T00:00:00Z"),
    });

    expect(manifest.entries).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("reports unknown tasks, invalid patterns, missing specs, and expiry problems", () => {
    const cwd = mkdtempSync(join(tmpdir(), "flaker-quarantine-"));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "paint-vrt.spec.ts"), "");
    writeFileSync(join(cwd, "tests", "flaky.spec.ts"), "");
    writeFileSync(join(cwd, "tests", "soon-expiring.spec.ts"), "");

    const manifestPath = writeManifest(cwd, [
      {
        id: "unknown-task",
        taskId: "missing-task",
        spec: "tests/paint-vrt.spec.ts",
        titlePattern: "paints",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "task drift",
        condition: "task was renamed",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
      {
        id: "missing-spec",
        taskId: "paint-vrt",
        spec: "tests/missing.spec.ts",
        titlePattern: "missing",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "spec drift",
        condition: "spec was deleted",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
      {
        id: "invalid-pattern",
        taskId: "paint-vrt",
        spec: "tests/flaky.spec.ts",
        titlePattern: "[invalid",
        mode: "allow_flaky",
        scope: "flaky",
        owner: "@mizchi",
        reason: "regex typo",
        condition: "pattern is broken",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
      {
        id: "expired-entry",
        taskId: "paint-vrt",
        spec: "tests/flaky.spec.ts",
        titlePattern: "expired",
        mode: "allow_failure",
        scope: "expected_failure",
        owner: "@mizchi",
        reason: "expired quarantine",
        condition: "known bug",
        introducedAt: "2026-03-01",
        expiresAt: "2026-04-01",
      },
      {
        id: "near-expiry",
        taskId: "paint-vrt",
        spec: "tests/soon-expiring.spec.ts",
        titlePattern: "soon",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "temporary local condition",
        condition: "waiting for CI image update",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-05",
      },
    ]);

    const report = validateQuarantineManifest({
      cwd,
      manifest: loadQuarantineManifest({ cwd, manifestPath }),
      manifestPath,
      knownTaskIds: ["paint-vrt"],
      now: new Date("2026-04-02T00:00:00Z"),
      expiringWithinDays: 7,
    });

    expect(report.errors.map((error) => error.code)).toEqual([
      "unknown-task",
      "missing-spec",
      "invalid-pattern",
      "expired-entry",
    ]);
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "near-expiry",
    ]);
  });

  it("formats JSON and Markdown reports", () => {
    const cwd = mkdtempSync(join(tmpdir(), "flaker-quarantine-"));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "paint-vrt.spec.ts"), "");

    const manifestPath = writeManifest(cwd, [
      {
        id: "paint-vrt-local-assets",
        taskId: "paint-vrt",
        spec: "tests/paint-vrt.spec.ts",
        titlePattern: "optional snapshot asset",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "optional asset is absent on local runs",
        condition: "missing local snapshot asset",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-05",
      },
    ]);

    const report = validateQuarantineManifest({
      cwd,
      manifest: loadQuarantineManifest({ cwd, manifestPath }),
      manifestPath,
      knownTaskIds: ["paint-vrt"],
      now: new Date("2026-04-02T00:00:00Z"),
      expiringWithinDays: 7,
    });

    const json = formatQuarantineManifestReport(report, "json");
    const markdown = formatQuarantineManifestReport(report, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      manifestPath,
      summary: {
        totalEntries: 1,
        errorCount: 0,
        warningCount: 1,
      },
    });
    expect(markdown).toContain("# Quarantine Manifest Report");
    expect(markdown).toContain("paint-vrt-local-assets");
    expect(markdown).toContain("Near expiry");
  });

  it("matches only skip entries against sampled tests", () => {
    const skipEntry: QuarantineManifestEntry = {
      id: "paint-vrt-local-assets",
      taskId: "paint-vrt",
      spec: "tests/paint-vrt.spec.ts",
      titlePattern: "optional snapshot asset",
      mode: "skip",
      scope: "environment",
      owner: "@mizchi",
      reason: "optional asset is absent on local runs",
      condition: "missing local snapshot asset",
      introducedAt: "2026-04-01",
      expiresAt: "2026-04-30",
    };
    const allowFailureEntry: QuarantineManifestEntry = {
      ...skipEntry,
      id: "known-bug",
      mode: "allow_failure",
      titlePattern: "known bug",
    };

    expect(
      isManifestQuarantined([skipEntry], {
        suite: "tests/paint-vrt.spec.ts",
        testName: "optional snapshot asset on local",
        taskId: "paint-vrt",
      }),
    ).toBe(true);
    expect(
      isManifestQuarantined([skipEntry], {
        suite: "tests/paint-vrt.spec.ts",
        testName: "different title",
        taskId: "paint-vrt",
      }),
    ).toBe(false);
    expect(
      isManifestQuarantined([allowFailureEntry], {
        suite: "tests/paint-vrt.spec.ts",
        testName: "known bug",
        taskId: "paint-vrt",
      }),
    ).toBe(false);
  });

  it("normalizes Windows-style spec paths before matching", () => {
    const entry: QuarantineManifestEntry = {
      id: "paint-vrt-local-assets",
      taskId: "paint-vrt",
      spec: "tests/paint-vrt.spec.ts",
      titlePattern: "optional snapshot asset",
      mode: "skip",
      scope: "environment",
      owner: "@mizchi",
      reason: "optional asset is absent on local runs",
      condition: "missing local snapshot asset",
      introducedAt: "2026-04-01",
      expiresAt: "2026-04-30",
    };

    expect(
      isManifestQuarantined([entry], {
        suite: "tests\\paint-vrt.spec.ts",
        testName: "optional snapshot asset",
        taskId: "paint-vrt",
      }),
    ).toBe(true);
  });
});
