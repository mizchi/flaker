import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { deprecate } from "../../src/cli/deprecation.js";

describe("deprecate()", () => {
  it("rewrites the description to carry the DEPRECATED marker", () => {
    const cmd = new Command("foo").description("Does foo");
    deprecate(cmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker bar" });
    expect(cmd.description()).toMatch(/DEPRECATED.*0\.8\.0/);
    expect(cmd.description()).toMatch(/flaker bar/);
  });

  it("warns on .action invocation (stderr)", async () => {
    const cmd = new Command("foo");
    let called = false;
    cmd.action(() => { called = true; });
    deprecate(cmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker bar" });

    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { writes.push(String(chunk)); return true; }) as any;
    try {
      const parent = new Command().addCommand(cmd);
      await parent.parseAsync(["foo"], { from: "user" });
    } finally {
      process.stderr.write = orig;
    }
    expect(writes.join("")).toMatch(/deprecated/);
    expect(writes.join("")).toMatch(/flaker bar/);
    expect(called).toBe(true);
  });

  it("warns on --help invocation (outputHelp)", () => {
    const cmd = new Command("foo").helpOption(false);
    cmd.action(() => {});
    deprecate(cmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker bar" });

    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { writes.push(String(chunk)); return true; }) as any;
    try {
      cmd.outputHelp();
    } finally {
      process.stderr.write = orig;
    }
    expect(writes.join("")).toMatch(/deprecated/);
  });

  it("returns the same Command (fluent)", () => {
    const cmd = new Command("foo");
    const result = deprecate(cmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker bar" });
    expect(result).toBe(cmd);
  });
});
