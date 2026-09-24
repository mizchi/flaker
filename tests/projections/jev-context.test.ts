// tests/projections/jev-context.test.ts
import { describe, expect, it } from "vitest";
import { buildJevContext, type JevContextInput } from "../../src/cli/projections/jev-context.js";
import { JEV_CONTEXT_V1_SCHEMA } from "../../src/cli/contracts/jev-context-v1.js";
import { validator } from "../contracts/ajv.js";

const t = (key: string, file: string, title_path: string[], project?: string) => ({
  test_key: key, file, title_path, variant: project ? { project } : null,
});

function input(over: Partial<JevContextInput> = {}): JevContextInput {
  return {
    tests: [
      t("init", "tests/cli/init.test.ts", ["init", "writes toml"]),
      t("login", "e2e/login.spec.ts", ["login", "shows form"], "chromium"),
      t("flaky", "tests/f.test.ts", ["f"]),
      t("q", "tests/a.test.ts", ["A", "b"]),
    ],
    quarantine: [{ test_key: "q" }],
    flaky: [{ test_key: "flaky", is_flaky: true }, { test_key: "init", is_flaky: false }],
    misses: [{ test_key: "init", selector_run_id: "s1", head_sha: "h1" }, { test_key: "init", selector_run_id: "s2", head_sha: "h2" }],
    co_failures: [
      ...["a", "b", "c", "d", "e", "f"].map((f, i) => ({ changed_file: `src/${f}.ts`, test_key: "init", co_failures: 2 + i, strength: 0.5 })),
      { changed_file: "src/cli/config.ts", test_key: "init", co_failures: 3, strength: 0.9 },
      { changed_file: "src/one-off.ts", test_key: "login", co_failures: 1, strength: 1 },
      { changed_file: "src/auth.ts", test_key: "login", co_failures: 2, strength: 0.4 },
      { changed_file: "src/x.ts", test_key: "flaky", co_failures: 9, strength: 1 },
      { changed_file: "src/x.ts", test_key: "q", co_failures: 9, strength: 1 },
    ],
    gate: { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1, records: 42, real_failures: 17, recall_lb95: 0.83 },
    generatedAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

describe("buildJevContext", () => {
  it("builds skip from quarantine and hints from misses and co_failures", () => {
    const ctx = buildJevContext(input());
    expect(ctx.version).toBe(1);
    expect(ctx.gate).toEqual({ cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1, basis: { records: 42, real_failures: 17, recall_lb95: 0.83 } });
    expect(ctx.skip).toEqual([{ file: "tests/a.test.ts", title_path: ["A", "b"], reason: "quarantined" }]);
    expect(ctx.tests).toEqual([
      {
        file: "tests/cli/init.test.ts", title_path: ["init", "writes toml"], missed: 2,
        failed_with: ["src/cli/config.ts", "src/f.ts", "src/e.ts", "src/d.ts", "src/c.ts"],
      },
      { file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "chromium", failed_with: ["src/auth.ts"] },
    ]);
    expect(validator(JEV_CONTEXT_V1_SCHEMA)(ctx)).toBeNull();
  });

  it("caps hinted tests, keeping the most missed first", () => {
    const ctx = buildJevContext(input({ limits: { maxHintedTests: 1 } }));
    expect(ctx.tests.map((x) => x.file)).toEqual(["tests/cli/init.test.ts"]);
  });

  it("gate is null without a calibration", () => {
    expect(buildJevContext(input({ gate: null })).gate).toBeNull();
  });

  it("digest covers skip and tests only, and ignores input row order", () => {
    const a = buildJevContext(input());
    const b = buildJevContext(input({
      co_failures: [...input().co_failures].reverse(),
      misses: [...input().misses].reverse(),
      gate: null,
      generatedAt: "2030-01-01T00:00:00.000Z",
    }));
    expect(b.digest).toBe(a.digest);
    expect(a.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const c = buildJevContext(input({ quarantine: [] }));
    expect(c.digest).not.toBe(a.digest);
  });

  it("counts misses per head, not per selector run", () => {
    const ctx = buildJevContext(input({
      misses: [{ test_key: "init", selector_run_id: "s1", head_sha: "h1" }, { test_key: "init", selector_run_id: "s2", head_sha: "h1" }],
    }));
    expect(ctx.tests.find((x) => x.file === "tests/cli/init.test.ts")?.missed).toBe(1);
  });

  it("merges test_keys that share a name before ranking, whatever the row order", () => {
    const variants = [
      { test_key: "v1", file: "tests/v.test.ts", title_path: ["v"], variant: { shard: "1" } },
      { test_key: "v2", file: "tests/v.test.ts", title_path: ["v"], variant: { shard: "2" } },
    ];
    const over = {
      misses: [{ test_key: "v1", selector_run_id: "s1", head_sha: "h1" }, { test_key: "v2", selector_run_id: "s2", head_sha: "h2" }],
      co_failures: [
        { changed_file: "src/v.ts", test_key: "v1", co_failures: 2, strength: 0.4 },
        { changed_file: "src/v.ts", test_key: "v2", co_failures: 3, strength: 0.8 },
        { changed_file: "src/w.ts", test_key: "v2", co_failures: 2, strength: 0.5 },
      ],
    };
    const a = buildJevContext(input({ ...over, tests: [...input().tests, ...variants] }));
    const b = buildJevContext(input({
      misses: [...over.misses].reverse(), co_failures: [...over.co_failures].reverse(),
      tests: [...variants].reverse().concat(input().tests),
    }));
    const entries = a.tests.filter((x) => x.file === "tests/v.test.ts");
    expect(entries).toEqual([{ file: "tests/v.test.ts", title_path: ["v"], missed: 2, failed_with: ["src/v.ts", "src/w.ts"] }]);
    expect(b.digest).toBe(a.digest);
    expect(b.tests).toEqual(a.tests);
  });

  it("a merged name counts the commits it was missed on: two variants missing on one commit give 1", () => {
    const variants = [
      { test_key: "v1", file: "tests/v.test.ts", title_path: ["v"], variant: { shard: "1" } },
      { test_key: "v2", file: "tests/v.test.ts", title_path: ["v"], variant: { shard: "2" } },
    ];
    const sameCommit = buildJevContext(input({
      tests: [...input().tests, ...variants],
      misses: [{ test_key: "v1", selector_run_id: "s1", head_sha: "h1" }, { test_key: "v2", selector_run_id: "s1", head_sha: "h1" }],
    }));
    expect(sameCommit.tests.find((x) => x.file === "tests/v.test.ts")?.missed).toBe(1);
    const twoCommits = buildJevContext(input({
      tests: [...input().tests, ...variants],
      misses: [{ test_key: "v1", selector_run_id: "s1", head_sha: "h1" }, { test_key: "v2", selector_run_id: "s2", head_sha: "h2" }],
    }));
    expect(twoCommits.tests.find((x) => x.file === "tests/v.test.ts")?.missed).toBe(2);
  });
});
