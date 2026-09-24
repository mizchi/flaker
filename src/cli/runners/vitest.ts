import { isAbsolute, relative } from "node:path";
import type { TestCaseResult } from "../adapters/types.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import {
  runCommandSafe,
  parseBaseCommand,
  wrapLegacyExec,
  type SafeExecFn,
  type LegacyExecFn,
} from "./utils.js";

interface VitestAssertionResult {
  fullName: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
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

export function normalizeVitestSuitePath(
  suite: string,
  opts?: { cwd?: string },
): string {
  const cwd = opts?.cwd?.trim();
  if (!cwd || !isAbsolute(suite)) {
    return suite;
  }

  const normalized = relative(cwd, suite);
  if (
    normalized.length === 0
    || normalized.startsWith("..")
    || isAbsolute(normalized)
  ) {
    return suite;
  }
  return normalized.replace(/\\/g, "/");
}

export function parseVitestJson(
  stdout: string,
  opts?: { cwd?: string },
): TestCaseResult[] {
  const data: VitestJsonOutput = JSON.parse(stdout);
  const results: TestCaseResult[] = [];
  for (const file of data.testResults) {
    const suite = normalizeVitestSuitePath(file.name, opts);
    for (const assertion of file.assertionResults) {
      if (assertion.status === "pending" || assertion.status === "todo") {
        continue;
      }
      results.push({
        suite,
        testName: assertion.fullName,
        taskId: suite,
        status: assertion.status === "passed"
          ? "passed"
          : assertion.status === "skipped"
          ? "skipped"
          : "failed",
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
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const files: unknown = JSON.parse(trimmed);
    if (Array.isArray(files) && files.every((entry) => typeof entry === "string")) {
      return files.map((file) => ({
        suite: file,
        testName: file,
        taskId: file,
      }));
    }
  } catch {
    // Fall through to modern Vitest text output parsing.
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(" > ").map((part) => part.trim()).filter(Boolean);
      const suite = parts.shift() ?? line;
      const testName = parts.length > 0 ? parts.join(" ") : suite;
      return {
        suite,
        testName,
        taskId: suite,
      };
    });
}

function normalizeVitestArgs(args: string[], subcommand: "run" | "list"): string[] {
  const trimmed = [...args];
  while (trimmed.length > 0) {
    const tail = trimmed[trimmed.length - 1];
    if (tail === "run" || tail === "list") {
      trimmed.pop();
      continue;
    }
    break;
  }
  return [...trimmed, subcommand];
}

export class VitestRunner implements RunnerAdapter {
  name = "vitest";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: LegacyExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm vitest";
    this.safeExecFn = opts?.safeExec ?? (opts?.exec ? wrapLegacyExec(opts.exec) : runCommandSafe);
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const suiteFiles = [...new Set(tests.map((t) => t.suite))];
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...normalizeVitestArgs(args, "run"), ...suiteFiles, "--reporter", "json"];
    if (opts?.workers) {
      runArgs.push("--pool=threads", `--poolOptions.threads.maxThreads=${opts.workers}`);
    }
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      const all = parseVitestJson(stdout, { cwd: opts?.cwd });
      const selectedKeys = new Set(tests.map((t) => `${t.suite}\0${t.testName}`));
      results = all.filter((r) => selectedKeys.has(`${r.suite}\0${r.testName}`));
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const { exitCode, stdout, stderr } = this.safeExecFn(
      cmd,
      [...normalizeVitestArgs(args, "list"), "--reporter", "json"],
      opts,
    );
    if (exitCode !== 0) {
      const detail = stderr.trim().split("\n").slice(0, 3).join(" | ");
      throw new Error(`vitest list exited with code ${exitCode}: ${detail || "(no stderr)"}`);
    }
    return parseVitestList(stdout);
  }
}
