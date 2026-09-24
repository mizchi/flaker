// src/cli/commands/calibrate/mutate.ts
/**
 * `flaker calibrate --mutate <n>`: synthetic evaluation of the selector.
 *
 * In a temporary git worktree of HEAD (the user's working tree is never
 * touched) it runs the full suite once on the unmutated tree, then for each
 * mutation commits the mutated tree, runs the selector against HEAD's diff to
 * that commit, runs the full suite again, and stores the selector's record
 * (`selector_runs.source = mutation`) and the tests the mutation killed
 * (failed on the mutated tree, passed on the base) as a mutation trial. The
 * worktree is removed afterwards. Calibration then scores mutation records
 * against their trial; their misses can only tighten the gate.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MetricStore } from "../../storage/types.js";
import type { TestCaseResult } from "../../adapters/types.js";
import type { SelectorConfig } from "../../config.js";
import { resolveTestIdentity } from "../../identity.js";
import { applyMutation, describeMutation, isMutableSourcePath, pickMutations, type Mutation } from "../../mutation/mutate.js";
import { runProjection } from "../../projections/index.js";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../selector/jev-record.js";
import { insertSelectorRecord } from "../../selector/store.js";
import { FlakerUsageError } from "../../errors.js";

export interface SelectorRunOutcome {
  /** The record the selector wrote for the mutated commit, or why there is none. */
  recordPath: string | null;
  error?: string;
}

export interface MutationDeps {
  /** Runs the whole suite in `cwd` and returns every test's result. */
  runSuite(cwd: string): Promise<TestCaseResult[]>;
  /** Runs the selector in `cwd` against `base` with the jev-context at `contextPath`. */
  runSelector(opts: { cwd: string; base: string; head: string; contextPath: string }): Promise<SelectorRunOutcome>;
}

export interface MutationTrialReport {
  mutation: string;
  file: string;
  line: number;
  kind: Mutation["kind"];
  commit_sha: string | null;
  selector_run_id: string | null;
  tests: number;
  killed: number;
  /** Why the trial stored nothing: no selector record, or the suite reported no tests. */
  skipped: string | null;
}

export interface MutationTrialsResult {
  base_sha: string;
  candidate_files: number;
  baseline: { tests: number; failures: number } | null;
  trials: MutationTrialReport[];
  dry_run: boolean;
}

