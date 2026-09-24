// tests/integration-test-db.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRecord, replay } from "jev-test-filter";
import { gateOptions } from "jev-test-filter/gate";
import type { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../src/cli/config.js";
import { runImport } from "../src/cli/commands/import/report.js";
import { runImportSelector } from "../src/cli/commands/import/selector.js";
import { runSelectorCalibration } from "../src/cli/commands/calibrate/selector.js";
import { runProjection } from "../src/cli/projections/index.js";
import type { JevContextV1 } from "../src/cli/contracts/jev-context-v1.js";
import { JEV_CONTEXT_V1_SCHEMA } from "../src/cli/contracts/jev-context-v1.js";
import { validator } from "./contracts/ajv.js";
import { memoryStore } from "./datasets/helpers.js";

const REPORT = resolve(import.meta.dirname, "fixtures/vitest-init-report.json");
const HEAD = "c0ffee0000000000000000000000000000000002";

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
    // Two full CI runs (earlier commit and HEAD) where config.ts changed and `init writes toml` failed.
    for (const sha of ["b0000000000000000000000000000000000000001", HEAD]) {
      await store.insertCommitChanges(sha, [{ filePath: "src/cli/config.ts", changeType: "modified", additions: 1, deletions: 0 }]);
      await runImport({ store, filePath: REPORT, adapterType: "vitest", commitSha: sha, branch: "main", source: "ci", workflowName: "ci" });
      // runImport uses Date.now() as the run id; keep the two runs distinct.
      await new Promise((r) => setTimeout(r, 5));
    }
    // jev judged HEAD and left the failing test out.
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
