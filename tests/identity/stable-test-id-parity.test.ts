import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MOONBIT_JS_BRIDGE_URL } from "../../src/cli/core/build-artifact.js";
import type { TestIdentityFields } from "../../src/cli/identity.js";

// The TypeScript fallback in src/cli/identity.ts and the MoonBit core
// (src/identity/identity_core.mbt) must emit byte-identical test ids, or rows
// written with and without the MoonBit bridge land under different test_ids.

interface MoonBitIdentityBridge {
  create_stable_test_id_json: (inputJson: string) => string;
}

type IdentityModule = typeof import("../../src/cli/identity.js");

const MISSING_BRIDGE_PATH = "file:///tmp/flaker-missing-moonbit-bridge.js";

const CASES: Array<{ name: string; input: TestIdentityFields }> = [
  { name: "no variant", input: { suite: "s.spec.ts", testName: "t" } },
  { name: "null variant", input: { suite: "s.spec.ts", testName: "t", variant: null } },
  { name: "empty variant", input: { suite: "s.spec.ts", testName: "t", variant: {} } },
  {
    name: "lowercase ASCII keys",
    input: { suite: "s", testName: "t", variant: { os: "linux", browser: "chromium" } },
  },
  {
    name: "vrt-bench camelCase keys",
    input: {
      suite: "s",
      testName: "t",
      variant: {
        backend: "chromium",
        category: "c",
        selectorType: "css",
        interactive: "true",
        fallbackUsed: "false",
        resolvedBy: "chromium",
      },
    },
  },
  { name: "mixed case {B,a}", input: { suite: "s", testName: "t", variant: { B: "1", a: "2" } } },
  {
    name: "integer-like {10,9}",
    input: { suite: "s", testName: "t", variant: { "10": "x", "9": "y" } },
  },
  { name: "non-ASCII {é,f}", input: { suite: "s", testName: "t", variant: { é: "1", f: "2" } } },
  {
    name: "mixed-case, non-ASCII and integer-like keys",
    input: {
      suite: "s",
      testName: "t",
      variant: { z: "1", Z: "2", _x: "3", "1": "4", Ä: "5", a: "6", "02": "7", ß: "8" },
    },
  },
  {
    name: "astral vs BMP-high keys",
    input: { suite: "s", testName: "t", variant: { "￿": "bmp", "😀": "astral", "": "pua" } },
  },
  {
    name: "task id and filter",
    input: { suite: "s", testName: "t", taskId: "task-1", filter: "--grep @smoke" },
  },
  {
    name: "escapes",
    input: { suite: "a\"b\\c", testName: "line1\nline2\ttab\r/slash", filter: "\"q\"" },
  },
  {
    name: "control chars",
    input: { suite: "s", testName: "\u0000\u0001\u001f\u007f\u0080", variant: { k: "\b\f" } },
  },
  { name: "emoji", input: { suite: "emoji 😀.spec.ts", testName: "👍🏽 works", variant: { "🚀": "🔥" } } },
  { name: "line separators", input: { suite: "s", testName: "a b c﻿" } },
  { name: "U+FFFD in a name", input: { suite: "s\ufffd", testName: "a\ufffdb", variant: { "k\ufffd": "\ufffd" } } },
];

// MoonBit's JSON parser rejects lone-surrogate escapes, so these cannot reach
// the MoonBit core through the bridge; the fallback computes their ids, and
// src/identity/identity_core_test.mbt pins the same form on the MoonBit side.
const LONE_SURROGATE_CASES: Array<{ name: string; input: TestIdentityFields; id: string }> = [
  {
    name: "lone surrogates in every field",
    input: {
      suite: "s\udc00",
      testName: "x\ud800y",
      taskId: "t\ud83d",
      filter: "\ude00f",
      variant: { "k\ud800": "v\udfff" },
    },
    id: `{"taskId":"t\ufffdD83D","suite":"s\ufffdDC00","testName":"x\ufffdD800y","filter":"\ufffdDE00f","variant":{"k\ufffdD800":"v\ufffdDFFF"}}`,
  },
  {
    name: "a high surrogate",
    input: { suite: "s", testName: "a\ud800" },
    id: `{"taskId":"s","suite":"s","testName":"a\ufffdD800","filter":null,"variant":null}`,
  },
  {
    name: "a low surrogate",
    input: { suite: "s", testName: "a\udc00" },
    id: `{"taskId":"s","suite":"s","testName":"a\ufffdDC00","filter":null,"variant":null}`,
  },
];

