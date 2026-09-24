// tests/integration-test-db.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRecord, replay } from "jev-test-filter";
import { gateOptions } from "jev-test-filter/gate";
import type { MetricStore } from "../src/cli/storage/types.js";
import type { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR, loadConfig } from "../src/cli/config.js";
import { openDatasetStore } from "../src/cli/datasets/open.js";
import { runImport } from "../src/cli/commands/import/report.js";
import { runImportSelector, type ImportSelectorResult } from "../src/cli/commands/import/selector.js";
import { runSelectorCalibration } from "../src/cli/commands/calibrate/selector.js";
import { runProjection } from "../src/cli/projections/index.js";
import type { JevContextV1 } from "../src/cli/contracts/jev-context-v1.js";
import { JEV_CONTEXT_V1_SCHEMA } from "../src/cli/contracts/jev-context-v1.js";
import { validator } from "./contracts/ajv.js";
import { memoryStore } from "./datasets/helpers.js";

const REPORT = resolve(import.meta.dirname, "fixtures/vitest-init-report.json");
const HEAD = "c0ffee0000000000000000000000000000000002";
const FLAKER_CLI = resolve(import.meta.dirname, "../dist/cli/main.js");
const JEV_CLI = resolve(import.meta.dirname, "../node_modules/jev-test-filter/dist/cli.js");

/**
 * Two full CI runs (an earlier commit and HEAD) where config.ts changed and
 * `init writes toml` failed, and a jev record on HEAD that left the failing
 * test out. Returns the record's path and the selector import result.
 */
async function seedLoop(store: MetricStore, dir: string): Promise<{ recordPath: string; imported: ImportSelectorResult }> {
  for (const sha of ["b0000000000000000000000000000000000000001", HEAD]) {
    await store.insertCommitChanges(sha, [{ filePath: "src/cli/config.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await runImport({ store, filePath: REPORT, adapterType: "vitest", commitSha: sha, branch: "main", source: "ci", workflowName: "ci" });
    // runImport uses Date.now() as the run id; keep the two runs distinct.
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
  const recordPath = join(dir, `${HEAD}.json`);
  writeFileSync(recordPath, JSON.stringify(record));
  const imported = await runImportSelector({ store, path: recordPath, adapter: "jev" });
  return { recordPath, imported };
}

/** The environment without GIT_*: a pre-push hook exports GIT_DIR, which would point git at this repository. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}

describe("test-db loop", () => {
  let store: DuckDBStore;
  let dir: string;
  beforeEach(async () => {
    store = await memoryStore();
    dir = mkdtempSync(join(tmpdir(), "flaker-loop-"));
  });
  afterEach(async () => {
    await store.close();
  });

  it("a miss tightens the gate, the context carries it, and jev's replay then selects the test", async () => {
    const { recordPath, imported } = await seedLoop(store, dir);
    expect(imported).toMatchObject({ imported: 1, resolved: 2, unresolved: 0 });

    const misses = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.misses`);
    expect(misses[0].n).toBe(1);

    const cal = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
    expect(cal.decision.decision).toBe("tighten");
    expect(cal.decision.gate.cutoff).toBe(1);

    const ctx = (await runProjection("jev-context", store, { selector: DEFAULT_SELECTOR })) as JevContextV1;
    expect(validator(JEV_CONTEXT_V1_SCHEMA)(ctx)).toBeNull();
    expect(ctx.gate).toMatchObject({ cutoff: 1, basis: { records: 1, real_failures: 1 } });
    expect(ctx.tests).toEqual([
      { file: "tests/init.test.ts", title_path: ["init", "writes toml"], failed_with: ["src/cli/config.ts"], missed: 1 },
    ]);

    // jev, given the context's gate, now selects the test it missed.
    const again = replay(await loadRecord(recordPath), gateOptions(ctx.gate));
    expect(again.verdicts.find((v) => v.test.titlePath[1] === "writes toml")?.selected).toBe(true);
  });
});

describe("jev-test-filter's own CLI reads the exported context", () => {
  it("accepts `flaker export --projection jev-context` output and rejects a tampered version", async () => {
    const project = mkdtempSync(join(tmpdir(), "flaker-jev-cli-"));
    writeFileSync(
      join(project, "flaker.toml"),
      `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
    );
    // The duckdb binding keeps a closed database's file lock until the
    // instance is garbage-collected, so a child process could not open it.
    // Seed a scratch database, checkpoint it, and copy it into place.
    const scratch = mkdtempSync(join(tmpdir(), "flaker-jev-seed-"));
    writeFileSync(join(scratch, "flaker.toml"), readFileSync(join(project, "flaker.toml"), "utf8"));
    const store = await openDatasetStore(scratch, loadConfig(scratch));
    try {
      await seedLoop(store, scratch);
      await store.addQuarantine({ suite: "tests/init.test.ts", testName: "init reads toml" }, "manual");
      await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
      await store.raw("CHECKPOINT");
    } finally {
      await store.close();
    }
    mkdirSync(join(project, ".flaker"));
    copyFileSync(join(scratch, ".flaker/data"), join(project, ".flaker/data"));
    expect(existsSync(join(scratch, ".flaker/data.wal"))).toBe(false);

    const env = scrubbedEnv();
    const exported = spawnSync("node", [FLAKER_CLI, "export", "--projection", "jev-context", "-o", "context.json"], { cwd: project, env, encoding: "utf8" });
    expect(exported.status, exported.stderr).toBe(0);
    const contextPath = join(project, "context.json");
    const ctx = JSON.parse(readFileSync(contextPath, "utf8")) as JevContextV1;
    expect(ctx.skip.length).toBeGreaterThan(0);
    expect(ctx.tests.length).toBeGreaterThan(0);

    // A git repository holding a test file, for jev to extract from.
    const repo = mkdtempSync(join(tmpdir(), "flaker-jev-repo-"));
    mkdirSync(join(repo, "tests"));
    writeFileSync(join(repo, "tests/init.test.ts"), `import { it } from "vitest";\nit("writes toml", () => {});\n`);
    const git = (...args: string[]) => {
      const res = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: repo, env, encoding: "utf8" });
      expect(res.status, res.stderr).toBe(0);
    };
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");

    const jev = (path: string) => spawnSync("node", [JEV_CLI, "--dry-run", "--context", path], { cwd: repo, env, encoding: "utf8" });
    const ok = jev(contextPath);
    expect(ok.status, ok.stderr).toBe(0);

    const tamperedPath = join(project, "context-v2.json");
    writeFileSync(tamperedPath, JSON.stringify({ ...ctx, version: 2 }));
    const bad = jev(tamperedPath);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/unsupported context version 2; expected 1/);
  });
});
