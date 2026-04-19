import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendConfigWarnings,
  formatConfigCheckReport,
  loadTaskDefinitionsForCheck,
  runConfigCheck,
} from "../../src/cli/commands/policy/check.js";

describe("check command", () => {
  it("detects duplicate ownership, allows filtered split ownership, and reports unmanaged specs", async () => {
    const report = await runConfigCheck({
      listedTests: [
        {
          suite: "tests/auth/login.spec.ts",
          testName: "renders login form",
          taskId: "auth-login",
        },
        {
          suite: "tests/auth/login.spec.ts",
          testName: "submits login form",
          taskId: "auth-login",
        },
        {
          suite: "tests/website-loading.spec.ts",
          testName: "desktop loading",
          taskId: "website-loading",
          filter: "@desktop",
        },
        {
          suite: "tests/website-loading.spec.ts",
          testName: "mobile loading",
          taskId: "website-loading",
          filter: "@mobile",
        },
        {
          suite: "tests/duplicate.spec.ts",
          testName: "owner a",
          taskId: "dup-a",
        },
        {
          suite: "tests/duplicate.spec.ts",
          testName: "owner b",
          taskId: "dup-b",
        },
      ],
      discoveredSpecs: [
        "tests/auth/login.spec.ts",
        "tests/website-loading.spec.ts",
        "tests/duplicate.spec.ts",
        "tests/unmanaged.spec.ts",
      ],
      taskDefinitions: [
        {
          taskId: "auth-login",
          node: "auth",
          needs: [],
          srcs: ["src/auth/**"],
        },
        {
          taskId: "website-loading",
          node: "web",
          needs: ["auth-login"],
          srcs: ["src/website/**", "src/shared/**"],
        },
      ],
    });

    expect(report.errors).toEqual([
      expect.objectContaining({
        code: "duplicate-ownership",
        spec: "tests/duplicate.spec.ts",
      }),
    ]);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: "unmanaged-spec",
        spec: "tests/unmanaged.spec.ts",
      }),
    ]);
    expect(
      report.ownership.find(
        (entry) => entry.spec === "tests/website-loading.spec.ts",
      ),
    ).toMatchObject({
      kind: "split",
      owners: [
        { taskId: "website-loading", filter: "@desktop" },
        { taskId: "website-loading", filter: "@mobile" },
      ],
    });
    expect(
      report.tasks.find((task) => task.taskId === "website-loading"),
    ).toMatchObject({
      taskId: "website-loading",
      specCount: 1,
      testCount: 2,
      filterCount: 2,
      node: "web",
      needsCount: 1,
      srcCount: 2,
    });
    expect(report.summary).toMatchObject({
      taskCount: 4,
      specCount: 3,
      duplicateOwnershipCount: 1,
      splitOwnershipCount: 1,
      unmanagedSpecCount: 1,
      errorCount: 1,
      warningCount: 1,
    });

    const json = formatConfigCheckReport(report, "json");
    const markdown = formatConfigCheckReport(report, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      summary: {
        duplicateOwnershipCount: 1,
        unmanagedSpecCount: 1,
      },
    });
    expect(markdown).toContain("# Config Check Report");
    expect(markdown).toContain("tests/unmanaged.spec.ts");
    expect(markdown).toContain("tests/duplicate.spec.ts");
    expect(markdown).toContain("website-loading");
    expect(markdown).toContain("@desktop");
  });

  it("loads bitflow task definitions from affected config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "config-check-"));
    try {
      const workflowPath = join(cwd, "flaker.star");
      writeFileSync(
        workflowPath,
        [
          'workflow(name="ci")',
          'node(id="web", depends_on=["core"])',
          'task(id="website-loading", node="web", cmd="test", needs=["auth-login"], srcs=["src/website/**", "src/shared/**"])',
          'task(id="auth-login", node="core", cmd="test", needs=[], srcs=["src/auth/**"])',
        ].join("\n"),
      );

      expect(
        loadTaskDefinitionsForCheck({
          cwd,
          resolverName: "bitflow",
          resolverConfig: "flaker.star",
        }),
      ).toEqual([
        {
          taskId: "website-loading",
          node: "web",
          needs: ["auth-login"],
          srcs: ["src/website/**", "src/shared/**"],
        },
        {
          taskId: "auth-login",
          node: "core",
          needs: [],
          srcs: ["src/auth/**"],
        },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appends threshold unit warnings to the report", async () => {
    const base = await runConfigCheck({
      listedTests: [],
      discoveredSpecs: [],
      taskDefinitions: [],
    });

    const report = appendConfigWarnings(base, [
      {
        code: "legacy-threshold-unit",
        path: "quarantine.flaky_rate_threshold",
        value: 0.3,
        normalizedValue: 30,
      },
    ]);

    expect(report.summary.warningCount).toBe(1);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: "legacy-threshold-unit",
        spec: "flaker.toml",
      }),
    ]);

    const markdown = formatConfigCheckReport(report, "markdown");
    expect(markdown).toContain("quarantine.flaky_rate_threshold");
    expect(markdown).toContain("30%");
  });
});
