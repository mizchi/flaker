import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TestCaseResult, TestResultAdapter } from "./types.js";
import { resolveTestIdentity } from "../identity.js";
import { parseVitestJson } from "../runners/vitest.js";

export interface ActrunTask {
  id: string;
  kind: string;
  status: string;
  code: number;
  shell: string;
  stdout_path?: string;
  stderr_path?: string;
}

export interface ActrunStep {
  id: string;
  status: string;
  required: boolean;
  message: string;
}

export interface ActrunRunOutput {
  run_id: string;
  conclusion?: string;
  headSha?: string;
  headBranch?: string;
  startedAt?: string;
  completedAt?: string;
  status?: string;
  workflow_name?: string;
  workflow_path?: string;
  workspace_root?: string;
  workspace_mode?: string;
  started_at_ms?: number;
  finished_at_ms?: number;
  state?: string;
  ok?: boolean;
  exit_code?: number;
  repository?: string;
  ref_name?: string;
  before_sha?: string;
  after_sha?: string;
  tasks: ActrunTask[];
  steps: ActrunStep[];
}

function parseTaskId(id: string): { suite: string; testName: string } {
  const slashIdx = id.indexOf("/");
  if (slashIdx === -1) {
    return { suite: id, testName: id };
  }
  return {
    suite: id.slice(0, slashIdx),
    testName: id.slice(slashIdx + 1),
  };
}

function mapStatus(task: ActrunTask): TestCaseResult["status"] {
  if (task.code !== 0) return "failed";
  if (task.status === "ok" || task.status === "success") return "passed";
  if (task.status === "failed") return "failed";
  return "failed";
}

function resolveTimestampIso(value?: string, epochMs?: number): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof epochMs === "number" && Number.isFinite(epochMs)) {
    return new Date(epochMs).toISOString();
  }
  return undefined;
}

function readOptionalLog(path?: string): string | undefined {
  if (!path || !existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf-8");
}

function collectArtifactPaths(task: ActrunTask): string[] | null {
  const paths = [task.stdout_path, task.stderr_path]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return paths.length > 0 ? paths : null;
}

export function resolveActrunConclusion(output: ActrunRunOutput): string {
  if (output.conclusion) return output.conclusion;
  if (typeof output.ok === "boolean") return output.ok ? "success" : "failure";
  if (typeof output.exit_code === "number") return output.exit_code === 0 ? "success" : "failure";
  return output.state ?? output.status ?? "completed";
}

export function resolveActrunHeadSha(output: ActrunRunOutput): string {
  return output.headSha?.trim()
    || output.after_sha?.trim()
    || `actrun-${output.run_id}`;
}

export function resolveActrunHeadBranch(output: ActrunRunOutput): string {
  return output.headBranch?.trim()
    || output.ref_name?.trim()
    || "local";
}

export function resolveActrunStartedAt(output: ActrunRunOutput): string {
  return resolveTimestampIso(output.startedAt, output.started_at_ms)
    ?? new Date(0).toISOString();
}

export function resolveActrunCompletedAt(output: ActrunRunOutput): string {
  return resolveTimestampIso(output.completedAt, output.finished_at_ms)
    ?? resolveActrunStartedAt(output);
}

export const actrunAdapter: TestResultAdapter = {
  name: "actrun",
  parse(input: string): TestCaseResult[] {
    const output: ActrunRunOutput = JSON.parse(input);
    return output.tasks.map((task) => {
      const { suite, testName } = parseTaskId(task.id);
      return resolveTestIdentity({
        suite,
        testName,
        taskId: task.id,
        status: mapStatus(task),
        durationMs: 0,
        retryCount: 0,
        stdout: readOptionalLog(task.stdout_path),
        stderr: readOptionalLog(task.stderr_path),
        artifactPaths: collectArtifactPaths(task),
      });
    });
  },
};

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

export function extractTestReportsFromArtifacts(
  artifactPaths: string[],
  adapters: { playwright: TestResultAdapter; junit: TestResultAdapter },
): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  for (const artifactPath of artifactPaths) {
    if (!existsSync(artifactPath)) continue;
    for (const file of walkFiles(artifactPath)) {
      if (file.endsWith(".json")) {
        try {
          const content = readFileSync(file, "utf-8");
          const parsed = JSON.parse(content);
          // Detect Playwright format (has "suites" key)
          if (parsed.suites) {
            results.push(...adapters.playwright.parse(content));
            continue;
          }
          // Detect Vitest format (has "testResults" key)
          if (parsed.testResults) {
            results.push(...parseVitestJson(content));
            continue;
          }
        } catch {
          /* not a valid report, skip */
        }
      }
      if (file.endsWith(".xml")) {
        try {
          const content = readFileSync(file, "utf-8");
          if (content.includes("<testsuite")) {
            results.push(...adapters.junit.parse(content));
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  return results;
}
