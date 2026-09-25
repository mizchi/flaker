// tests/integration-jev-live.test.ts
//
// jev-test-filter run for real (not --dry-run) on a flaker-exported context
// (#101). The first test points jev at a local stand-in for the TypeSafe API
// (TYPESAFE_BASE_URL), so it can read the questions jev sent. The second runs
// against the real API and is skipped unless TYPESAFE_API_KEY is set.
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_SELECTOR, loadConfig } from "../src/cli/config.js";
import { openDatasetStore } from "../src/cli/datasets/open.js";
import { runImport } from "../src/cli/commands/import/report.js";
import { runImportSelector } from "../src/cli/commands/import/selector.js";
import { runSelectorCalibration } from "../src/cli/commands/calibrate/selector.js";
import type { JevContextV1 } from "../src/cli/contracts/jev-context-v1.js";

const REPORT = resolve(import.meta.dirname, "fixtures/vitest-init-report.json");
const FLAKER_CLI = resolve(import.meta.dirname, "../dist/cli/main.js");
const JEV_CLI = resolve(import.meta.dirname, "../node_modules/jev-test-filter/dist/cli.js");
const HEAD = "c0ffee0000000000000000000000000000000002";

function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("TYPESAFE")));
  return { ...env, ...extra };
}

/**
 * A flaker project whose context quarantines `init reads toml`, hints
 * `init writes toml` with src/cli/config.ts, and carries a tightened gate
 * (cutoff 1), exported by the flaker CLI.
 */
async function exportedContext(): Promise<{ path: string; ctx: JevContextV1 }> {
  const project = mkdtempSync(join(tmpdir(), "flaker-jev-live-"));
  writeFileSync(
    join(project, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
  );
  const store = await openDatasetStore(project, loadConfig(project));
  try {
    for (const sha of ["b0000000000000000000000000000000000000001", HEAD]) {
      await store.insertCommitChanges(sha, [{ filePath: "src/cli/config.ts", changeType: "modified", additions: 1, deletions: 0 }]);
      await runImport({ store, filePath: REPORT, adapterType: "vitest", commitSha: sha, branch: "main", source: "ci", workflowName: "ci" });
      await new Promise((r) => setTimeout(r, 5));
    }
    const record = {
      version: 2, createdAt: new Date().toISOString(), base: "origin/main",
      head_sha: HEAD, base_sha: null, context_digest: null,
      gate: { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 }, framework: "vitest",
      tests: [
        { file: "tests/init.test.ts", titlePath: ["init", "writes toml"], line: 3, endLine: 5, framework: "vitest", dynamic: false },
        { file: "tests/init.test.ts", titlePath: ["init", "reads toml"], line: 7, endLine: 9, framework: "vitest", dynamic: false },
      ],
      touched: [], quarantined: [],
      answers: { q0000: { value: 1.2, confidence: 0.9 }, q0001: { value: 0.2, confidence: 0.9 } },
      fallback: null,
    };
    const recordPath = join(project, `${HEAD}.json`);
    writeFileSync(recordPath, JSON.stringify(record));
    await runImportSelector({ store, path: recordPath, adapter: "jev" });
    await store.addQuarantine({ suite: "tests/init.test.ts", testName: "init reads toml" }, "manual");
    await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
  } finally {
    await store.close();
  }
  const exported = spawnSync("node", [FLAKER_CLI, "export", "--projection", "jev-context", "-o", "context.json"], { cwd: project, env: scrubbedEnv(), encoding: "utf8" });
  expect(exported.status, exported.stderr).toBe(0);
  const path = join(project, "context.json");
  const ctx = JSON.parse(readFileSync(path, "utf8")) as JevContextV1;
  expect(ctx.skip).toEqual([{ file: "tests/init.test.ts", title_path: ["init", "reads toml"], reason: "quarantined" }]);
  expect(ctx.tests).toEqual([{ file: "tests/init.test.ts", title_path: ["init", "writes toml"], failed_with: ["src/cli/config.ts"], missed: 1 }]);
  expect(ctx.gate).toMatchObject({ cutoff: 1 });
  return { path, ctx };
}

/** A git repository with the two tests, and a second commit that changes src/cli/config.ts. */
function fixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "flaker-jev-live-repo-"));
  const git = (...args: string[]) => {
    const res = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: repo, env: scrubbedEnv(), encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
  };
  mkdirSync(join(repo, "tests"));
  mkdirSync(join(repo, "src/cli"), { recursive: true });
  writeFileSync(
    join(repo, "tests/init.test.ts"),
    `import { describe, it } from "vitest";\n\ndescribe("init", () => {\n  it("writes toml", () => {\n  });\n\n  it("reads toml", () => {\n  });\n});\n`,
  );
  writeFileSync(join(repo, "src/cli/config.ts"), `export const x = 1;\n`);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  writeFileSync(join(repo, "src/cli/config.ts"), `export const x = 2;\n`);
  git("commit", "-qam", "change config");
  return repo;
}

