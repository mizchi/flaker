import { describe, it, expect } from "vitest";
import { SimpleResolver } from "../../src/cli/resolvers/simple.js";

describe("SimpleResolver", () => {
  it("maps changed source files to matching test files by directory", () => {
    const resolver = new SimpleResolver();
    const changed = ["src/auth/login.ts"];
    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
      "tests/payments/checkout.spec.ts",
    ];
    const result = resolver.resolve(changed, allTests);
    expect(result).toEqual([
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
    ]);
  });

  it("returns empty array when no matches", () => {
    const resolver = new SimpleResolver();
    const changed = ["src/payments/checkout.ts"];
    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
    ];
    const result = resolver.resolve(changed, allTests);
    expect(result).toEqual([]);
  });

  it("matches by directory prefix", () => {
    const resolver = new SimpleResolver();
    const changed = ["src/auth/oauth/google.ts"];
    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/oauth/google.spec.ts",
      "tests/auth/oauth/github.spec.ts",
      "tests/core/utils.spec.ts",
    ];
    const result = resolver.resolve(changed, allTests);
    // "auth/oauth" prefix matches tests/auth/oauth/* but also tests/auth/* since auth/oauth starts with auth
    // Actually, let's clarify: we match by directory prefix of the changed file's directory
    // "auth/oauth" is the dir for google.ts, so tests under "tests/auth/oauth/" match
    expect(result).toContain("tests/auth/oauth/google.spec.ts");
    expect(result).toContain("tests/auth/oauth/github.spec.ts");
    expect(result).not.toContain("tests/core/utils.spec.ts");
  });

  it("explains direct matches and unmatched paths", async () => {
    const resolver = new SimpleResolver();
    const report = await resolver.explain?.(
      ["src/auth/login.ts", "docs/notes.md"],
      [
        {
          spec: "tests/auth/login.spec.ts",
          taskId: "auth-login",
          filter: null,
        },
        {
          spec: "tests/auth/register.spec.ts",
          taskId: "auth-register",
          filter: null,
        },
      ],
    );

    expect(report?.matched.map((entry) => entry.taskId)).toEqual([
      "auth-login",
      "auth-register",
    ]);
    expect(report?.selected.every((entry) => entry.direct)).toBe(true);
    expect(report?.unmatched).toEqual(["docs/notes.md"]);
  });
});
