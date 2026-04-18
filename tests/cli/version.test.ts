import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("CLI version", () => {
  it("matches the current package release line", () => {
    const program = createProgram();

    expect(program.version()).toBe(packageVersion.version);
  });
});
