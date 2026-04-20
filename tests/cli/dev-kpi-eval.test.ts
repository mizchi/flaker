import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("dev kpi/eval commands", () => {
  it("registers `dev kpi` with --window-days and --output", () => {
    const program = createProgram();
    const dev = program.commands.find((c) => c.name() === "dev");
    const kpi = dev?.commands.find((c) => c.name() === "kpi");

    expect(kpi).toBeDefined();
    const help = kpi?.helpInformation();
    expect(help).toContain("--window-days");
    expect(help).toContain("--output");
  });

  it("registers `dev eval` with --window-days and --output", () => {
    const program = createProgram();
    const dev = program.commands.find((c) => c.name() === "dev");
    const evalCmd = dev?.commands.find((c) => c.name() === "eval");

    expect(evalCmd).toBeDefined();
    const help = evalCmd?.helpInformation();
    expect(help).toContain("--window-days");
    expect(help).toContain("--output");
  });
});
