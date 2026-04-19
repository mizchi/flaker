import { describe, expect, it } from "vitest";
import { renderDetail } from "../../src/cli/commands/status/summary.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

describe("status --detail rendering", () => {
  it("shows actual/threshold ratio for unmet rows", () => {
    const drift = {
      ok: false,
      unmet: [
        { field: "matched_commits", actual: 18, threshold: 20 },
        { field: "data_confidence", actual: "low", threshold: "moderate" },
      ],
    };
    const text = renderDetail(drift, DEFAULT_PROMOTION);
    expect(text).toMatch(/matched_commits:\s*18\s*\/\s*20/);
    expect(text).toMatch(/data_confidence:\s*low\s*(→|->|\/)\s*moderate/);
  });
});
