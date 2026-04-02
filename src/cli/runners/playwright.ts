import type { TestCaseResult } from "../adapters/types.js";
import { playwrightAdapter } from "../adapters/playwright.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { escapeRegex, runCommand } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

interface PlaywrightListSpec {
  title: string;
  file: string;
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
  private execFn: ExecFn;

  constructor(opts?: { command?: string; exec?: ExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm exec playwright test";
    this.execFn = opts?.exec ?? runCommand;
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const pattern = tests.map((t) => escapeRegex(t.testName)).join("|");
    const workerArgs = opts?.workers ? ` --workers=${opts.workers}` : "";
    const cmd = `${this.baseCommand} --grep "${pattern}" --reporter json${workerArgs}`;
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.execFn(cmd, opts);
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
    const cmd = `${this.baseCommand} --list --reporter json`;
    const { stdout } = this.execFn(cmd, opts);
    return parsePlaywrightList(stdout);
  }
}
