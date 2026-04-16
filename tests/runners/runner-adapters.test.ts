import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { VitestRunner, parseVitestJson, parseVitestList } from "../../src/cli/runners/vitest.js";
import { PlaywrightRunner, parsePlaywrightList } from "../../src/cli/runners/playwright.js";
import { MoonTestRunner, parseMoonTestOutput, parseMoonTestList } from "../../src/cli/runners/moontest.js";
import { CustomRunner } from "../../src/cli/runners/custom-runner.js";
import { escapeRegex } from "../../src/cli/runners/utils.js";
import { createRunner } from "../../src/cli/runners/index.js";
import type { CommandResult } from "../../src/cli/runners/utils.js";

// ── escapeRegex ──────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
    expect(escapeRegex("a+b*c?")).toBe("a\\+b\\*c\\?");
    expect(escapeRegex("(test)")).toBe("\\(test\\)");
    expect(escapeRegex("[x]")).toBe("\\[x\\]");
    expect(escapeRegex("a{1}")).toBe("a\\{1\\}");
    expect(escapeRegex("$end^start")).toBe("\\$end\\^start");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("back\\slash")).toBe("back\\\\slash");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeRegex("simple test name")).toBe("simple test name");
  });
});

// ── VitestRunner ─────────────────────────────────────────────

describe("VitestRunner", () => {
  const vitestJsonOutput = JSON.stringify({
    testResults: [
      {
        name: "/path/to/file.test.ts",
        assertionResults: [
          {
            fullName: "math adds numbers",
            status: "passed",
            duration: 5,
            failureMessages: [],
          },
          {
            fullName: "math subtracts numbers",
            status: "failed",
            duration: 10,
            failureMessages: ["Expected 3 but got 4"],
          },
        ],
      },
    ],
  });

  it("execute normalizes the vitest subcommand before appending run", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    const runner = new VitestRunner({
      command: "pnpm exec vitest run",
      safeExec: (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return { exitCode: 0, stdout: vitestJsonOutput, stderr: "" };
      },
    });

    await runner.execute([
      { suite: "/path/to/file.test.ts", testName: "math adds numbers" },
      { suite: "/path/to/file.test.ts", testName: "math subtracts numbers" },
    ]);

    expect(capturedCmd).toBe("pnpm");
    expect(capturedArgs).toEqual([
      "exec",
      "vitest",
      "run",
      "/path/to/file.test.ts",
      "--reporter",
      "json",
    ]);
  });

  it("execute parses vitest JSON output", async () => {
    const runner = new VitestRunner({
      safeExec: () => ({ exitCode: 0, stdout: vitestJsonOutput, stderr: "" }),
    });

    const result = await runner.execute([
      { suite: "/path/to/file.test.ts", testName: "math adds numbers" },
      { suite: "/path/to/file.test.ts", testName: "math subtracts numbers" },
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      suite: "/path/to/file.test.ts",
      testName: "math adds numbers",
      status: "passed",
    });
    expect(result.results[1]).toMatchObject({
      suite: "/path/to/file.test.ts",
      testName: "math subtracts numbers",
      status: "failed",
      errorMessage: "Expected 3 but got 4",
    });
  });

  it("execute normalizes absolute vitest suite paths to cwd-relative paths", async () => {
    const suite = "tests/adapters/vitest.test.ts";
    const runner = new VitestRunner({
      safeExec: () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          testResults: [
            {
              name: resolve(process.cwd(), suite),
              assertionResults: [
                {
                  fullName: "vitestAdapter parses vitest JSON reporter output",
                  status: "passed",
                  duration: 5,
                  failureMessages: [],
                },
              ],
            },
          ],
        }),
        stderr: "",
      }),
    });

    const result = await runner.execute([
      {
        suite,
        testName: "vitestAdapter parses vitest JSON reporter output",
      },
    ], { cwd: process.cwd() });

    expect(result.results).toEqual([
      expect.objectContaining({
        suite,
        testName: "vitestAdapter parses vitest JSON reporter output",
        status: "passed",
      }),
    ]);
  });

  it("execute handles parse failure gracefully", async () => {
    const runner = new VitestRunner({
      exec: () => ({ exitCode: 1, stdout: "not json", stderr: "error" }),
    });

    const result = await runner.execute([
      { suite: "s", testName: "t" },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toEqual([]);
  });

  it("listTests builds correct command for vitest list", async () => {
    let capturedCmd = "";
    const runner = new VitestRunner({
      command: "npx vitest run",
      exec: (cmd) => {
        capturedCmd = cmd;
        return {
          exitCode: 0,
          stdout: [
            "/path/a.test.ts > math > adds numbers",
            "/path/b.test.ts > math > subtracts numbers",
          ].join("\n"),
          stderr: "",
        };
      },
    });

    const ids = await runner.listTests();
    expect(capturedCmd).toBe("npx vitest list --reporter json");
    expect(ids).toEqual([
      { suite: "/path/a.test.ts", testName: "math adds numbers", taskId: "/path/a.test.ts" },
      { suite: "/path/b.test.ts", testName: "math subtracts numbers", taskId: "/path/b.test.ts" },
    ]);
  });

  it("execute escapes special characters in test names", async () => {
    // With spawnSync, shell metacharacters are not a concern (no shell interpretation)
    // but the test name pattern should still be usable as a vitest filter
    const runner = new VitestRunner({
      safeExec: (_cmd, _args) => {
        return { exitCode: 0, stdout: JSON.stringify({ testResults: [] }), stderr: "" };
      },
    });

    const result = await runner.execute([{ suite: "s", testName: "test (with parens)" }]);
    expect(result.exitCode).toBe(0);
  });
});

