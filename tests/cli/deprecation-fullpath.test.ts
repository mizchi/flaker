import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { deprecate } from "../../src/cli/deprecation.js";

describe("deprecate() uses the full command path", () => {
  it("warning references parent → child path, not leaf alone", async () => {
    const root = new Command("flaker");
    const analyze = root.command("analyze").description("group");
    const query = analyze.command("query").description("run sql").action(() => {});
    deprecate(query, { since: "0.7.0", remove: "0.8.0", canonical: "flaker query <sql>" });

    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: any) => { writes.push(String(c)); return true; }) as any;
    try {
      await root.parseAsync(["analyze", "query"], { from: "user" });
    } finally {
      process.stderr.write = orig;
    }
    const msg = writes.join("");
    expect(msg).toContain("flaker analyze query");
    expect(msg).not.toMatch(/`flaker query`.*is deprecated/);
  });

  it("three-level nesting also works", async () => {
    const root = new Command("flaker");
    const import_ = root.command("import").description("imports");
    const parquet = import_.command("parquet").description("parquet").action(() => {});
    deprecate(parquet, { since: "0.7.0", remove: "0.8.0", canonical: "flaker import <file>" });

    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: any) => { writes.push(String(c)); return true; }) as any;
    try {
      await root.parseAsync(["import", "parquet"], { from: "user" });
    } finally {
      process.stderr.write = orig;
    }
    expect(writes.join("")).toContain("flaker import parquet");
  });
});
