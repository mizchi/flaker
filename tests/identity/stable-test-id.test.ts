import { describe, expect, it } from "vitest";
import {
  createStableTestId,
  resolveTestIdentity,
} from "../../src/cli/identity.js";

describe("stable test identity", () => {
  it("normalizes variant key order", () => {
    const a = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      variant: { browser: "chromium", os: "linux" },
    });
    const b = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      variant: { os: "linux", browser: "chromium" },
    });

    expect(a).toBe(b);
  });

  it("treats filter as part of the identity", () => {
    const smoke = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      filter: "@smoke",
    });
    const regression = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      filter: "@regression",
    });

    expect(smoke).not.toBe(regression);
  });

  it("defaults taskId to suite and fills normalized fields", () => {
    const resolved = resolveTestIdentity({
      suite: "tests/login.spec.ts",
      testName: "should login",
    });

    expect(resolved.taskId).toBe("tests/login.spec.ts");
    expect(resolved.filter).toBeNull();
    expect(resolved.variant).toBeNull();
    expect(resolved.testId).toBe(
      createStableTestId({
        suite: "tests/login.spec.ts",
        testName: "should login",
      }),
    );
  });
});