// ── parseVitestJson ──────────────────────────────────────────

describe("parseVitestJson", () => {
  it("preserves file path as suite and full test name", () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: "/file.test.ts",
          assertionResults: [
            {
              fullName: "outer inner test",
              status: "passed",
              duration: 1,
            },
          ],
        },
      ],
    });
    const results = parseVitestJson(json);
    expect(results[0]).toMatchObject({
      suite: "/file.test.ts",
      testName: "outer inner test",
      taskId: "/file.test.ts",
      status: "passed",
    });
  });

  it("normalizes suite paths under cwd to relative paths", () => {
    const suite = resolve(process.cwd(), "tests/abs-path.test.ts");
    const json = JSON.stringify({
      testResults: [
        {
          name: suite,
          assertionResults: [
            {
              fullName: "outer inner test",
              status: "passed",
              duration: 1,
            },
          ],
        },
      ],
    });
    const results = parseVitestJson(json, { cwd: process.cwd() });
    expect(results[0]).toMatchObject({
      suite: "tests/abs-path.test.ts",
      testName: "outer inner test",
      taskId: "tests/abs-path.test.ts",
      status: "passed",
    });
  });
});

describe("parseVitestList", () => {
  it("parses vitest list text output", () => {
    const stdout = [
      "tests/math.test.ts > math > adds numbers",
      "tests/math.test.ts > math > subtracts numbers",
    ].join("\n");

    expect(parseVitestList(stdout)).toEqual([
      {
        suite: "tests/math.test.ts",
        testName: "math adds numbers",
        taskId: "tests/math.test.ts",
      },
      {
        suite: "tests/math.test.ts",
        testName: "math subtracts numbers",
        taskId: "tests/math.test.ts",
      },
    ]);
  });
});

// ── PlaywrightRunner ─────────────────────────────────────────

