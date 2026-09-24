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

// Names are stored well-formed (lone surrogates become U+FFFD). Ids are
// computed from the raw names, escaped by `escapeForId`.
function wellFormed(value: string): string {
  return value.toWellFormed();
}

// Mirrors `escape_for_id` in src/identity/identity_core.mbt: lone surrogates,
// and U+FFFD itself, become U+FFFD followed by four upper-case hex digits.
// Well-formed and reversible, so names that differ only in which lone
// surrogate they hold keep distinct ids (#103).
function escapeForId(value: string): string {
  if (value.isWellFormed() && !value.includes("\uFFFD")) return value;
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    out += (code >= 0xd800 && code <= 0xdfff) || code === 0xfffd
      ? `\uFFFD${code.toString(16).toUpperCase().padStart(4, "0")}`
      : char;
  }
  return out;
}

function toCoreVariant(
  variant?: Record<string, string> | null,
): CoreStableVariantEntryInput[] | null {
  if (!variant) return null;

  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, String(value)] as const)
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
      .map((entry) => [wellFormed(entry.key), wellFormed(entry.value)] as const),
  );
}

function toCoreInput(input: TestIdentityFields): CoreStableTestIdentityInput {
  const base: CoreStableTestIdentityInput = {
    suite: input.suite,
    test_name: input.testName,
  };
  if (input.taskId != null) {
    base.task_id = input.taskId;
  }
  if (input.filter != null) {
    base.filter = input.filter;
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
  const quote = (value: string) => JSON.stringify(escapeForId(value));
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

/**
 * The core for one input. MoonBit's JSON parser rejects lone-surrogate
 * escapes, so an input holding a lone surrogate goes to the TS fallback,
 * which computes the id the MoonBit core would.
 */
function coreFor(input: CoreStableTestIdentityInput): IdentityCoreExports {
  const strings = [
    input.suite,
    input.test_name,
    input.task_id,
    input.filter,
    ...(input.variant ?? []).flatMap((entry) => [entry.key, entry.value]),
  ];
  return strings.every((value) => value == null || value.isWellFormed())
    ? identityCore
    : tsFallbackCore;
}

export function createStableTestId(input: TestIdentityFields): string {
  void loadIdentityCore();
  const coreInput = toCoreInput(input);
  return JSON.parse(
    coreFor(coreInput).create_stable_test_id_json(JSON.stringify(coreInput)),
  ) as string;
}

export function resolveTestIdentity<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  void loadIdentityCore();
  const coreInput = toCoreInput(input);
  const resolved = JSON.parse(
    coreFor(coreInput).resolve_test_identity_json(JSON.stringify(coreInput)),
  ) as CoreResolvedStableTestIdentityOutput;
  return {
    ...input,
    taskId: wellFormed(resolved.task_id),
    filter: resolved.filter != null ? wellFormed(resolved.filter) : null,
    variant: fromCoreVariant(resolved.variant),
    testId: resolved.test_id,
  };
}
