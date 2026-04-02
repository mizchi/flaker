import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceResolver } from "../../src/cli/resolvers/workspace.js";

describe("WorkspaceResolver", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "workspace-resolver-"));

    // Root package.json with workspaces
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );

    // packages/core
    mkdirSync(join(tmpDir, "packages/core/tests"), { recursive: true });
    writeFileSync(
      join(tmpDir, "packages/core/package.json"),
      JSON.stringify({
        name: "@app/core",
        dependencies: {},
      }),
    );
    writeFileSync(join(tmpDir, "packages/core/tests/core.test.ts"), "");

    // packages/utils (depends on core)
    mkdirSync(join(tmpDir, "packages/utils/tests"), { recursive: true });
    writeFileSync(
      join(tmpDir, "packages/utils/package.json"),
      JSON.stringify({
        name: "@app/utils",
        dependencies: { "@app/core": "workspace:*" },
      }),
    );
    writeFileSync(join(tmpDir, "packages/utils/tests/utils.test.ts"), "");

    // packages/app (depends on utils)
    mkdirSync(join(tmpDir, "packages/app/tests"), { recursive: true });
    writeFileSync(
      join(tmpDir, "packages/app/package.json"),
      JSON.stringify({
        name: "@app/app",
        dependencies: { "@app/utils": "workspace:*" },
      }),
    );
    writeFileSync(join(tmpDir, "packages/app/tests/app.test.ts"), "");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers all 3 packages", () => {
    const resolver = new WorkspaceResolver(tmpDir);
    // Access packages via resolve: if we change files in all packages, all test files should appear
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const changed = [
      "packages/core/src/index.ts",
      "packages/utils/src/index.ts",
      "packages/app/src/index.ts",
    ];
    const result = resolver.resolve(changed, allTests);
    expect(result.sort()).toEqual(allTests.sort());
  });

  it("changed file in core affects all 3 packages transitively", () => {
    const resolver = new WorkspaceResolver(tmpDir);
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const result = resolver.resolve(["packages/core/src/index.ts"], allTests);
    expect(result.sort()).toEqual(allTests.sort());
  });

  it("changed file in app affects only app", () => {
    const resolver = new WorkspaceResolver(tmpDir);
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const result = resolver.resolve(["packages/app/src/index.ts"], allTests);
    expect(result).toEqual(["packages/app/tests/app.test.ts"]);
  });

  it("changed file in utils affects utils and app", () => {
    const resolver = new WorkspaceResolver(tmpDir);
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const result = resolver.resolve(
      ["packages/utils/src/helper.ts"],
      allTests,
    );
    expect(result.sort()).toEqual([
      "packages/app/tests/app.test.ts",
      "packages/utils/tests/utils.test.ts",
    ]);
  });

  it("changed file outside packages affects nothing", () => {
    const resolver = new WorkspaceResolver(tmpDir);
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const result = resolver.resolve(["README.md"], allTests);
    expect(result).toEqual([]);
  });

  it("works with pnpm-workspace.yaml", () => {
    // Remove workspaces from package.json and add pnpm-workspace.yaml
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "root" }),
    );
    writeFileSync(
      join(tmpDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
    );
    const resolver = new WorkspaceResolver(tmpDir);
    const allTests = [
      "packages/core/tests/core.test.ts",
      "packages/utils/tests/utils.test.ts",
      "packages/app/tests/app.test.ts",
    ];
    const result = resolver.resolve(["packages/core/src/index.ts"], allTests);
    expect(result.sort()).toEqual(allTests.sort());
  });

  it("explains direct and transitive package selection", async () => {
    const resolver = new WorkspaceResolver(tmpDir);
    const report = await resolver.explain?.(
      ["packages/core/src/index.ts", "README.md"],
      [
        {
          spec: "packages/core/tests/core.test.ts",
          taskId: "@app/core",
          filter: null,
        },
        {
          spec: "packages/utils/tests/utils.test.ts",
          taskId: "@app/utils",
          filter: null,
        },
        {
          spec: "packages/app/tests/app.test.ts",
          taskId: "@app/app",
          filter: null,
        },
      ],
    );

    expect(
      report?.matched.map((entry) => entry.taskId),
    ).toEqual(["@app/core"]);
    expect(
      report?.selected.find((entry) => entry.taskId === "@app/utils"),
    ).toMatchObject({
      direct: false,
      includedBy: ["@app/core"],
    });
    expect(
      report?.selected.find((entry) => entry.taskId === "@app/app"),
    ).toMatchObject({
      direct: false,
      includedBy: ["@app/utils"],
    });
    expect(report?.unmatched).toEqual(["README.md"]);
  });
});
