import { describe, it, expect } from "vitest";
import {
  computeVerdict,
  formatConfirmResult,
  parseConfirmTarget,
  type ConfirmResult,
} from "../../src/cli/commands/debug/confirm.js";

describe("parseConfirmTarget", () => {
  it("splits suite:testName", () => {
    const result = parseConfirmTarget("tests/api.test.ts:handles timeout");
    expect(result).toEqual({ suite: "tests/api.test.ts", testName: "handles timeout" });
  });

  it("handles colons in test name", () => {
    const result = parseConfirmTarget("tests/api.test.ts:handles timeout: edge case");
    expect(result).toEqual({ suite: "tests/api.test.ts", testName: "handles timeout: edge case" });
  });

  it("throws on missing colon", () => {
    expect(() => parseConfirmTarget("tests/api.test.ts")).toThrow();
  });
});

describe("computeVerdict", () => {
  it("returns broken when all fail", () => {
    expect(computeVerdict(5, 5)).toEqual({
      verdict: "broken",
      message: "Consistently failing. This is a regression.",
    });
  });

  it("returns transient when none fail", () => {
    expect(computeVerdict(5, 0)).toEqual({
      verdict: "transient",
      message: "Could not reproduce. Failure was transient.",
    });
  });

  it("returns flaky with rate when some fail", () => {
    const result = computeVerdict(5, 3);
    expect(result.verdict).toBe("flaky");
    expect(result.message).toContain("60");
  });
});

describe("formatConfirmResult", () => {
  it("formats broken result", () => {
    const result: ConfirmResult = {
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      runner: "remote",
      repeat: 5,
      failures: 5,
      verdict: "broken",
      message: "Consistently failing. This is a regression.",
    };
    const output = formatConfirmResult(result);
    expect(output).toContain("tests/api.test.ts");
    expect(output).toContain("handles timeout");
    expect(output).toContain("BROKEN");
    expect(output).toContain("5/5 failed");
  });

  it("formats flaky result with quarantine suggestion", () => {
    const result: ConfirmResult = {
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      runner: "local",
      repeat: 5,
      failures: 3,
      verdict: "flaky",
      message: "Intermittent failure. Flaky rate: 60%.",
    };
    const output = formatConfirmResult(result);
    expect(output).toContain("FLAKY");
    expect(output).toContain("quarantine");
  });

  it("formats transient result", () => {
    const result: ConfirmResult = {
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      runner: "local",
      repeat: 5,
      failures: 0,
      verdict: "transient",
      message: "Could not reproduce. Failure was transient.",
    };
    const output = formatConfirmResult(result);
    expect(output).toContain("TRANSIENT");
  });
});
