import { describe, expect, it } from "vitest";
import { buildTestIndex, matchTestKey, type KnownTest } from "../../src/cli/datasets/test-match.js";

const known: KnownTest[] = [
  { test_key: "k-vitest-new", file: "tests/a.test.ts", title_path: ["A", "works"], test_name: "A works", task_id: "tests/a.test.ts", project: null },
  { test_key: "k-vitest-legacy", file: "tests/b.test.ts", title_path: ["B works"], test_name: "B works", task_id: "tests/b.test.ts", project: null },
  { test_key: "k-pw-chromium", file: "e2e/login.spec.ts", title_path: ["login", "shows form"], test_name: "shows form", task_id: "login", project: "chromium" },
  { test_key: "k-pw-firefox", file: "e2e/login.spec.ts", title_path: ["login", "shows form"], test_name: "shows form", task_id: "login", project: "firefox" },
  { test_key: "k-pw-legacy", file: "e2e/old.spec.ts", title_path: ["redirects"], test_name: "redirects", task_id: "old flow", project: "chromium" },
  { test_key: "k-dup-1", file: "tests/dup.test.ts", title_path: ["same"], test_name: "same", task_id: "x", project: null },
  { test_key: "k-dup-2", file: "tests/dup.test.ts", title_path: ["same"], test_name: "same", task_id: "y", project: null },
];
const index = buildTestIndex(known);

describe("matchTestKey", () => {
  it("tier 1: equal title_path in the same file and project", () => {
    expect(matchTestKey(index, { file: "tests/a.test.ts", title_path: ["A", "works"] })).toBe("k-vitest-new");
    expect(matchTestKey(index, { file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "firefox" })).toBe("k-pw-firefox");
  });

  it("tier 2: a legacy vitest row whose test_name is the joined path", () => {
    expect(matchTestKey(index, { file: "tests/b.test.ts", title_path: ["B", "works"] })).toBe("k-vitest-legacy");
  });

  it("tier 3: a legacy playwright row, leaf title plus parent as task_id", () => {
    expect(matchTestKey(index, { file: "e2e/old.spec.ts", title_path: ["old flow", "redirects"], project: "chromium" })).toBe("k-pw-legacy");
  });

  it("matches on runner_file when file differs, and strips a leading ./", () => {
    expect(matchTestKey(index, { file: "packages/app/e2e/login.spec.ts", runner_file: "e2e/login.spec.ts", title_path: ["login", "shows form"], project: "chromium" })).toBe("k-pw-chromium");
    expect(matchTestKey(index, { file: "./tests/a.test.ts", title_path: ["A", "works"] })).toBe("k-vitest-new");
  });

  it("treats an empty project as none", () => {
    expect(matchTestKey(index, { file: "tests/a.test.ts", title_path: ["A", "works"], project: "" })).toBe("k-vitest-new");
  });

  it("never falls back to tiers 2 and 3 for a row that has a real title path", () => {
    const strict = buildTestIndex([
      { test_key: "k-a", file: "a.spec.ts", title_path: ["suite", "redirects"], test_name: "redirects", task_id: "suite", project: null },
      { test_key: "k-b", file: "b.test.ts", title_path: ["A", "works"], test_name: "A works", task_id: "b.test.ts", project: null },
      { test_key: "k-c", file: "c.spec.ts", title_path: ["outer", "inner", "leaf"], test_name: "leaf", task_id: "inner", project: null },
    ]);
    expect(matchTestKey(strict, { file: "a.spec.ts", title_path: ["redirects"] })).toBeNull();
    expect(matchTestKey(strict, { file: "b.test.ts", title_path: ["A works"] })).toBeNull();
    expect(matchTestKey(strict, { file: "c.spec.ts", title_path: ["OTHER", "inner", "leaf"] })).toBeNull();
  });

  it("treats an empty title path as a legacy row", () => {
    const legacy = buildTestIndex([
      { test_key: "k-e", file: "e.test.ts", title_path: [], test_name: "E works", task_id: "e.test.ts", project: null },
    ]);
    expect(matchTestKey(legacy, { file: "e.test.ts", title_path: ["E", "works"] })).toBe("k-e");
  });

  it("returns null when ambiguous or unknown", () => {
    expect(matchTestKey(index, { file: "tests/dup.test.ts", title_path: ["same"] })).toBeNull();
    expect(matchTestKey(index, { file: "e2e/login.spec.ts", title_path: ["login", "shows form"] })).toBeNull();
    expect(matchTestKey(index, { file: "tests/none.test.ts", title_path: ["x"] })).toBeNull();
  });
});