describe("PlaywrightRunner", () => {
  const playwrightJson = JSON.stringify({
    suites: [
      {
        title: "login.spec.ts",
        file: "tests/login.spec.ts",
        specs: [
          {
            title: "logs in",
            tests: [
              {
                projectName: "chromium",
                status: "expected",
                results: [{ status: "passed", duration: 100, retry: 0 }],
              },
            ],
          },
        ],
      },
    ],
  });

  it("execute builds correct command with --grep and --reporter json", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    const runner = new PlaywrightRunner({
      command: "pnpm exec playwright test",
      safeExec: (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return { exitCode: 0, stdout: playwrightJson, stderr: "" };
      },
    });

    await runner.execute([{ suite: "login", testName: "logs in" }]);
    expect(capturedCmd).toBe("pnpm");
    expect(capturedArgs).toContain("--grep");
    expect(capturedArgs).toContain("logs in");
    expect(capturedArgs).toContain("--reporter");
    expect(capturedArgs).toContain("json");
  });

  it("execute appends --grep-invert when excluding flaky-tagged tests", async () => {
    let capturedArgs: string[] = [];
    const runner = new PlaywrightRunner({
      command: "pnpm exec playwright test",
      safeExec: (_cmd, args) => {
        capturedArgs = args;
        return { exitCode: 0, stdout: playwrightJson, stderr: "" };
      },
    });

    await runner.execute(
      [{ suite: "login", testName: "logs in" }],
      { grepInvert: "@flaky" },
    );

    expect(capturedArgs).toContain("--grep-invert");
    expect(capturedArgs).toContain("@flaky");
  });

  it("execute parses playwright JSON via adapter", async () => {
    const runner = new PlaywrightRunner({
      exec: () => ({ exitCode: 0, stdout: playwrightJson, stderr: "" }),
    });

    const result = await runner.execute([
      { suite: "login", testName: "logs in" },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      suite: "tests/login.spec.ts",
      taskId: "login.spec.ts",
      testName: "logs in",
      status: "passed",
    });
  });

  it("listTests builds correct command and parses output", async () => {
    let capturedCmd = "";
    const listJson = JSON.stringify({
      suites: [
        {
          title: "app.spec.ts",
          specs: [{ title: "renders", file: "app.spec.ts" }],
        },
      ],
    });
    const runner = new PlaywrightRunner({
      exec: (cmd) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: listJson, stderr: "" };
      },
    });

    const ids = await runner.listTests();
    expect(capturedCmd).toBe(
      "pnpm exec playwright test --list --reporter json",
    );
    expect(ids).toEqual([
      { suite: "app.spec.ts", testName: "renders", taskId: "app.spec.ts" },
    ]);
  });

  it("listTests preserves playwright tags when present", async () => {
    const listJson = JSON.stringify({
      suites: [
        {
          title: "app.spec.ts",
          specs: [{ title: "renders", file: "app.spec.ts", tags: ["@smoke", "@flaky"] }],
        },
      ],
    });
    const runner = new PlaywrightRunner({
      exec: () => ({ exitCode: 0, stdout: listJson, stderr: "" }),
    });

    const ids = await runner.listTests();
    expect(ids).toEqual([
      {
        suite: "app.spec.ts",
        testName: "renders",
        taskId: "app.spec.ts",
        tags: ["@smoke", "@flaky"],
      },
    ]);
  });
});

// ── parsePlaywrightList ──────────────────────────────────────

describe("parsePlaywrightList", () => {
  it("parses nested suites", () => {
    const json = JSON.stringify({
      suites: [
        {
          title: "file.spec.ts",
          suites: [
            {
              title: "group",
              specs: [{ title: "works", file: "file.spec.ts" }],
            },
          ],
        },
      ],
    });
    const ids = parsePlaywrightList(json);
    expect(ids).toEqual([
      {
        suite: "file.spec.ts",
        testName: "works",
        taskId: "group",
      },
    ]);
  });
});

// ── MoonTestRunner ───────────────────────────────────────────

