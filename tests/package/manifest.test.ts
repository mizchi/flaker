import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("publishes only the built CLI artifacts", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      files?: string[];
      bin?: Record<string, string>;
    };

    expect(manifest.bin?.flaker).toBe("./dist/cli/main.js");
    expect(manifest.files).toEqual([
      "dist/cli/main.js",
      "dist/moonbit/flaker.js",
    ]);
  });
});
