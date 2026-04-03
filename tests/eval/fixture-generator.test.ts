import { describe, it, expect } from "vitest";
import { generateFixture, type FixtureConfig } from "../../src/cli/eval/fixture-generator.js";

const defaultConfig: FixtureConfig = {
  testCount: 20,
  commitCount: 10,
  flakyRate: 0.1,
  coFailureStrength: 0.8,
  filesPerCommit: 2,
  testsPerFile: 4,
  samplePercentage: 20,
  seed: 42,
};

describe("generateFixture", () => {
  it("generates correct number of tests and commits", () => {
    const fixture = generateFixture(defaultConfig);
    expect(fixture.tests.length).toBe(20);
    expect(fixture.commits.length).toBe(10);
  });

  it("generates file-to-test dependency map", () => {
    const fixture = generateFixture(defaultConfig);
    expect(fixture.fileDeps.size).toBeGreaterThan(0);
    for (const [, tests] of fixture.fileDeps) {
      expect(tests.length).toBe(4);
    }
  });

  it("marks correct number of flaky tests", () => {
    const fixture = generateFixture(defaultConfig);
    const flakyCount = fixture.tests.filter((t) => t.isFlaky).length;
    expect(flakyCount).toBe(2); // 20 * 0.1 = 2
  });

  it("generates commit changes and test results", () => {
    const fixture = generateFixture(defaultConfig);
    for (const commit of fixture.commits) {
      expect(commit.changedFiles.length).toBe(2);
      expect(commit.testResults.length).toBe(20);
    }
  });

  it("is deterministic with same seed", () => {
    const a = generateFixture(defaultConfig);
    const b = generateFixture(defaultConfig);
    expect(a.commits.map((c) => c.sha)).toEqual(b.commits.map((c) => c.sha));
    expect(a.commits.map((c) => c.testResults.map((r) => r.status))).toEqual(
      b.commits.map((c) => c.testResults.map((r) => r.status)),
    );
  });

  it("co-failure strength controls failure correlation", () => {
    const strong = generateFixture({ ...defaultConfig, coFailureStrength: 1.0, commitCount: 50 });
    const none = generateFixture({ ...defaultConfig, coFailureStrength: 0.0, commitCount: 50 });

    const strongFailures = strong.commits.flatMap((c) => c.testResults.filter((r) => r.status === "failed"));
    const noneFailures = none.commits.flatMap((c) => c.testResults.filter((r) => r.status === "failed"));

    expect(strongFailures.length).toBeGreaterThan(noneFailures.length);
  });
});
