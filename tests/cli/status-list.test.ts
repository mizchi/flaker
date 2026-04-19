import { describe, expect, it, vi } from "vitest";
import { renderListFlaky, renderListQuarantined } from "../../src/cli/commands/status/summary.js";

describe("status --list rendering", () => {
  it("formats flaky rows", () => {
    const rows = [
      { suite: "tests/a.test.ts", test_name: "reconnect", flaky_rate: 0.18, runs: 40 },
      { suite: "tests/b.test.ts", test_name: "retry",     flaky_rate: 0.12, runs: 35 },
    ];
    const out = renderListFlaky(rows as any);
    expect(out).toMatch(/reconnect/);
    expect(out).toMatch(/18%|0\.18/);
  });

  it("formats quarantined rows", () => {
    const rows = [
      { suite: "tests/a.test.ts", test_name: "flake1", added_at: "2026-04-01" },
      { suite: "tests/b.test.ts", test_name: "flake2", added_at: "2026-04-05" },
    ];
    const out = renderListQuarantined(rows as any);
    expect(out).toMatch(/flake1/);
    expect(out).toMatch(/flake2/);
  });
});
