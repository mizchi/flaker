import { describe, it, expect } from "vitest";
import { confirmExitCode } from "../../src/cli/commands/debug/confirm.js";

describe("confirmExitCode", () => {
  it("TRANSIENT → 0", () => expect(confirmExitCode("TRANSIENT")).toBe(0));
  it("FLAKY → 1", () => expect(confirmExitCode("FLAKY")).toBe(1));
  it("BROKEN → 2", () => expect(confirmExitCode("BROKEN")).toBe(2));
  it("ERROR → 3", () => expect(confirmExitCode("ERROR")).toBe(3));
});
