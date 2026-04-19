import { describe, expect, it } from "vitest";
import { detectAdapter } from "../../src/cli/categories/import.js";

describe("import adapter auto-detect", () => {
  it(".xml → junit", () => {
    expect(detectAdapter("results.xml")).toBe("junit");
  });
  it(".parquet → parquet", () => {
    expect(detectAdapter("runs.parquet")).toBe("parquet");
  });
  it(".json defaults to playwright", () => {
    expect(detectAdapter("report.json")).toBe("playwright");
  });
  it("unknown extension returns undefined", () => {
    expect(detectAdapter("report.txt")).toBeUndefined();
  });
  it("case insensitive", () => {
    expect(detectAdapter("Report.JSON")).toBe("playwright");
    expect(detectAdapter("Results.XML")).toBe("junit");
  });
});
