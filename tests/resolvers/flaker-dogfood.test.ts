import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createResolver } from "../../src/cli/resolvers/index.js";

describe("flaker dogfood affected rules", () => {
  const cwd = process.cwd();
  const resolver = createResolver(
    {
      resolver: "glob",
      config: resolve(cwd, "flaker.affected.toml"),
    },
    cwd,
  );

  it("maps command changes to command tests", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/eval.ts"],
      [
        "tests/commands/eval.test.ts",
        "tests/commands/context.test.ts",
        "tests/commands/calibrate.test.ts",
        "tests/package/dev-cli.test.ts",
        "tests/commands/collect.test.ts",
        "tests/commands/report.test.ts",
      ],
    );

    expect(selected).toEqual([
      "tests/commands/eval.test.ts",
      "tests/commands/context.test.ts",
      "tests/commands/calibrate.test.ts",
    ]);
  });

  it("maps adapter changes to adapter tests", () => {
    const selected = resolver.resolve(
      ["src/cli/adapters/vitest.ts"],
      [
        "tests/adapters/vitest.test.ts",
        "tests/commands/eval.test.ts",
      ],
    );

    expect(selected).toEqual(["tests/adapters/vitest.test.ts"]);
  });

  it("maps packaging scripts to package smoke tests", () => {
    const selected = resolver.resolve(
      ["scripts/dev-cli.mjs"],
      [
        "tests/package/dev-cli.test.ts",
        "tests/commands/eval.test.ts",
      ],
    );

    expect(selected).toEqual(["tests/package/dev-cli.test.ts"]);
  });

  it("maps collect changes to collection tests without pulling reporting", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/collect.ts"],
      [
        "tests/commands/collect.test.ts",
        "tests/commands/import.test.ts",
        "tests/commands/report.test.ts",
        "tests/commands/eval.test.ts",
      ],
    );

    expect(selected).toEqual([
      "tests/commands/collect.test.ts",
      "tests/commands/import.test.ts",
    ]);
  });

  it("maps report changes to reporting tests without pulling collection", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/report.ts"],
      [
        "tests/commands/report.test.ts",
        "tests/reporting/playwright-report-summary.test.ts",
        "tests/commands/collect.test.ts",
      ],
    );

    expect(selected).toEqual([
      "tests/commands/report.test.ts",
      "tests/reporting/playwright-report-summary.test.ts",
    ]);
  });

  it("maps check changes to config check tests without pulling eval", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/check.ts"],
      [
        "tests/commands/check.test.ts",
        "tests/commands/eval.test.ts",
        "tests/commands/report.test.ts",
      ],
    );

    expect(selected).toEqual([
      "tests/commands/check.test.ts",
    ]);
  });

  it("maps coverage collection changes to coverage command tests", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/collect-coverage.ts"],
      [
        "tests/commands/collect-coverage.test.ts",
        "tests/commands/report.test.ts",
        "tests/adapters/coverage.test.ts",
      ],
    );

    expect(selected).toEqual([
      "tests/commands/collect-coverage.test.ts",
      "tests/adapters/coverage.test.ts",
    ]);
  });

  it("has no rule for the train command removed in 0.13.0", () => {
    const selected = resolver.resolve(
      ["src/cli/commands/train.ts"],
      [
        "tests/commands/train.test.ts",
        "tests/eval/gbdt.test.ts",
      ],
    );

    expect(selected).toEqual([]);
  });
});