interface JevRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs jev without blocking the event loop, so an in-process server can answer it. */
function runJev(repo: string, contextPath: string, env: NodeJS.ProcessEnv): Promise<JevRun> {
  return new Promise((done, fail) => {
    const child = spawn("node", [JEV_CLI, "--base", "HEAD~1", "--format", "vitest", "--context", contextPath, "--json"], { cwd: repo, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

interface JevJson {
  fallback: unknown;
  tests: Array<{ file: string; name: string; reason: string; selected: boolean }>;
}

interface JevRecord {
  context_digest: string | null;
  gate: { cutoff: number; unsure_below: number; unsure_margin: number };
  /** jev's test ids: file, title path and line joined by U+001F. */
  quarantined: string[];
}

function expectContextTookEffect(repo: string, run: JevRun, ctx: JevContextV1): void {
  expect(run.status, run.stderr).toBe(0);
  const out = JSON.parse(run.stdout) as JevJson;
  expect(out.fallback).toBeNull();
  const reads = out.tests.find((t) => t.name.includes("reads toml"));
  expect(reads).toMatchObject({ reason: "quarantined", selected: false });

  const record = JSON.parse(readFileSync(join(repo, ".jev-test-filter/last.json"), "utf8")) as JevRecord;
  expect(record.quarantined.map((id) => id.split("\u001f").slice(0, 3))).toEqual([["tests/init.test.ts", "init", "reads toml"]]);
  expect(record.context_digest).toBe(ctx.digest);
  expect(record.gate).toEqual({ cutoff: ctx.gate!.cutoff, unsure_below: ctx.gate!.unsure_below, unsure_margin: ctx.gate!.unsure_margin });
}

describe("jev-test-filter, run for real on a flaker-exported context", () => {
  it("skips the quarantined test, puts the hint into the question, and decides under the context's gate", async () => {
    const { path, ctx } = await exportedContext();
    const repo = fixtureRepo();

    const bodies: Array<{ questions: Record<string, { instructions: { test_name: string; history?: string } }> }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => { body += d; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        bodies.push(parsed);
        const answers = Object.fromEntries(Object.keys(parsed.questions).map((id) => [id, { value: 0, confidence: 0.99 }]));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answers, usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const run = await runJev(repo, path, scrubbedEnv({ TYPESAFE_API_KEY: "test", TYPESAFE_BASE_URL: `http://127.0.0.1:${port}` }));
      expectContextTookEffect(repo, run, ctx);
    } finally {
      await new Promise((r) => server.close(r));
    }

    const questions = bodies.flatMap((b) => Object.values(b.questions));
    // The quarantined test is never asked about.
    expect(questions.map((q) => q.instructions.test_name)).toEqual([expect.stringContaining("writes toml")]);
    expect(questions[0].instructions.history).toBe("This test previously failed when src/cli/config.ts changed.");
  });

  it.skipIf(!process.env.TYPESAFE_API_KEY)("does the same against the TypeSafe API (needs TYPESAFE_API_KEY)", async () => {
    const { path, ctx } = await exportedContext();
    const repo = fixtureRepo();
    const run = await runJev(repo, path, scrubbedEnv({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY! }));
    expectContextTookEffect(repo, run, ctx);
  }, 120_000);
});
