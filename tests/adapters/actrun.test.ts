import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { actrunAdapter, type ActrunRunOutput } from "../../src/cli/adapters/actrun.js";

const sampleOutput: ActrunRunOutput = {
  run_id: "run-1",
  conclusion: "failure",
  headSha: "abc123",
  headBranch: "main",
  startedAt: "2026-03-31T10:00:00Z",
  completedAt: "2026-03-31T10:05:00Z",
  status: "completed",
  tasks: [
    {
      id: "build/install-deps",
      kind: "run",
      status: "ok",
      code: 0,
      shell: "bash",
      stdout_path: "/tmp/stdout1",
      stderr_path: "/tmp/stderr1",
    },
    {
      id: "build/run-tests",
      kind: "run",
      status: "failed",
      code: 1,
      shell: "bash",
      stdout_path: "/tmp/stdout2",
      stderr_path: "/tmp/stderr2",
    },
    {
      id: "lint/eslint",
      kind: "run",
      status: "ok",
      code: 0,
      shell: "bash",
    },
  ],
  steps: [
    { id: "build", status: "failed", required: true, message: "" },
    { id: "lint", status: "ok", required: true, message: "" },
  ],
};

describe("actrunAdapter", () => {
  it("parses actrun JSON into TestCaseResult[]", () => {
    const results = actrunAdapter.parse(JSON.stringify(sampleOutput));
    expect(results).toHaveLength(3);
  });

  it("maps task id to suite/testName by splitting on /", () => {
    const results = actrunAdapter.parse(JSON.stringify(sampleOutput));
    expect(results[0].suite).toBe("build");
    expect(results[0].testName).toBe("install-deps");
    expect(results[2].suite).toBe("lint");
    expect(results[2].testName).toBe("eslint");
  });

  it("maps status ok -> passed, failed -> failed", () => {
    const results = actrunAdapter.parse(JSON.stringify(sampleOutput));
    expect(results[0].status).toBe("passed");
    expect(results[1].status).toBe("failed");
  });

  it("maps non-zero exit code to failed", () => {
    const output: ActrunRunOutput = {
      ...sampleOutput,
      tasks: [
        {
          id: "test/unit",
          kind: "run",
          status: "ok",
          code: 2,
          shell: "bash",
        },
      ],
    };
    const results = actrunAdapter.parse(JSON.stringify(output));
    expect(results[0].status).toBe("failed");
  });

  it("sets durationMs to 0 for tasks (no per-task timing)", () => {
    const results = actrunAdapter.parse(JSON.stringify(sampleOutput));
    for (const r of results) {
      expect(r.durationMs).toBe(0);
    }
  });

  it("handles empty tasks array", () => {
    const output: ActrunRunOutput = {
      ...sampleOutput,
      tasks: [],
    };
    const results = actrunAdapter.parse(JSON.stringify(output));
    expect(results).toHaveLength(0);
  });

  it("handles task id without slash (uses full id as suite and testName)", () => {
    const output: ActrunRunOutput = {
      ...sampleOutput,
      tasks: [
        { id: "single-step", kind: "run", status: "ok", code: 0, shell: "bash" },
      ],
    };
    const results = actrunAdapter.parse(JSON.stringify(output));
    expect(results[0].suite).toBe("single-step");
    expect(results[0].testName).toBe("single-step");
  });

  it("loads per-task stdout/stderr and artifact paths when log files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-actrun-logs-"));
    const stdoutPath = join(dir, "stdout.log");
    const stderrPath = join(dir, "stderr.log");
    writeFileSync(stdoutPath, "stdout line 1\nstdout line 2\n", "utf-8");
    writeFileSync(stderrPath, "stderr line 1\n", "utf-8");

    try {
      const output: ActrunRunOutput = {
        ...sampleOutput,
        tasks: [
          {
            id: "build/run-tests",
            kind: "run",
            status: "failed",
            code: 1,
            shell: "bash",
            stdout_path: stdoutPath,
            stderr_path: stderrPath,
          },
        ],
      };

      const results = actrunAdapter.parse(JSON.stringify(output));
      expect(results[0].stdout).toBe("stdout line 1\nstdout line 2\n");
      expect(results[0].stderr).toBe("stderr line 1\n");
      expect(results[0].artifactPaths).toEqual([stdoutPath, stderrPath]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
