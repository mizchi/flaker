import { describe, expect, it } from "vitest";
import { runCollectCi } from "../../src/cli/categories/collect.js";

describe("runCollectCi (throwing variant)", () => {
  it("throws when GITHUB_TOKEN is missing (does not call process.exit)", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await expect(
        runCollectCi({
          store: {} as any,
          config: {
            repo: { owner: "o", name: "r" },
            storage: { path: ".flaker/data" },
            adapter: { type: "playwright" },
          } as any,
          cwd: process.cwd(),
          days: 30,
        }),
      ).rejects.toThrow(/GITHUB_TOKEN/);
    } finally {
      if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalToken;
    }
  });
});