function git(cwd: string, args: string[]): string {
  const res = spawnSync("git", ["-c", "user.name=flaker", "-c", "user.email=flaker@localhost", ...args], {
    cwd, encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout.trim();
}

/** Files changed in the last `commits` commits that still exist and may be mutated. */
export function recentlyChangedSources(cwd: string, commits: number): string[] {
  const out = git(cwd, ["log", `-${commits}`, "--name-only", "--pretty=format:", "HEAD"]);
  const files = [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
  return files.filter((f) => isMutableSourcePath(f) && existsSync(join(cwd, f))).sort();
}

const isFailure = (r: TestCaseResult) => r.status === "failed" || r.status === "flaky";
const testIdOf = (r: TestCaseResult) =>
  resolveTestIdentity({ suite: r.suite, testName: r.testName, taskId: r.taskId, filter: r.filter, variant: r.variant ?? null }).testId;

async function recordTrial(store: MetricStore, trial: {
  commitSha: string; baseSha: string; mutation: Mutation; tests: number; killed: string[]; createdAt: Date;
}): Promise<void> {
  const [{ id }] = await store.raw<{ id: bigint }>(`SELECT nextval('mutation_trials_id_seq')::BIGINT AS id`);
  await store.raw(`BEGIN TRANSACTION`);
  try {
    await store.raw(
      `INSERT INTO mutation_trials (run_id, commit_sha, base_sha, file, line, kind, original, replacement, tests, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, trial.commitSha, trial.baseSha, trial.mutation.file, trial.mutation.line, trial.mutation.kind,
        trial.mutation.original, trial.mutation.replacement, trial.tests, trial.createdAt],
    );
    for (const testId of trial.killed) {
      await store.raw(`INSERT INTO mutation_failures (run_id, test_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [id, testId]);
    }
    await store.raw(`COMMIT`);
  } catch (error) {
    await store.raw(`ROLLBACK`).catch(() => {});
    throw error;
  }
}

/** Stores the selector's record for a trial as a mutation record. */
async function importMutationRecord(store: MetricStore, path: string): Promise<string | null> {
  const record = jevRecordToSelectorRecord(parseJevRecord(JSON.parse(readFileSync(path, "utf8"))));
  if (record === null) return null;
  const { selectorRunId } = await insertSelectorRecord(store, { ...record, source: "mutation" });
  return selectorRunId;
}

export async function runMutationTrials(opts: {
  store: MetricStore;
  cwd: string;
  count: number;
  seed: number;
  commits: number;
  selector: SelectorConfig;
  deps: MutationDeps;
  /** Run once in the worktree before the baseline (e.g. a build). */
  setup?: string;
  dryRun?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
}): Promise<MutationTrialsResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const baseSha = git(opts.cwd, ["rev-parse", "HEAD"]);
  const files = recentlyChangedSources(opts.cwd, opts.commits);
  const mutations = pickMutations(
    files.map((path) => ({ path, content: readFileSync(join(opts.cwd, path), "utf8") })),
    opts.count,
    opts.seed,
  );
  const result: MutationTrialsResult = { base_sha: baseSha, candidate_files: files.length, baseline: null, trials: [], dry_run: opts.dryRun === true };
  if (mutations.length === 0) {
    throw new FlakerUsageError(
      `no mutation site in the source files changed by the last ${opts.commits} commits (${files.length} candidate files); raise --commits`,
    );
  }
  if (opts.dryRun) {
    result.trials = mutations.map((m) => ({
      mutation: describeMutation(m), file: m.file, line: m.line, kind: m.kind,
      commit_sha: null, selector_run_id: null, tests: 0, killed: 0, skipped: "dry run",
    }));
    return result;
  }

  const worktree = mkdtempSync(join(tmpdir(), "flaker-mutate-"));
  git(opts.cwd, ["worktree", "add", "--detach", "--quiet", worktree, baseSha]);
  try {
    // Dependencies are not in git: share the repository's installed ones.
    const modules = join(opts.cwd, "node_modules");
    if (existsSync(modules) && !existsSync(join(worktree, "node_modules"))) {
      symlinkSync(resolve(modules), join(worktree, "node_modules"), "dir");
    }
    if (opts.setup) {
      log(`setup: ${opts.setup}`);
      const setup = spawnSync(opts.setup, { cwd: worktree, shell: true, encoding: "utf8" });
      if (setup.status !== 0) throw new Error(`--setup failed (exit ${setup.status}): ${(setup.stderr || setup.stdout).trim().slice(0, 500)}`);
    }

    log("baseline: running the full suite on the unmutated tree");
    const baseline = await opts.deps.runSuite(worktree);
    if (baseline.length === 0) {
      throw new Error("the full suite reported no tests on the unmutated tree; check [runner] in flaker.toml or --setup");
    }
    const baselineFailed = new Set(baseline.filter(isFailure).map(testIdOf));
    result.baseline = { tests: baseline.length, failures: baselineFailed.size };

    const contextPath = join(worktree, ".flaker-mutate-context.json");
    const context = await runProjection("jev-context", opts.store, { selector: opts.selector });
    writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);

    for (const [index, mutation] of mutations.entries()) {
      const description = describeMutation(mutation);
      log(`trial ${index + 1}/${mutations.length}: ${description}`);
      const report: MutationTrialReport = {
        mutation: description, file: mutation.file, line: mutation.line, kind: mutation.kind,
        commit_sha: null, selector_run_id: null, tests: 0, killed: 0, skipped: null,
      };
      result.trials.push(report);
      try {
        const path = join(worktree, mutation.file);
        writeFileSync(path, applyMutation(readFileSync(path, "utf8"), mutation));
        git(worktree, ["commit", "--quiet", "--no-verify", "-am", `flaker mutation: ${description}`]);
        const head = git(worktree, ["rev-parse", "HEAD"]);
        report.commit_sha = head;

        const selected = await opts.deps.runSelector({ cwd: worktree, base: baseSha, head, contextPath });
        const recordId = selected.recordPath ? await importMutationRecord(opts.store, selected.recordPath) : null;
        if (recordId === null) {
          report.skipped = `no selector record${selected.error ? `: ${selected.error}` : " (the selector fell back)"}`;
          continue;
        }
        report.selector_run_id = recordId;

        const results = await opts.deps.runSuite(worktree);
        report.tests = results.length;
        if (results.length === 0) {
          report.skipped = "the suite reported no tests on the mutated tree";
          continue;
        }
        const killed = [...new Set(results.filter(isFailure).map(testIdOf))].filter((id) => !baselineFailed.has(id)).sort();
        report.killed = killed.length;
        await recordTrial(opts.store, { commitSha: head, baseSha, mutation, tests: results.length, killed, createdAt: now() });
      } catch (error) {
        report.skipped = `failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        git(worktree, ["reset", "--quiet", "--hard", baseSha]);
      }
    }
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: opts.cwd });
    rmSync(worktree, { recursive: true, force: true });
    spawnSync("git", ["worktree", "prune"], { cwd: opts.cwd });
  }
  return result;
}

/** The selector as a command: jev-test-filter from the repository's node_modules/.bin, or PATH. */
export function jevSelector(command = "jev-test-filter"): MutationDeps["runSelector"] {
  return ({ cwd, base, head, contextPath }) => new Promise((done) => {
    const bin = join(cwd, "node_modules", ".bin");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
    const child = spawn(command, ["--base", base, "--context", contextPath, "--json"], { cwd, env, shell: false });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (error) => done({ recordPath: null, error: error.message }));
    child.on("close", (status) => {
      const recordPath = join(cwd, ".jev-test-filter", "records", `${head}.json`);
      if (status !== 0) done({ recordPath: null, error: `exit ${status}: ${stderr.trim().split("\n").slice(-2).join(" ")}` });
      else if (!existsSync(recordPath) || !lstatSync(recordPath).isFile()) done({ recordPath: null, error: stderr.trim().split("\n").pop() });
      else done({ recordPath });
    });
  });
}
