import { describe, expect, it } from "vitest";
import { probeRepo } from "../../src/cli/commands/apply/probe.js";
import type { MetricStore } from "../../src/cli/storage/types.js";

function makeFakeStore(hasLocal: boolean): MetricStore {
  return {
    raw: async <T>(_sql: string): Promise<T[]> => [{ has_local: hasLocal ? 1 : 0 } as unknown as T],
    // stub only what's needed; the other methods aren't called by probeRepo
  } as unknown as MetricStore;
}

describe("probeRepo", () => {
  it("hasLocalHistory=false when workflow_runs has no local source", async () => {
    const probe = await probeRepo({ cwd: process.cwd(), store: makeFakeStore(false) });
    expect(probe.hasLocalHistory).toBe(false);
  });

  it("hasLocalHistory=true when workflow_runs has at least one local row", async () => {
    const probe = await probeRepo({ cwd: process.cwd(), store: makeFakeStore(true) });
    expect(probe.hasLocalHistory).toBe(true);
  });

  it("reflects GITHUB_TOKEN presence", async () => {
    const original = process.env.GITHUB_TOKEN;
    try {
      process.env.GITHUB_TOKEN = "x";
      const p1 = await probeRepo({ cwd: process.cwd(), store: makeFakeStore(false) });
      expect(p1.hasGithubToken).toBe(true);
      delete process.env.GITHUB_TOKEN;
      const p2 = await probeRepo({ cwd: process.cwd(), store: makeFakeStore(false) });
      expect(p2.hasGithubToken).toBe(false);
    } finally {
      if (original === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = original;
    }
  });
});
