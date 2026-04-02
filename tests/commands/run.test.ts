import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runTests } from "../../src/cli/commands/run.js";
import type { RunnerAdapter, TestId } from "../../src/cli/runners/types.js";
import type { QuarantineManifestEntry } from "../../src/cli/quarantine-manifest.js";
import type { DependencyResolver } from "../../src/cli/resolvers/types.js";

describe("run command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await store.insertWorkflowRun({
      id: 1,
      repo: "test/repo",
      branch: "main",
      commitSha: "abc",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    });
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/paint-vrt.spec.ts",
        testName: "optional snapshot asset",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("enriches sampled tests via listTests and applies runtime quarantine", async () => {
    const calls: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async listTests() {
        return [
          {
            suite: "tests/paint-vrt.spec.ts",
            testName: "optional snapshot asset",
            taskId: "paint-vrt",
          },
        ];
      },
      async execute(tests) {
        calls.push([...tests]);
        return {
          exitCode: 0,
          results: tests.map((test) => ({
            suite: test.suite,
            testName: test.testName,
            taskId: test.taskId,
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          })),
          durationMs: 10,
          stdout: "",
          stderr: "",
        };
      },
    };
    const manifestEntries: QuarantineManifestEntry[] = [
      {
        id: "paint-vrt-local-assets",
        taskId: "paint-vrt",
        spec: "tests/paint-vrt.spec.ts",
        titlePattern: "^optional snapshot asset$",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "local-only asset",
        condition: "asset not installed",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
    ];

    const result = await runTests({
      store,
      runner,
      mode: "random",
      count: 1,
      quarantineManifestEntries: manifestEntries,
    });

    expect(calls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      suite: "tests/paint-vrt.spec.ts",
      testName: "optional snapshot asset",
      status: "skipped",
      quarantine: {
        id: "paint-vrt-local-assets",
      },
    });
  });

  it("supports affected mode in runTests", async () => {
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/auth.spec.ts",
        testName: "auth works",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
      {
        workflowRunId: 1,
        suite: "tests/home.spec.ts",
        testName: "home works",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
    ]);

    const calls: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async listTests() {
        return [
          { suite: "tests/auth.spec.ts", testName: "auth works", taskId: "auth" },
          { suite: "tests/home.spec.ts", testName: "home works", taskId: "home" },
        ];
      },
      async execute(tests) {
        calls.push([...tests]);
        return {
          exitCode: 0,
          results: tests.map((test) => ({
            suite: test.suite,
            testName: test.testName,
            taskId: test.taskId,
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          })),
          durationMs: 10,
          stdout: "",
          stderr: "",
        };
      },
    };
    const resolver: DependencyResolver = {
      resolve(changedFiles) {
        expect(changedFiles).toEqual(["src/auth/login.ts"]);
        return ["tests/auth.spec.ts"];
      },
    };

    const result = await runTests({
      store,
      runner,
      mode: "affected",
      changedFiles: ["src/auth/login.ts"],
      resolver,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      expect.objectContaining({
        suite: "tests/auth.spec.ts",
        testName: "auth works",
        taskId: "auth",
      }),
    ]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      suite: "tests/auth.spec.ts",
      testName: "auth works",
    });
    expect(result.samplingSummary.selectedCount).toBe(1);
    expect(result.samplingSummary.candidateCount).toBe(2);
  });

  it("supports hybrid mode in runTests", async () => {
    for (const entry of [
      { suite: "tests/auth.spec.ts", testName: "auth works" },
      { suite: "tests/home.spec.ts", testName: "home works" },
      { suite: "tests/api.spec.ts", testName: "api works" },
    ]) {
      await store.insertTestResults([
        {
          workflowRunId: 1,
          suite: entry.suite,
          testName: entry.testName,
          status: "passed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: null,
          commitSha: "abc",
          variant: null,
          createdAt: new Date(),
        },
      ]);
    }

    const calls: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async listTests() {
        return [
          { suite: "tests/auth.spec.ts", testName: "auth works", taskId: "auth" },
          { suite: "tests/home.spec.ts", testName: "home works", taskId: "home" },
          { suite: "tests/api.spec.ts", testName: "api works", taskId: "api" },
        ];
      },
      async execute(tests) {
        calls.push([...tests]);
        return {
          exitCode: 0,
          results: tests.map((test) => ({
            suite: test.suite,
            testName: test.testName,
            taskId: test.taskId,
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          })),
          durationMs: 10,
          stdout: "",
          stderr: "",
        };
      },
    };
    const resolver: DependencyResolver = {
      resolve() {
        return ["tests/home.spec.ts"];
      },
    };

    const result = await runTests({
      store,
      runner,
      mode: "hybrid",
      count: 2,
      seed: 42,
      changedFiles: ["src/home/index.ts"],
      resolver,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suite: "tests/home.spec.ts",
          testName: "home works",
          taskId: "home",
        }),
      ]),
    );
    expect(result.results).toHaveLength(2);
    expect(result.samplingSummary.selectedCount).toBe(2);
    expect(result.samplingSummary.candidateCount).toBe(3);
  });

  it("enriches sampled tests by stable test_id when suite and test name collide", async () => {
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/shared.spec.ts",
        testName: "shared case",
        taskId: "desktop",
        filter: "@desktop",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
      {
        workflowRunId: 1,
        suite: "tests/shared.spec.ts",
        testName: "shared case",
        taskId: "mobile",
        filter: "@mobile",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
    ]);

    const calls: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async listTests() {
        return [
          {
            suite: "tests/shared.spec.ts",
            testName: "shared case",
            taskId: "desktop",
            filter: "@desktop",
          },
          {
            suite: "tests/shared.spec.ts",
            testName: "shared case",
            taskId: "mobile",
            filter: "@mobile",
          },
        ];
      },
      async execute(tests) {
        calls.push([...tests]);
        return {
          exitCode: 0,
          results: tests.map((test) => ({
            suite: test.suite,
            testName: test.testName,
            taskId: test.taskId,
            filter: test.filter,
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          })),
          durationMs: 10,
          stdout: "",
          stderr: "",
        };
      },
    };

    const resolver: DependencyResolver = {
      resolve() {
        return ["tests/shared.spec.ts"];
      },
    };

    await runTests({
      store,
      runner,
      mode: "affected",
      resolver,
      changedFiles: ["src/shared/view.ts"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0].map((test) => test.filter).sort()).toEqual([
      "@desktop",
      "@mobile",
    ]);
  });
});
