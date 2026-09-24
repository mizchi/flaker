import { describe, expect, it } from "vitest";
import { normalizeWorkflowLanes } from "../../src/cli/config.js";
import { FlakerUsageError } from "../../src/cli/errors.js";

describe("normalizeWorkflowLanes", () => {
  it("keeps the string form as it is", () => {
    expect(normalizeWorkflowLanes({ "ci.yml": "sampled" })).toEqual({
      lanes: { "ci.yml": "sampled" },
      fullByLane: {},
    });
  });

  it("reads { lane, full } and records full per lane", () => {
    expect(normalizeWorkflowLanes({
      "nightly.yml": { lane: "full-batch", full: true },
      "pr.yml": { lane: "sampled", full: false },
      "e2e.yml": { lane: "e2e" },
    })).toEqual({
      lanes: { "nightly.yml": "full-batch", "pr.yml": "sampled", "e2e.yml": "e2e" },
      fullByLane: { "full-batch": true, sampled: false },
    });
  });

  it("is empty for a missing section", () => {
    expect(normalizeWorkflowLanes(undefined)).toEqual({ lanes: {}, fullByLane: {} });
  });

  it("rejects a table without a lane, a non-boolean full, and conflicting full values", () => {
    expect(() => normalizeWorkflowLanes({ x: { full: true } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({ x: { lane: "a", full: "yes" } as never })).toThrow(FlakerUsageError);
    expect(() => normalizeWorkflowLanes({
      x: { lane: "a", full: true },
      y: { lane: "a", full: false },
    })).toThrow(/conflicting full/);
  });
});
