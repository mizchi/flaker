import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MoonResolver } from "../../src/cli/resolvers/moon.js";

describe("MoonResolver", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moon-resolver-"));

    // moon.mod.json at root
    writeFileSync(
      join(tmpDir, "moon.mod.json"),
      JSON.stringify({ name: "project" }),
    );

    // src/types — no imports
    mkdirSync(join(tmpDir, "src/types"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/types/moon.pkg"),
      JSON.stringify({ import: [] }),
    );
    writeFileSync(join(tmpDir, "src/types/types.mbt"), "// types");
    writeFileSync(join(tmpDir, "src/types/types_test.mbt"), "// test");

    // src/core — imports types
    mkdirSync(join(tmpDir, "src/core"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/core/moon.pkg"),
      JSON.stringify({ import: ["project/src/types"] }),
    );
    writeFileSync(join(tmpDir, "src/core/core.mbt"), "// core");
    writeFileSync(join(tmpDir, "src/core/core_test.mbt"), "// test");

    // src/app — imports core
    mkdirSync(join(tmpDir, "src/app"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/app/moon.pkg"),
      JSON.stringify({ import: ["project/src/core"] }),
    );
    writeFileSync(join(tmpDir, "src/app/app.mbt"), "// app");
    writeFileSync(join(tmpDir, "src/app/app_test.mbt"), "// test");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("changed types.mbt affects types, core, and app transitively", () => {
    const resolver = new MoonResolver(tmpDir);
    const allTests = [
      "src/types/types_test.mbt",
      "src/core/core_test.mbt",
      "src/app/app_test.mbt",
    ];
    const result = resolver.resolve(["src/types/types.mbt"], allTests);
    expect(result.sort()).toEqual(allTests.sort());
  });

  it("changed app.mbt affects only app", () => {
    const resolver = new MoonResolver(tmpDir);
    const allTests = [
      "src/types/types_test.mbt",
      "src/core/core_test.mbt",
      "src/app/app_test.mbt",
    ];
    const result = resolver.resolve(["src/app/app.mbt"], allTests);
    expect(result).toEqual(["src/app/app_test.mbt"]);
  });

  it("changed core.mbt affects core and app", () => {
    const resolver = new MoonResolver(tmpDir);
    const allTests = [
      "src/types/types_test.mbt",
      "src/core/core_test.mbt",
      "src/app/app_test.mbt",
    ];
    const result = resolver.resolve(["src/core/core.mbt"], allTests);
    expect(result.sort()).toEqual([
      "src/app/app_test.mbt",
      "src/core/core_test.mbt",
    ]);
  });

  it("changed file outside packages affects nothing", () => {
    const resolver = new MoonResolver(tmpDir);
    const allTests = [
      "src/types/types_test.mbt",
      "src/core/core_test.mbt",
      "src/app/app_test.mbt",
    ];
    const result = resolver.resolve(["README.md"], allTests);
    expect(result).toEqual([]);
  });

  it("works with moon.pkg.json format", () => {
    // Add another package using moon.pkg.json
    mkdirSync(join(tmpDir, "src/extra"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/extra/moon.pkg.json"),
      JSON.stringify({ import: ["project/src/app"] }),
    );
    writeFileSync(join(tmpDir, "src/extra/extra.mbt"), "// extra");
    writeFileSync(join(tmpDir, "src/extra/extra_test.mbt"), "// test");

    const resolver = new MoonResolver(tmpDir);
    const allTests = [
      "src/types/types_test.mbt",
      "src/core/core_test.mbt",
      "src/app/app_test.mbt",
      "src/extra/extra_test.mbt",
    ];
    // Change in app should affect app + extra
    const result = resolver.resolve(["src/app/app.mbt"], allTests);
    expect(result.sort()).toEqual([
      "src/app/app_test.mbt",
      "src/extra/extra_test.mbt",
    ]);
  });

  it("explains direct and transitive moon package selection", async () => {
    const resolver = new MoonResolver(tmpDir);
    const report = await resolver.explain?.(
      ["src/types/types.mbt", "README.md"],
      [
        {
          spec: "src/types/types_test.mbt",
          taskId: "src/types",
          filter: null,
        },
        {
          spec: "src/core/core_test.mbt",
          taskId: "src/core",
          filter: null,
        },
        {
          spec: "src/app/app_test.mbt",
          taskId: "src/app",
          filter: null,
        },
      ],
    );

    expect(report?.matched.map((entry) => entry.taskId)).toEqual([
      "src/types",
    ]);
    expect(
      report?.selected.find((entry) => entry.taskId === "src/core"),
    ).toMatchObject({
      direct: false,
      includedBy: ["src/types"],
    });
    expect(
      report?.selected.find((entry) => entry.taskId === "src/app"),
    ).toMatchObject({
      direct: false,
      includedBy: ["src/core"],
    });
    expect(report?.unmatched).toEqual(["README.md"]);
  });
});
