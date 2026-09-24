import { MOONBIT_JS_BRIDGE_URL } from "./core/build-artifact.js";
import { importOptionalMoonBitBridge } from "./core/bridge-loader.js";

export interface TestIdentityFields {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  variant?: Record<string, string> | null;
  testId?: string;
}

export interface ResolvedTestIdentity extends TestIdentityFields {
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  testId: string;
}

interface CoreStableVariantEntryInput {
  key: string;
  value: string;
}

interface CoreStableTestIdentityInput {
  suite: string;
  test_name: string;
  task_id?: string;
  filter?: string;
  variant?: CoreStableVariantEntryInput[];
  test_id?: string;
}

interface CoreResolvedStableTestIdentityOutput {
  suite: string;
  test_name: string;
  task_id: string;
  filter?: string;
  variant?: CoreStableVariantEntryInput[];
  test_id: string;
}

interface IdentityCoreExports {
  create_stable_test_id_json: (inputJson: string) => string;
  resolve_test_identity_json: (inputJson: string) => string;
}

function isIdentityCoreExports(
  mod: Partial<IdentityCoreExports>,
): mod is IdentityCoreExports {
  return (
    typeof mod.create_stable_test_id_json === "function"
    && typeof mod.resolve_test_identity_json === "function"
  );
}

// MoonBit's `String::lexical_compare` orders by UTF-16 code unit, which is
// also what JS relational operators do. `localeCompare` is ICU collation and
// must not be used for anything that feeds a test id.
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// MoonBit's JSON parser rejects lone-surrogate escapes, so every string is
// made well-formed (lone surrogates become U+FFFD) before either core sees it.
function wellFormed(value: string): string {
  return value.toWellFormed();
}

function toCoreVariant(
  variant?: Record<string, string> | null,
): CoreStableVariantEntryInput[] | null {
  if (!variant) return null;

  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [wellFormed(key), wellFormed(String(value))] as const)
    .sort(([a], [b]) => compareCodeUnits(a, b));

  if (entries.length === 0) return null;
  return entries.map(([key, value]) => ({ key, value }));
}

function fromCoreVariant(
  variant: CoreStableVariantEntryInput[] | null | undefined,
): Record<string, string> | null {
  if (!variant || variant.length === 0) {
    return null;
  }
  return Object.fromEntries(
    [...variant]
      .sort((a, b) => compareCodeUnits(a.key, b.key))
      .map((entry) => [entry.key, entry.value] as const),
  );
}

function toCoreInput(input: TestIdentityFields): CoreStableTestIdentityInput {
  const base: CoreStableTestIdentityInput = {
    suite: wellFormed(input.suite),
    test_name: wellFormed(input.testName),
  };
  if (input.taskId != null) {
    base.task_id = wellFormed(input.taskId);
  }
  if (input.filter != null) {
    base.filter = wellFormed(input.filter);
  }
  const variant = toCoreVariant(input.variant);
  if (variant) {
    base.variant = variant;
  }
  if (input.testId != null) {
    base.test_id = input.testId;
  }
  return base;
}

function sortCoreVariant(
  variant: CoreStableVariantEntryInput[] | null | undefined,
): CoreStableVariantEntryInput[] | null {
  if (!variant || variant.length === 0) return null;
  return [...variant].sort((a, b) => compareCodeUnits(a.key, b.key));
}

// Mirrors `create_stable_test_id` in src/identity/identity_core.mbt. The JSON
// text is assembled by hand in MoonBit's key order: going through a JS object
// would move integer-like variant keys ("9", "10") to the front.
function createStableTestIdFallback(
  input: CoreStableTestIdentityInput,
): string {
  const quote = (value: string) => JSON.stringify(value);
  const taskId = input.task_id ?? input.suite;
  const filter = input.filter != null ? quote(input.filter) : "null";
  const entries = sortCoreVariant(input.variant);
  const variant = entries
    ? `{${entries.map((entry) => `${quote(entry.key)}:${quote(entry.value)}`).join(",")}}`
    : "null";
  return `{"taskId":${quote(taskId)},"suite":${quote(input.suite)},"testName":${quote(input.test_name)},"filter":${filter},"variant":${variant}}`;
}

function resolveTestIdentityFallback(
  input: CoreStableTestIdentityInput,
): CoreResolvedStableTestIdentityOutput {
  const taskId = input.task_id ?? input.suite;
  const filter = input.filter;
  const variant = sortCoreVariant(input.variant);
  return {
    suite: input.suite,
    test_name: input.test_name,
    task_id: taskId,
    ...(filter != null ? { filter } : {}),
    ...(variant ? { variant } : {}),
    test_id: input.test_id ?? createStableTestIdFallback({
      suite: input.suite,
      test_name: input.test_name,
      task_id: taskId,
      ...(filter != null ? { filter } : {}),
      ...(variant ? { variant } : {}),
    }),
  };
}

const tsFallbackCore: IdentityCoreExports = {
  create_stable_test_id_json(inputJson: string): string {
    return JSON.stringify(
      createStableTestIdFallback(
        JSON.parse(inputJson) as CoreStableTestIdentityInput,
      ),
    );
  },
  resolve_test_identity_json(inputJson: string): string {
    return JSON.stringify(
      resolveTestIdentityFallback(
        JSON.parse(inputJson) as CoreStableTestIdentityInput,
      ),
    );
  },
};

let identityCore: IdentityCoreExports = tsFallbackCore;
let bridgeLoad: Promise<void> | undefined;

/**
 * Loads the MoonBit identity core. The CLI awaits this before running any
 * command (see the preAction hook in main.ts) so that one process never
 * computes ids with both cores. Other callers that compute ids before it
 * resolves get the TS fallback, which produces the same ids.
 *
 * Not done with a top-level await: importing the bridge runs its `main`,
 * which prints the core version for `flaker --version`.
 */
export function loadIdentityCore(): Promise<void> {
  bridgeLoad ??= importOptionalMoonBitBridge<IdentityCoreExports>(
    MOONBIT_JS_BRIDGE_URL,
    isIdentityCoreExports,
  ).then((mod) => {
    if (mod) identityCore = mod;
  }).catch(() => {
    // bridge unavailable — keep using the TS fallback
  });
  return bridgeLoad;
}

export function normalizeVariant(
  variant?: Record<string, string> | null,
): Record<string, string> | null {
  return fromCoreVariant(toCoreVariant(variant));
}

export function createStableTestId(input: TestIdentityFields): string {
  void loadIdentityCore();
  return JSON.parse(
    identityCore.create_stable_test_id_json(JSON.stringify(toCoreInput(input))),
  ) as string;
}

export function resolveTestIdentity<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  void loadIdentityCore();
  const resolved = JSON.parse(
    identityCore.resolve_test_identity_json(JSON.stringify(toCoreInput(input))),
  ) as CoreResolvedStableTestIdentityOutput;
  return {
    ...input,
    taskId: resolved.task_id,
    filter: resolved.filter ?? null,
    variant: fromCoreVariant(resolved.variant),
    testId: resolved.test_id,
  };
}
