import { describe, expect, it } from "vitest";
import { runAffected, formatAffectedReport } from "../../src/cli/commands/affected.js";
import { SimpleResolver } from "../../src/cli/resolvers/simple.js";

describe("affected command", () => {
  it("reports split ownership, match reasons, and unmatched paths", async () => {
    const report = await runAffected({
      resolverName: "simple",
      resolver: new SimpleResolver(),
      changedFiles: [
        "src/website-loading/home.ts",
        "docs/notes.md",
      ],
      listedTests: [
        {
          suite: "tests/website-loading/test.spec.ts",
          testName: "desktop loading",
          taskId: "website-loading",
          filter: "@desktop",
        },
        {
          suite: "tests/website-loading/test.spec.ts",
          testName: "mobile loading",
          taskId: "website-loading",
          filter: "@mobile",
        },
        {
          suite: "tests/paint-vrt/test.spec.ts",
          testName: "paint",
          taskId: "paint-vrt",
        },
      ],
    });

    expect(report.matched).toHaveLength(2);
    expect(report.selected).toHaveLength(2);
    expect(report.selected.map((entry) => entry.filter)).toEqual([
      "@desktop",
      "@mobile",
    ]);
    expect(report.selected.every((entry) => entry.direct)).toBe(true);
    expect(report.unmatched).toEqual(["docs/notes.md"]);
    expect(report.selected[0].matchReasons[0]).toContain(
      "directory:src/website-loading",
    );

    const json = formatAffectedReport(report, "json");
    const markdown = formatAffectedReport(report, "markdown");

    expect(JSON.parse(json)).toMatchObject({
      resolver: "simple",
      summary: {
        matchedCount: 2,
        selectedCount: 2,
        unmatchedCount: 1,
      },
    });
    expect(markdown).toContain("# Affected Report");
    expect(markdown).toContain("website-loading");
    expect(markdown).toContain("@desktop");
    expect(markdown).toContain("docs/notes.md");
  });
});
