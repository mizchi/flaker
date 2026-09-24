// tests/integration-mutate.test.ts
//
// `flaker calibrate --mutate` end to end (#108): a scratch repository with a
// vitest suite, jev-test-filter answering from a local stand-in for the
// TypeSafe API, and the real flaker CLI.
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const ROOT = resolve(import.meta.dirname, "..");
const FLAKER_CLI = join(ROOT, "dist/cli/main.js");

function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("TYPESAFE")));
  return { ...env, ...extra };
}

function scratchRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "flaker-mutate-"));
  symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"), "dir");
  const git = (...args: string[]) => {
    const res = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: repo, env: scrubbedEnv(), encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
  };
  writeFileSync(join(repo, ".gitignore"), "node_modules\n.flaker\n.jev-test-filter\nreport.json\n");
  writeFileSync(
    join(repo, "flaker.toml"),
    [
      `[repo]`, `owner = "a"`, `name = "b"`,
      `[storage]`, `path = ".flaker/data"`,
      `[affected]`, `resolver = "git"`, `config = ""`,
      `[runner]`, `type = "vitest"`, `command = "node_modules/.bin/vitest"`,
      `[selector]`, `type = "jev"`, ``,
    ].join("\n"),
  );
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "tests"));
  writeFileSync(
    join(repo, "tests/math.test.js"),
    [
      `import { describe, it, expect } from "vitest";`,
      `import { isEven, max } from "../src/math.js";`,
      `describe("math", () => {`,
      `  it("isEven", () => { expect(isEven(2)).toBe(true); expect(isEven(3)).toBe(false); });`,
      `  it("max", () => { expect(max(1, 2)).toBe(2); expect(max(3, 1)).toBe(3); });`,
      `});`, ``,
    ].join("\n"),
  );
  writeFileSync(join(repo, "src/math.js"), `export const isEven = (n) => n % 2 === 0;\n`);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "isEven");
  writeFileSync(join(repo, "src/math.js"), `export const isEven = (n) => n % 2 === 0;\n\nexport function max(a, b) {\n  return a > b ? a : b;\n}\n`);
  git("commit", "-qam", "max");
  return repo;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

describe("flaker calibrate --mutate", () => {
  it("--dry-run lists the mutations and touches nothing", async () => {
    const repo = scratchRepo();
    const res = await run("node", [FLAKER_CLI, "calibrate", "--mutate", "3", "--dry-run", "--json"], repo, scrubbedEnv());
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.mutation_trials.trials).toHaveLength(3);
    expect(out.mutation_trials.trials.every((t: { file: string; skipped: string }) => t.file === "src/math.js" && t.skipped === "dry run")).toBe(true);
    expect(out.written).toBe(false);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    expect(status.stdout).toBe("");
  });

  it("runs trials in a worktree, stores them as mutation evidence, and tightens on a mutation miss", async () => {
    const repo = scratchRepo();
    // Real history, so jev's verdicts resolve to known tests.
    const report = spawnSync("node_modules/.bin/vitest", ["run", "--reporter=json", "--outputFile=report.json"], { cwd: repo, env: scrubbedEnv(), encoding: "utf8" });
    expect(report.status, report.stderr).toBe(0);
    const imported = spawnSync("node", [FLAKER_CLI, "import", "report.json", "--adapter", "vitest", "--commit", "base", "--source", "ci"], { cwd: repo, env: scrubbedEnv(), encoding: "utf8" });
    expect(imported.status, imported.stderr).toBe(0);

    // Every test scores 1 with high confidence: under jev's default cutoff (2)
    // nothing is selected, so any kill is a miss that cutoff 1 would catch.
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => { body += d; });
      req.on("end", () => {
        const { questions } = JSON.parse(body);
        const answers = Object.fromEntries(Object.keys(questions).map((id) => [id, { value: 1, confidence: 0.99 }]));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answers, usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    let res;
    try {
      const { port } = server.address() as AddressInfo;
      res = await run("node", [FLAKER_CLI, "calibrate", "--mutate", "3", "--seed", "3", "--json"], repo,
        scrubbedEnv({ TYPESAFE_API_KEY: "test", TYPESAFE_BASE_URL: `http://127.0.0.1:${port}` }));
    } finally {
      await new Promise((r) => server.close(r));
    }
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    const trials = out.mutation_trials.trials as Array<{ skipped: string | null; killed: number; selector_run_id: string | null }>;
    expect(out.mutation_trials.baseline).toEqual({ tests: 2, failures: 0 });
    expect(trials).toHaveLength(3);
    expect(trials.every((t) => t.skipped === null && t.selector_run_id !== null)).toBe(true);
    const kills = trials.reduce((n, t) => n + t.killed, 0);
    expect(kills).toBeGreaterThan(0);

    expect(out.mutation).toMatchObject({ records: 3, failures: kills, without_trial: 0, unmatched: 0 });
    expect(out.decision.real_failures).toBe(0);
    expect(out.decision.decision).toBe("tighten");
    expect(out.decision.gate.cutoff).toBeLessThanOrEqual(1);

    // The user's tree is untouched and the worktree is gone.
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout).toBe("");
    expect(spawnSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).stdout.trim().split("\n")).toHaveLength(1);

    // Trials show up in flaker_v1.runs as full mutation runs, and nowhere in real history.
    const db = await DuckDBInstance.create(join(repo, ".flaker/data"), { access_mode: "READ_ONLY" });
    const conn = await db.connect();
    try {
      const runs = (await conn.runAndReadAll(`SELECT source, is_full FROM flaker_v1.runs WHERE source = 'mutation'`)).getRowObjectsJS();
      expect(runs).toHaveLength(3);
      expect(runs.every((r) => r.is_full === true)).toBe(true);
      const history = (await conn.runAndReadAll(`SELECT COUNT(*)::INTEGER AS n FROM test_results`)).getRowObjectsJS();
      expect(history[0].n).toBe(2);
      const misses = (await conn.runAndReadAll(`SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.misses`)).getRowObjectsJS();
      expect(misses[0].n).toBe(0);
    } finally {
      conn.closeSync();
      db.closeSync();
    }
    expect(existsSync(join(repo, ".jev-test-filter"))).toBe(false);
    expect(readFileSync(join(repo, "src/math.js"), "utf8")).toContain("a > b");
  }, 120_000);
});
