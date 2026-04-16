import type { TestCaseResult } from "../adapters/types.js";
import { playwrightAdapter } from "../adapters/playwright.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import {
  escapeRegex,
  runCommandSafe,
  parseBaseCommand,
  wrapLegacyExec,
  type SafeExecFn,
  type LegacyExecFn,
} from "./utils.js";

interface PlaywrightListSpec {
  title: string;
  file: string;
  tags?: string[];
}

interface PlaywrightListSuite {
  title: string;
  file?: string;
  suites?: PlaywrightListSuite[];
  specs?: PlaywrightListSpec[];
}

interface PlaywrightListOutput {
  suites: PlaywrightListSuite[];
}

function extractTitleTags(title: string): string[] {
  return [...title.matchAll(/(^|\s)(@\S+)/g)]
    .map((match) => match[2]?.trim())
    .filter((value): value is string => Boolean(value));
}

function mergeTags(spec: PlaywrightListSpec): string[] | undefined {
  const merged = new Set<string>([
    ...(spec.tags ?? []),
    ...extractTitleTags(spec.title ?? ""),
  ]);
  return merged.size > 0 ? [...merged] : undefined;
}

function collectSpecs(
  suite: PlaywrightListSuite,
  currentFile: string | null,
  currentTaskId: string | null,
  out: TestId[],
): void {
  const nextFile = suite.file ?? currentFile ?? suite.title;
  const nextTaskId = currentTaskId ?? suite.title;
  if (suite.specs) {
    for (const spec of suite.specs) {
      out.push({
        suite: spec.file ?? nextFile,
        testName: spec.title,
        taskId: nextTaskId,
        tags: mergeTags(spec),
      });
    }
  }
  if (suite.suites) {
    for (const child of suite.suites) {
      collectSpecs(child, nextFile, child.title, out);
    }
  }
}

export function parsePlaywrightList(stdout: string): TestId[] {
  const data: PlaywrightListOutput = JSON.parse(stdout);
  const ids: TestId[] = [];
  for (const suite of data.suites) {
    collectSpecs(suite, suite.file ?? null, suite.title, ids);
  }
  return ids;
}

export class PlaywrightRunner implements RunnerAdapter {
  name = "playwright";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: LegacyExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm exec playwright test";
    this.safeExecFn = opts?.safeExec ?? (opts?.exec ? wrapLegacyExec(opts.exec) : runCommandSafe);
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const pattern = tests.map((t) => escapeRegex(t.testName)).join("|");
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...args, "--grep", pattern, "--reporter", "json"];
    if (opts?.grepInvert) {
      runArgs.push("--grep-invert", opts.grepInvert);
    }
    if (opts?.workers) {
      runArgs.push(`--workers=${opts.workers}`);
    }
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      results = playwrightAdapter.parse(stdout);
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const { stdout } = this.safeExecFn(cmd, [...args, "--list", "--reporter", "json"], opts);
    return parsePlaywrightList(stdout);
  }
}
