import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI help", () => {
  it("shows getting started guide in root help", () => {
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Intelligent test selection");
    expect(help).toContain("Getting started");
    expect(help).toContain("flaker init");
    expect(help).toContain("flaker calibrate");
    expect(help).toContain("flaker exec run");
  });

  it("shows exec run help with --dry-run and --explain flags", () => {
    const program = createProgram();
    const execCmd = program.commands.find((command) => command.name() === "exec");
    const runCmd = execCmd?.commands.find((command) => command.name() === "run");
    const runHelp = runCmd?.helpInformation();
    const analyzeCmd = program.commands.find((command) => command.name() === "analyze");
    const evalHelp = analyzeCmd?.commands.find((command) => command.name() === "eval")?.helpInformation();

    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--explain");
    expect(evalHelp).toContain("Measure whether local sampled runs predict CI");
  });
});
