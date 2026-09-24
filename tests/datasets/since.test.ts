import { describe, expect, it } from "vitest";
import { parseSince } from "../../src/cli/datasets/query.js";
import { FlakerUsageError } from "../../src/cli/errors.js";

describe("parseSince", () => {
  it("reads a date-only value as midnight UTC", () => {
    expect(parseSince("2026-09-01")).toBe("2026-09-01 00:00:00.000");
  });

  it("converts a date-time with an offset to naive UTC", () => {
    expect(parseSince("2026-09-01T10:00:00Z")).toBe("2026-09-01 10:00:00.000");
    expect(parseSince("2026-09-01T10:00+09:00")).toBe("2026-09-01 01:00:00.000");
  });

  it("rejects a date-time without an offset, which would depend on the local time zone", () => {
    expect(() => parseSince("2026-09-01T10:00")).toThrow(/offset/);
  });

  it("rejects impossible dates and non-ISO input", () => {
    for (const raw of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-09-31T00:00Z", "yesterday", "09/01/2026"]) {
      expect(() => parseSince(raw), raw).toThrow(FlakerUsageError);
    }
    expect(parseSince("2028-02-29")).toBe("2028-02-29 00:00:00.000");
  });
});