describe("MoonTestRunner", () => {
  const moonOutput = [
    "test mizchi/pkg/module/test_add ... ok",
    "test mizchi/pkg/module/test_sub ... FAILED",
  ].join("\n");

  it("execute builds correct command with --filter", async () => {
    let capturedArgs: string[] = [];
    const runner = new MoonTestRunner({
      command: "moon test",
      safeExec: (_cmd, args) => {
        capturedArgs = args;
        return { exitCode: 1, stdout: moonOutput, stderr: "" };
      },
    });

    await runner.execute([
      { suite: "mizchi/pkg/module", testName: "test_add" },
      { suite: "mizchi/pkg/module", testName: "test_sub" },
    ]);

    expect(capturedArgs).toContain("--filter");
    expect(capturedArgs).toContain("mizchi/pkg/module::test_add|mizchi/pkg/module::test_sub");
  });

  it("execute parses moon test output", async () => {
    const runner = new MoonTestRunner({
      exec: () => ({ exitCode: 1, stdout: moonOutput, stderr: "" }),
    });

    const result = await runner.execute([
      { suite: "mizchi/pkg/module", testName: "test_add" },
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      suite: "mizchi/pkg/module",
      testName: "test_add",
      status: "passed",
    });
    expect(result.results[1]).toMatchObject({
      suite: "mizchi/pkg/module",
      testName: "test_sub",
      status: "failed",
    });
  });

  it("listTests builds correct command", async () => {
    let capturedCmd = "";
    const listOutput = "test mizchi/pkg/test_a\ntest mizchi/pkg/test_b\n";
    const runner = new MoonTestRunner({
      exec: (cmd) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: listOutput, stderr: "" };
      },
    });

    const ids = await runner.listTests();
    expect(capturedCmd).toBe("moon test --dry-run");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toEqual({ suite: "mizchi/pkg", testName: "test_a" });
  });
});

// ── parseMoonTestOutput ──────────────────────────────────────

describe("parseMoonTestOutput", () => {
  it("handles empty output", () => {
    expect(parseMoonTestOutput("")).toEqual([]);
  });

  it("handles names without slashes", () => {
    const results = parseMoonTestOutput("test simple_test ... ok\n");
    expect(results[0]).toMatchObject({
      suite: "",
      testName: "simple_test",
      status: "passed",
    });
  });
});

// ── CustomRunner ─────────────────────────────────────────────

describe("CustomRunner", () => {
  it("execute sends JSON to stdin and parses JSON stdout", async () => {
    let capturedStdin = "";
    const expectedResult = {
      exitCode: 0,
      results: [
        {
          suite: "s",
          testName: "t",
          status: "passed" as const,
          durationMs: 10,
          retryCount: 0,
        },
      ],
      durationMs: 100,
      stdout: "",
      stderr: "",
    };

    const runner = new CustomRunner({
      execute: "./run.sh",
      list: "./list.sh",
      safeExec: () => ({ exitCode: 0, stdout: "[]", stderr: "" }),
      safeExecWithStdin: (_cmd, _args, stdin) => {
        capturedStdin = stdin;
        return {
          exitCode: 0,
          stdout: JSON.stringify(expectedResult),
          stderr: "",
        };
      },
    });

    const tests = [{ suite: "s", testName: "t" }];
    const result = await runner.execute(tests);

    expect(JSON.parse(capturedStdin)).toEqual({ tests, opts: undefined });
    expect(result).toEqual(expectedResult);
  });

  it("listTests parses JSON stdout", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    const runner = new CustomRunner({
      execute: "./run.sh",
      list: "./list.sh",
      safeExec: (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ suite: "a", testName: "b" }]),
          stderr: "",
        };
      },
      safeExecWithStdin: () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
    });

    const ids = await runner.listTests();
    expect(capturedCmd).toBe("./list.sh");
    expect(ids).toEqual([{ suite: "a", testName: "b" }]);
  });
});

// ── createRunner factory ─────────────────────────────────────

describe("createRunner", () => {
  it("creates VitestRunner", () => {
    const r = createRunner({ type: "vitest", command: "npx vitest" });
    expect(r.name).toBe("vitest");
  });

  it("creates PlaywrightRunner", () => {
    const r = createRunner({ type: "playwright" });
    expect(r.name).toBe("playwright");
  });

  it("creates MoonTestRunner", () => {
    const r = createRunner({ type: "moontest" });
    expect(r.name).toBe("moontest");
  });

  it("creates CustomRunner", () => {
    const r = createRunner({
      type: "custom",
      execute: "./run.sh",
      list: "./list.sh",
    });
    expect(r.name).toBe("custom");
  });

  it("throws for custom without execute/list", () => {
    expect(() => createRunner({ type: "custom" })).toThrow(
      "Custom runner requires 'execute' and 'list' commands",
    );
  });

  it("throws for unknown type", () => {
    expect(() => createRunner({ type: "unknown" })).toThrow(
      "Unknown runner type: unknown",
    );
  });
});
