import type { TestCaseResult } from "../adapters/types.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { runCommandSafe } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export type SafeExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

interface VitestAssertionResult {
  fullName: string;
  status: "passed" | "failed";
  duration: number;
  failureMessages?: string[];
}

interface VitestTestResult {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestJsonOutput {
  testResults: VitestTestResult[];
}

export function parseVitestJson(stdout: string): TestCaseResult[] {
  const data: VitestJsonOutput = JSON.parse(stdout);
  const results: TestCaseResult[] = [];
  for (const file of data.testResults) {
    for (const assertion of file.assertionResults) {
      const parts = assertion.fullName.split(" > ");
      const testName = parts.pop() ?? assertion.fullName;
      const suite = parts.join(" > ") || file.name;
      results.push({
        suite,
        testName,
        status: assertion.status === "passed" ? "passed" : "failed",
        durationMs: assertion.duration ?? 0,
        retryCount: 0,
        errorMessage: assertion.failureMessages?.length
          ? assertion.failureMessages.join("\n")
          : undefined,
      });
    }
  }
  return results;
}

export function parseVitestList(stdout: string): TestId[] {
  // vitest --list --reporter json outputs an array of file paths
  // We return them as TestIds with the file as suite
  const files: string[] = JSON.parse(stdout);
  return files.map((f) => ({ suite: f, testName: f }));
}

/** Parse a command string like "pnpm exec vitest run" into [cmd, ...args] */
function parseBaseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean);
  return { cmd: parts[0], args: parts.slice(1) };
}

export class VitestRunner implements RunnerAdapter {
  name = "vitest";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: ExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm vitest";
    // Support both legacy ExecFn (for tests) and safe exec
    if (opts?.safeExec) {
      this.safeExecFn = opts.safeExec;
    } else if (opts?.exec) {
      // Wrap legacy exec for backward compatibility
      this.safeExecFn = (cmd, args, o) => opts.exec!(`${cmd} ${args.join(" ")}`, o);
    } else {
      this.safeExecFn = runCommandSafe;
    }
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const suiteFiles = [...new Set(tests.map((t) => t.suite))];
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...args, "run", ...suiteFiles, "--reporter", "json"];
    if (opts?.workers) {
      runArgs.push("--pool=threads", `--poolOptions.threads.maxThreads=${opts.workers}`);
    }
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      const all = parseVitestJson(stdout);
      const selectedNames = new Set(tests.map((t) => t.testName));
      results = all.filter((r) => selectedNames.has(r.testName));
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const { stdout } = this.safeExecFn(cmd, [...args, "--list", "--reporter", "json"], opts);
    return parseVitestList(stdout);
  }
}
