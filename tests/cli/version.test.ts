import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI version", () => {
  it("matches the current package release line", () => {
    const program = createProgram();

    expect(program.version()).toBe("0.5.0");
  });
});
