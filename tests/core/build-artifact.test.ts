import { describe, expect, it } from "vitest";
import { MOONBIT_JS_BRIDGE_URL } from "../../src/cli/core/build-artifact.js";

describe("MOONBIT_JS_BRIDGE_URL", () => {
  it("points to the root MoonBit build artifact", () => {
    expect(MOONBIT_JS_BRIDGE_URL.pathname).toMatch(/\/_build\/js\/debug\/build\/cli\/bridge\/bridge\.js$/);
  });
});
