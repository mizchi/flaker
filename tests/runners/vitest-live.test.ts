import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VitestRunner } from "../../src/cli/runners/vitest.js";

describe("VitestRunner with the installed Vitest", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it.each([undefined, 1])("collects results through a symlinked cwd with workers=%s", async (workers) => {
    const directory = mkdtempSync(join(tmpdir(), "flaker-vitest-live-"));
    directories.push(directory);
    const real = join(directory, "real");
    const alias = join(directory, "alias");
    mkdirSync(real);
    symlinkSync(real, alias, "junction");
    symlinkSync(resolve("node_modules"), join(real, "node_modules"), "junction");
    writeFileSync(join(real, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(real, "math.test.js"), `import { it, expect } from "vitest";
it("adds", () => expect(1 + 1).toBe(2));
it("fails", () => expect(1 + 1).toBe(3));
`);

    const runner = new VitestRunner({
      command: `${process.execPath} ${resolve("node_modules/vitest/vitest.mjs")}`,
    });
    const tests = await runner.listTests({ cwd: alias });
    expect(tests.map((test) => test.suite)).toEqual(["math.test.js", "math.test.js"]);
    const result = await runner.execute(tests, { cwd: alias, workers });
    expect(result.results.map(({ testName, status }) => ({ testName, status }))).toEqual([
      { testName: "adds", status: "passed" },
      { testName: "fails", status: "failed" },
    ]);
    expect(result.exitCode).toBe(1);
  });
});
