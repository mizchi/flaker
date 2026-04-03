import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI help", () => {
  it("shows an opinionated quick-start in root help", () => {
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Sample meaningful tests from CI and flaky history");
    expect(help).toContain("Quick start");
    expect(help).toContain("flaker collect --last 30");
    expect(help).toContain("flaker run --strategy hybrid --count 25 --changed src/foo.ts");
    expect(help).toContain("flaker eval --markdown --window 7");
  });

  it("shows concrete examples in sample and eval help", () => {
    const program = createProgram();
    const sampleHelp = program.commands.find((command) => command.name() === "sample")?.helpInformation();
    const evalHelp = program.commands.find((command) => command.name() === "eval")?.helpInformation();

    expect(sampleHelp).toContain("Choose a smaller local test set");
    expect(sampleHelp).toContain("flaker sample --strategy hybrid --count 25");
    expect(sampleHelp).toContain("flaker sample --strategy affected --changed src/foo.ts");
    expect(evalHelp).toContain("Measure whether local sampled runs predict CI");
    expect(evalHelp).toContain("flaker eval --json");
    expect(evalHelp).toContain("flaker eval --markdown --window 7");
  });
});