function toMoonBitInput(input: TestIdentityFields): Record<string, unknown> {
  const variant = Object.entries(input.variant ?? {}).map(([key, value]) => ({ key, value }));
  return {
    suite: input.suite,
    test_name: input.testName,
    ...(input.taskId != null ? { task_id: input.taskId } : {}),
    ...(input.filter != null ? { filter: input.filter } : {}),
    ...(variant.length > 0 ? { variant } : {}),
  };
}

async function importFallbackIdentity(): Promise<IdentityModule> {
  vi.resetModules();
  vi.doMock("../../src/cli/core/build-artifact.js", () => ({
    MOONBIT_JS_BRIDGE_URL: new URL(MISSING_BRIDGE_PATH),
    resolveMoonBitJsBridgeUrl: () => new URL(MISSING_BRIDGE_PATH),
  }));
  return await import("../../src/cli/identity.js");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../src/cli/core/build-artifact.js");
  vi.doUnmock("../../src/cli/core/bridge-loader.js");
});

describe("stable test id parity between the MoonBit core and the TS fallback", () => {
  let bridge: MoonBitIdentityBridge;
  let fallback: IdentityModule;

  beforeAll(async () => {
    bridge = (await import(MOONBIT_JS_BRIDGE_URL.href)) as MoonBitIdentityBridge;
    fallback = await importFallbackIdentity();
  });

  function moonbitId(input: TestIdentityFields): string {
    return JSON.parse(
      bridge.create_stable_test_id_json(JSON.stringify(toMoonBitInput(input))),
    ) as string;
  }

  it.each(CASES)("createStableTestId: $name", ({ input }) => {
    expect(fallback.createStableTestId(input)).toBe(moonbitId(input));
  });

  it.each(CASES)("resolveTestIdentity: $name", ({ input }) => {
    expect(fallback.resolveTestIdentity(input).testId).toBe(moonbitId(input));
  });

  it.each(LONE_SURROGATE_CASES)("lone surrogates, fallback: $name", ({ input, id }) => {
    expect(fallback.createStableTestId(input)).toBe(id);
    expect(fallback.resolveTestIdentity(input).testId).toBe(id);
  });

  it.each(LONE_SURROGATE_CASES)("lone surrogates, bridge-backed public API: $name", async ({ input, id }) => {
    vi.resetModules();
    const identity = await import("../../src/cli/identity.js");
    await identity.loadIdentityCore();
    expect(identity.createStableTestId(input)).toBe(id);
    const resolved = identity.resolveTestIdentity(input);
    expect(resolved.testId).toBe(id);
    for (const value of [resolved.taskId, resolved.filter, ...Object.entries(resolved.variant ?? {}).flat()]) {
      if (value != null) expect(value.isWellFormed()).toBe(true);
    }
  });

  it("gives names that differ only in their lone surrogate distinct ids (#103)", () => {
    const ids = ["a\ud800", "a\udc00", "a\ufffd"].map((testName) => fallback.createStableTestId({ suite: "s", testName }));
    expect(new Set(ids).size).toBe(3);
  });

  it.each(CASES)("bridge-backed public API: $name", async ({ input }) => {
    vi.resetModules();
    const identity = await import("../../src/cli/identity.js");
    await identity.loadIdentityCore();
    expect(identity.createStableTestId(input)).toBe(moonbitId(input));
    expect(identity.resolveTestIdentity(input).testId).toBe(moonbitId(input));
  });
});

describe("MoonBit bridge load", () => {
  const SENTINEL = "moonbit-sentinel";

  function mockSlowBridge() {
    vi.doMock("../../src/cli/core/bridge-loader.js", () => ({
      importOptionalMoonBitBridge: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          create_stable_test_id_json: () => JSON.stringify(SENTINEL),
          resolve_test_identity_json: (inputJson: string) => {
            const input = JSON.parse(inputJson) as { suite: string; test_name: string };
            return JSON.stringify({ ...input, task_id: input.suite, test_id: SENTINEL });
          },
        };
      },
    }));
  }

  it("is complete once loadIdentityCore resolves", async () => {
    vi.resetModules();
    mockSlowBridge();
    const identity = await import("../../src/cli/identity.js");
    await identity.loadIdentityCore();
    expect(identity.resolveTestIdentity({ suite: "s", testName: "t" }).testId).toBe(SENTINEL);
    expect(identity.createStableTestId({ suite: "s", testName: "t" })).toBe(SENTINEL);
  });

  it("is complete before the first id a CLI command computes", async () => {
    vi.resetModules();
    mockSlowBridge();
    const { createProgram } = await import("../../src/cli/main.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await createProgram().parseAsync(
        ["dev", "test-key", "--suite", "s", "--test-name", "t"],
        { from: "user" },
      );
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
        `Listed key: ${SENTINEL}`,
        `Meta key:   ${SENTINEL}`,
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
