import { describe, expect, it } from "vitest";
import { renderDetail } from "../../src/cli/commands/status/summary.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

describe("status --detail rendering", () => {
  it("shows actual/threshold ratio for unmet rows", () => {
    const drift = {
      ok: false,
      unmet: [
        { kind: "matched_commits" as const, actual: 18, desired: 20 },
        { kind: "data_confidence" as const, actual: "low" as const, desired: "moderate" as const },
      ],
    };
    const text = renderDetail(drift, DEFAULT_PROMOTION);
    expect(text).toMatch(/matched_commits:\s*18\s*\/\s*20/);
    expect(text).toMatch(/data_confidence:\s*low\s*(→|->|\/)\s*moderate/);
  });
});
