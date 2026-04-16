import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

function writeExecutableFixtures(dir: string): void {
  writeFileSync(
    join(dir, "list-tests.mjs"),
    [
      "const tests = [",
      '  { suite: "tests/login.spec.ts", testName: "login works", taskId: "tests/login.spec.ts" },',
      '  { suite: "tests/signup.spec.ts", testName: "signup works", taskId: "tests/signup.spec.ts" },',
      '  { suite: "tests/dashboard.spec.ts", testName: "dashboard loads", taskId: "tests/dashboard.spec.ts" },',
      "];",
      "console.log(JSON.stringify(tests));",
    ].join("\n"),
    "utf-8",
  );

  writeFileSync(
    join(dir, "execute-tests.mjs"),
    [
      'import { readFileSync } from "node:fs";',
      'const payload = JSON.parse(readFileSync(0, "utf-8"));',
      "const tests = payload.tests ?? [];",
      "const results = tests.map((test) => ({",
      "  suite: test.suite,",
      "  testName: test.testName,",
      "  taskId: test.taskId ?? test.suite,",
      '  status: "passed",',
      "  durationMs: 10,",
      "  retryCount: 0,",
      "  errorMessage: null,",
      "}));",
      "console.log(JSON.stringify({",
      "  exitCode: 0,",
      "  results,",
      "  durationMs: 10,",
      '  stdout: "",',
      '  stderr: "",',
      "}));",
    ].join("\n"),
    "utf-8",
  );
}

function writeConfig(dir: string): void {
  writeFileSync(
    join(dir, "flaker.toml"),
    `
[repo]
owner = "acme"
name = "demo"

[storage]
path = ".flaker/data.duckdb"

[adapter]
type = "vitest"

[runner]
type = "custom"
command = "unused"
execute = "node execute-tests.mjs"
list = "node list-tests.mjs"

[affected]
resolver = "workspace"
config = ""

[sampling]
strategy = "weighted"
`.trim(),
    "utf-8",
  );
}

describe("packaged CLI cold start", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can sample from zero history, record data, and use that history on the next run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-package-cold-start-"));
    tempDirs.push(dir);
    writeExecutableFixtures(dir);
    writeConfig(dir);

    const cliPath = join(process.cwd(), "dist/cli/main.js");
    const runCli = (args: string[]) =>
      execFileSync(process.execPath, [cliPath, ...args], {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });

    const firstDryRun = runCli(["run", "--dry-run", "--count", "2"]);
    expect(firstDryRun).toContain("Fallback reason:          cold-start-listed-tests");
    expect(firstDryRun).toContain("Selected tests:           2 / 3");

    const firstRun = runCli(["run", "--count", "2"]);
    expect(firstRun).toContain("# Sampling Summary");
    expect(existsSync(join(dir, ".flaker", "data.duckdb"))).toBe(true);

    const queryOutput = runCli([
      "analyze",
      "query",
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    ]);
    expect(queryOutput).toContain("cnt");
    expect(queryOutput).toContain("2");

    const secondDryRun = runCli(["run", "--dry-run", "--count", "2"]);
    expect(secondDryRun).not.toContain("Fallback reason:          cold-start-listed-tests");
    expect(secondDryRun).toContain("Selected tests:           2 / 3");
  });
});
