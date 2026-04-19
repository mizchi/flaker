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

function toCoreVariant(
  variant?: Record<string, string> | null,
): CoreStableVariantEntryInput[] | null {
  if (!variant) return null;

  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

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
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => [entry.key, entry.value] as const),
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

function createStableTestIdFallback(
  input: CoreStableTestIdentityInput,
): string {
  const taskId = input.task_id ?? input.suite;
  const filter = input.filter ?? null;
  const variant = fromCoreVariant(input.variant);
  return JSON.stringify({
    taskId,
    suite: input.suite,
    testName: input.test_name,
    filter,
    variant,
  });
}

function resolveTestIdentityFallback(
  input: CoreStableTestIdentityInput,
): CoreResolvedStableTestIdentityOutput {
  const taskId = input.task_id ?? input.suite;
  const filter = input.filter;
  const variant = toCoreVariant(fromCoreVariant(input.variant));
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
let bridgeLoadStarted = false;

function ensureBridgeLoad(): void {
  if (bridgeLoadStarted) return;
  bridgeLoadStarted = true;
  importOptionalMoonBitBridge<IdentityCoreExports>(
    MOONBIT_JS_BRIDGE_URL,
    isIdentityCoreExports,
  ).then((mod) => {
    if (mod) identityCore = mod;
  }).catch(() => {
    // bridge unavailable — keep using the TS fallback
  });
}

export function normalizeVariant(
  variant?: Record<string, string> | null,
): Record<string, string> | null {
  return fromCoreVariant(toCoreVariant(variant));
}

export function createStableTestId(input: TestIdentityFields): string {
  ensureBridgeLoad();
  return JSON.parse(
    identityCore.create_stable_test_id_json(JSON.stringify(toCoreInput(input))),
  ) as string;
}

export function resolveTestIdentity<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  ensureBridgeLoad();
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
